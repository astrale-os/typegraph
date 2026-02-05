/**
 * Graph - Main Entry Point
 *
 * This is the primary API for creating and interacting with a typed graph database.
 * The Graph interface provides access to both query and mutation operations.
 *
 * @example
 * ```typescript
 * import { createGraph, defineSchema, string } from '@astrale/typegraph'
 * import { neo4j } from '@astrale/typegraph-adapter-neo4j'
 *
 * const schema = defineSchema({
 *   nodes: {
 *     user: { name: string(), email: string() },
 *     post: { title: string() },
 *   },
 *   edges: {
 *     authored: { from: 'user', to: 'post' },
 *   },
 * })
 *
 * const graph = await createGraph(schema, {
 *   adapter: neo4j({ uri: 'bolt://localhost:7687', auth: { ... } })
 * })
 *
 * // Query
 * const users = await graph.node('user').where({ ... }).execute()
 *
 * // Mutate
 * const user = await graph.mutate.create('user', { name: 'John', email: 'john@example.com' })
 *
 * // Transaction
 * await graph.transaction(async (tx) => {
 *   const post = await tx.mutate.create('post', { title: 'Hello' })
 *   await tx.mutate.link('authored', user.id, post.id)
 * })
 *
 * await graph.close()
 * ```
 */

import type { AnySchema, NodeLabels, EdgeTypes } from '@astrale/typegraph-core'
import type { GraphAdapter, TransactionContext } from './adapter'
import type { GraphQuery, QueryExecutor } from './query/types'
import { GraphQueryImpl } from './query/impl'
import type {
  GraphMutations,
  MutationTransaction,
  IdGenerator,
  MutationTemplateProvider,
  MutationExecutor,
  MutationHooks,
  ValidationOptions,
  DryRunOptions,
} from './mutation'
import { GraphMutationsImpl, defaultIdGenerator } from './mutation'
import type { CollectionBuilder } from './query/collection'
import type { SingleNodeBuilder } from './query/single-node'
import type { EdgeBuilder } from './query/edge'
import type { PathBuilder } from './query/path'

/**
 * Options for creating a graph instance.
 */
export interface GraphOptions<S extends AnySchema = AnySchema> {
  /** Database adapter (neo4j, falkordb, memgraph, etc.) */
  adapter: GraphAdapter
  /** Custom ID generator for mutations */
  idGenerator?: IdGenerator
  /** Custom mutation template provider (defaults to Cypher) */
  mutationTemplates?: MutationTemplateProvider
  /** Mutation lifecycle hooks (beforeCreate, afterCreate, etc.) */
  hooks?: MutationHooks<S>
  /** Mutation validation options */
  validation?: ValidationOptions
  /** Dry-run mode - generates queries without executing */
  dryRun?: boolean | DryRunOptions
}

/**
 * Transaction scope providing access to mutations and raw queries within a transaction.
 */
export interface TransactionScope<S extends AnySchema> {
  /** Mutation API within the transaction */
  readonly mutate: MutationTransaction<S>
  /** Execute a raw query within the transaction */
  raw<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>
}

/**
 * Main graph interface - the public API returned by createGraph().
 *
 * Extends GraphQuery with:
 * - Mutation operations (via .mutate)
 * - Transaction support
 * - Connection lifecycle management
 */
export interface Graph<S extends AnySchema> extends GraphQuery<S> {
  // ---------------------------------------------------------------------------
  // MUTATION API
  // ---------------------------------------------------------------------------

  /** Access the mutation API */
  readonly mutate: GraphMutations<S>

  // ---------------------------------------------------------------------------
  // TRANSACTION API
  // ---------------------------------------------------------------------------

  /**
   * Execute operations within a transaction.
   *
   * - On success: auto-commits
   * - On error: auto-rollbacks and rethrows
   *
   * @example
   * ```typescript
   * await graph.transaction(async (tx) => {
   *   const user = await tx.mutate.create('user', { name: 'John' })
   *   const post = await tx.mutate.create('post', { title: 'Hello' })
   *   await tx.mutate.link('authored', user.id, post.id)
   * })
   * ```
   */
  transaction<T>(fn: (tx: TransactionScope<S>) => Promise<T>): Promise<T>

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------

  /** Generate an ID using the configured ID generator (same format as mutate.create) */
  generateId(type: string): string

  /** Close the database connection */
  close(): Promise<void>

  /** Check if the adapter is connected */
  isConnected(): Promise<boolean>
}

// =============================================================================
// INTERNAL IMPLEMENTATION
// =============================================================================

/**
 * Bridge GraphAdapter to QueryExecutor interface.
 */
function createQueryExecutorBridge(adapter: GraphAdapter): QueryExecutor {
  return {
    run<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
      return adapter.query<T>(query, params)
    },
  }
}

/**
 * Bridge GraphAdapter to MutationExecutor interface.
 */
function createMutationExecutorBridge(adapter: GraphAdapter): MutationExecutor {
  return {
    run<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
      return adapter.mutate<T>(query, params)
    },
    runInTransaction<T>(
      fn: (tx: { run<R>(q: string, p: Record<string, unknown>): Promise<R[]> }) => Promise<T>,
    ): Promise<T> {
      return adapter.transaction<T>(async (txCtx: TransactionContext) => {
        return fn({
          run<R>(q: string, p: Record<string, unknown>): Promise<R[]> {
            return txCtx.run<R>(q, p)
          },
        })
      })
    },
  }
}

/**
 * Internal implementation of the Graph interface.
 *
 * Thin orchestrator that delegates to GraphQueryImpl and GraphMutationsImpl.
 */
class GraphImpl<S extends AnySchema> implements Graph<S> {
  private readonly _schema: S
  private readonly _adapter: GraphAdapter
  private readonly _query: GraphQuery<S>
  private readonly _mutate: GraphMutations<S>
  private readonly _options: GraphOptions<S>
  private readonly _idGenerator: IdGenerator

  constructor(schema: S, options: GraphOptions<S>) {
    this._schema = schema
    this._adapter = options.adapter
    this._options = options
    this._idGenerator = options.idGenerator ?? defaultIdGenerator

    // Create query implementation with adapter bridge
    const queryExecutor = createQueryExecutorBridge(this._adapter)
    this._query = new GraphQueryImpl(schema, queryExecutor)

    // Create mutation implementation with adapter bridge
    const mutationExecutor = createMutationExecutorBridge(this._adapter)
    this._mutate = new GraphMutationsImpl(schema, mutationExecutor, {
      idGenerator: options.idGenerator,
      templates: options.mutationTemplates,
      hooks: options.hooks,
      validation: options.validation,
      dryRun: options.dryRun,
    })
  }

  // ---------------------------------------------------------------------------
  // SCHEMA & EXECUTOR ACCESS
  // ---------------------------------------------------------------------------

  get schema(): S {
    return this._schema
  }

  get executor(): QueryExecutor | null {
    return this._query.executor
  }

  // ---------------------------------------------------------------------------
  // QUERY API (delegate to GraphQueryImpl)
  // ---------------------------------------------------------------------------

  node<N extends NodeLabels<S>>(label: N): CollectionBuilder<S, N, Record<string, never>> {
    return this._query.node(label)
  }

  nodeById(id: string): SingleNodeBuilder<S, NodeLabels<S>, Record<string, never>> {
    return this._query.nodeById(id)
  }

  nodeByIdWithLabel<N extends NodeLabels<S>>(
    label: N,
    id: string,
  ): SingleNodeBuilder<S, N, Record<string, never>> {
    return this._query.nodeByIdWithLabel(label, id)
  }

  edge<E extends EdgeTypes<S>>(
    edgeType: E,
  ): EdgeBuilder<S, E, Record<string, never>, Record<string, never>> {
    return this._query.edge(edgeType)
  }

  shortestPath<
    NFrom extends NodeLabels<S>,
    NTo extends NodeLabels<S>,
    E extends EdgeTypes<S>,
  >(config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
  }): PathBuilder<S, NFrom, NTo> {
    return this._query.shortestPath(config)
  }

  allShortestPaths<
    NFrom extends NodeLabels<S>,
    NTo extends NodeLabels<S>,
    E extends EdgeTypes<S>,
  >(config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
  }): PathBuilder<S, NFrom, NTo> {
    return this._query.allShortestPaths(config)
  }

  allPaths<NFrom extends NodeLabels<S>, NTo extends NodeLabels<S>, E extends EdgeTypes<S>>(config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
    maxDepth?: number
  }): PathBuilder<S, NFrom, NTo> {
    return this._query.allPaths(config)
  }

  intersect<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any>[]
  ): CollectionBuilder<S, N, Record<string, never>> {
    return this._query.intersect(...queries)
  }

  union<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any>[]
  ): CollectionBuilder<S, N, Record<string, never>> {
    return this._query.union(...queries)
  }

  unionAll<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any>[]
  ): CollectionBuilder<S, N, Record<string, never>> {
    return this._query.unionAll(...queries)
  }

  // ---------------------------------------------------------------------------
  // MUTATION API
  // ---------------------------------------------------------------------------

  get mutate(): GraphMutations<S> {
    return this._mutate
  }

  // ---------------------------------------------------------------------------
  // TRANSACTION API
  // ---------------------------------------------------------------------------

  async transaction<T>(fn: (tx: TransactionScope<S>) => Promise<T>): Promise<T> {
    return this._adapter.transaction<T>(async (txCtx: TransactionContext) => {
      // Create transaction-scoped mutation executor
      const txMutationExecutor: MutationExecutor = {
        run<R>(query: string, params: Record<string, unknown>): Promise<R[]> {
          return txCtx.run<R>(query, params)
        },
        runInTransaction<R>(
          innerFn: (tx: {
            run<X>(q: string, p: Record<string, unknown>): Promise<X[]>
          }) => Promise<R>,
        ): Promise<R> {
          // Nested transaction uses same context
          return innerFn({
            run<X>(q: string, p: Record<string, unknown>): Promise<X[]> {
              return txCtx.run<X>(q, p)
            },
          })
        },
      }

      // Create transaction-scoped mutations (inherits hooks/validation from graph)
      const txMutate = new GraphMutationsImpl(this._schema, txMutationExecutor, {
        idGenerator: this._options.idGenerator,
        templates: this._options.mutationTemplates,
        hooks: this._options.hooks,
        validation: this._options.validation,
      }) as unknown as MutationTransaction<S>

      const scope: TransactionScope<S> = {
        mutate: txMutate,
        raw: <R>(cypher: string, params?: Record<string, unknown>): Promise<R[]> => {
          return txCtx.run<R>(cypher, params)
        },
      }

      return fn(scope)
    })
  }

  // ---------------------------------------------------------------------------
  // RAW QUERY
  // ---------------------------------------------------------------------------

  async raw<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    return this._query.raw<T>(cypher, params)
  }

  // ---------------------------------------------------------------------------
  // LIFECYCLE
  // ---------------------------------------------------------------------------

  generateId(type: string): string {
    return this._idGenerator.generate(type)
  }

  async close(): Promise<void> {
    return this._adapter.close()
  }

  async isConnected(): Promise<boolean> {
    return this._adapter.isConnected()
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

/**
 * Create a graph instance connected to a database.
 *
 * This is the main entry point for using TypeGraph. It connects to the database
 * immediately (fail-fast) and returns a fully typed Graph instance.
 *
 * @param schema - The graph schema definition
 * @param options - Graph options including the database adapter
 * @returns A connected Graph instance
 *
 * @example
 * ```typescript
 * import { createGraph, defineSchema, string } from '@astrale/typegraph'
 * import { neo4j } from '@astrale/typegraph-adapter-neo4j'
 *
 * const schema = defineSchema({
 *   nodes: {
 *     user: { name: string(), email: string() },
 *   },
 *   edges: {},
 * })
 *
 * const graph = await createGraph(schema, {
 *   adapter: neo4j({ uri: 'bolt://localhost:7687' })
 * })
 *
 * // Query
 * const users = await graph.node('user').execute()
 *
 * // Mutate
 * const user = await graph.mutate.create('user', { name: 'John', email: 'john@example.com' })
 *
 * // Transaction
 * await graph.transaction(async (tx) => {
 *   const u = await tx.mutate.create('user', { name: 'Jane', email: 'jane@example.com' })
 *   // More operations...
 * })
 *
 * // Clean up
 * await graph.close()
 * ```
 */
export async function createGraph<S extends AnySchema>(
  schema: S,
  options: GraphOptions<S>,
): Promise<Graph<S>> {
  // Connect eagerly (fail fast)
  await options.adapter.connect()
  return new GraphImpl(schema, options)
}
