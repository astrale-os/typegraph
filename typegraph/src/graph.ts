/**
 * Graph - Main Entry Point
 *
 * Primary API for creating and interacting with a typed graph database.
 * Schema comes from KRL codegen output.
 */

import type { SchemaShape, TypeMap, UntypedMap } from './schema'
import { mergeSchemaExtension } from './schema'
import type { NodeLabels, EdgeTypes } from './inference'
import type { GraphAdapter, TransactionContext } from './adapter'
import type { GraphQuery, QueryExecutor } from './query/types'
import { GraphQueryImpl } from './query/impl'
import type {
  GraphMutations,
  MutationTransaction,
  IdGenerator,
  MutationCompilationPass,
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
import type { MethodDispatchFn, MethodSchemaInfo } from './methods'
import { MethodNotDispatchedError } from './errors'
import type { ConstraintSchemaInfo } from './constraints'
import { resolveEndpoints } from './constraints'
import { invalidateCompilerCache, invalidatePipelineCache } from './query/compiler/cache'
import type { ValidatorMap } from './mutation/validation'

/**
 * Options for creating a graph instance.
 */
export interface GraphOptions<S extends SchemaShape = SchemaShape> {
  /** Database adapter (neo4j, falkordb, memgraph, etc.) */
  adapter: GraphAdapter
  /** Custom ID generator for mutations */
  idGenerator?: IdGenerator
  /** Mutation compilation passes (InstanceModelPass, ReifyEdgesPass, etc.) */
  mutationPasses?: MutationCompilationPass[]
  /** Mutation lifecycle hooks (beforeCreate, afterCreate, etc.) */
  hooks?: MutationHooks<S>
  /** Mutation validation configuration (options + Zod validators) */
  validation?: ValidationOptions
  /** Dry-run mode - generates queries without executing */
  dryRun?: boolean | DryRunOptions
  /**
   * Operation dispatcher for method calls. Signature matches kernel.call.
   * When provided, methods on returned nodes dispatch through this function.
   */
  dispatch?: MethodDispatchFn
  /**
   * Schema metadata from codegen (the `schema` const).
   * Required for method name resolution and constraint enforcement.
   */
  schemaInfo?: MethodSchemaInfo & ConstraintSchemaInfo
}

/**
 * Transaction scope providing access to mutations and raw queries within a transaction.
 */
export interface TransactionScope<S extends SchemaShape, T extends TypeMap = UntypedMap> {
  /** Mutation API within the transaction */
  readonly mutate: MutationTransaction<S, T>
  /** Execute a raw query within the transaction */
  raw<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>
}

/**
 * Main graph interface - the public API returned by createGraph().
 *
 * Extends GraphQuery with:
 * - Mutation operations (via .mutate)
 * - Transaction support
 * - Auth-scoped graph for method dispatch
 * - Connection lifecycle management
 */
export interface Graph<S extends SchemaShape, T extends TypeMap = UntypedMap> extends GraphQuery<
  S,
  T
> {
  // ---------------------------------------------------------------------------
  // ADAPTER
  // ---------------------------------------------------------------------------

  /** The underlying database adapter */
  readonly adapter: GraphAdapter

  // ---------------------------------------------------------------------------
  // AUTH SCOPING
  // ---------------------------------------------------------------------------

  /**
   * Create an auth-scoped graph. Methods on returned nodes dispatch with this auth.
   * Lightweight — shares adapter and schema, just captures auth.
   *
   * @param auth - Auth context (opaque to the SDK, passed through to dispatch)
   */
  as(auth: unknown): Graph<S, T>

  // ---------------------------------------------------------------------------
  // MUTATION API
  // ---------------------------------------------------------------------------

  /** Access the mutation API */
  readonly mutate: GraphMutations<S, T>

  // ---------------------------------------------------------------------------
  // TRANSACTION API
  // ---------------------------------------------------------------------------

  /**
   * Execute operations within a transaction.
   *
   * - On success: auto-commits
   * - On error: auto-rollbacks and rethrows
   */
  transaction<R>(fn: (tx: TransactionScope<S, T>) => Promise<R>): Promise<R>

  // ---------------------------------------------------------------------------
  // METHOD INVOCATION
  // ---------------------------------------------------------------------------

  /**
   * Call a method on a node instance.
   * Dispatches through the kernel operation pipeline.
   *
   * @param type   - Node type name (e.g., 'Customer')
   * @param id     - Node ID
   * @param method - Method name
   * @param args   - Method arguments (optional)
   */
  call(type: string, id: string, method: string, args?: unknown): Promise<unknown>

  /**
   * Call a method on an edge instance.
   * Dispatches through the kernel operation pipeline.
   *
   * @param edgeType  - Edge type name (e.g., 'order_item')
   * @param endpoints - Named endpoint IDs (e.g., { order: 'id1', product: 'id2' })
   * @param method    - Method name
   * @param args      - Method arguments (optional)
   */
  callEdge(
    edgeType: string,
    endpoints: Record<string, string>,
    method: string,
    args?: unknown,
  ): Promise<unknown>

  /**
   * Extend the graph's schema with additional node/edge definitions.
   *
   * Mutates the schema object in-place so all internal references
   * (query builder, mutation validator, compiler) see the change immediately.
   * Invalidates compiler caches as needed.
   *
   * @param extension - New node/edge definitions to merge into the schema
   * @param options - Optional Zod validators for new types
   */
  extendSchema(extension: Partial<SchemaShape>, options?: { validators?: ValidatorMap }): void

  /**
   * Set the method dispatch function.
   *
   * Used by kernel to wire kernel.call after graph creation, resolving the
   * circular dependency where graph needs kernel.call but kernel needs graph.
   *
   * @param dispatch - Method dispatch function (typically kernel.call)
   */
  setDispatch(dispatch: MethodDispatchFn): void

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
class GraphImpl<S extends SchemaShape, T extends TypeMap = UntypedMap> implements Graph<S, T> {
  private readonly _schema: S
  private readonly _adapter: GraphAdapter
  private readonly _query: GraphQuery<S, T>
  private readonly _mutate: GraphMutations<S, T>
  private readonly _options: GraphOptions<S>
  private readonly _idGenerator: IdGenerator
  private _dispatch: MethodDispatchFn | undefined
  private readonly _schemaInfo: (MethodSchemaInfo & ConstraintSchemaInfo) | undefined
  private _auth: unknown

  constructor(schema: S, options: GraphOptions<S>) {
    this._schema = schema
    this._adapter = options.adapter
    this._options = options
    this._idGenerator = options.idGenerator ?? defaultIdGenerator
    this._dispatch = options.dispatch
    this._schemaInfo = options.schemaInfo
    this._auth = undefined

    // Create query implementation with adapter bridge
    const queryExecutor = createQueryExecutorBridge(this._adapter)
    this._query = new GraphQueryImpl<S, T>(schema, queryExecutor)

    // Create mutation implementation with adapter bridge
    const mutationExecutor = createMutationExecutorBridge(this._adapter)
    this._mutate = new GraphMutationsImpl<S, T>(schema, mutationExecutor, {
      idGenerator: options.idGenerator,
      mutationPasses: options.mutationPasses,
      hooks: options.hooks,
      validation: options.validation,
      dryRun: options.dryRun,
    })
  }

  /**
   * Used by kernel-boot to wire kernel.call after kernel creation.
   */
  setDispatch(dispatch: MethodDispatchFn): void {
    this._dispatch = dispatch
  }

  // ---------------------------------------------------------------------------
  // AUTH SCOPING
  // ---------------------------------------------------------------------------

  as(auth: unknown): Graph<S, T> {
    const scoped = Object.create(this) as GraphImpl<S, T>
    scoped._auth = auth
    return scoped
  }

  /** Internal: dispatch + auth for enrichment and method calls */
  get _methodDispatch(): { dispatch: MethodDispatchFn; auth: unknown } | undefined {
    if (!this._dispatch || this._auth === undefined) return undefined
    return { dispatch: this._dispatch, auth: this._auth }
  }

  // ---------------------------------------------------------------------------
  // SCHEMA & EXECUTOR ACCESS
  // ---------------------------------------------------------------------------

  get adapter(): GraphAdapter {
    return this._adapter
  }

  get schema(): S {
    return this._schema
  }

  get executor(): QueryExecutor | null {
    return this._query.executor
  }

  // ---------------------------------------------------------------------------
  // QUERY API (delegate to GraphQueryImpl)
  // ---------------------------------------------------------------------------

  node<N extends NodeLabels<S>>(
    label: N,
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T> {
    return this._query.node(label)
  }

  nodeById(
    id: string,
  ): SingleNodeBuilder<S, NodeLabels<S>, Record<string, never>, Record<string, never>, T> {
    return this._query.nodeById(id)
  }

  nodeByIdWithLabel<N extends NodeLabels<S>>(
    label: N,
    id: string,
  ): SingleNodeBuilder<S, N, Record<string, never>, Record<string, never>, T> {
    return this._query.nodeByIdWithLabel(label, id)
  }

  edge<E extends EdgeTypes<S>>(
    edgeType: E,
  ): EdgeBuilder<S, E, Record<string, never>, Record<string, never>, T> {
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
    direction?: 'out' | 'out' | 'both'
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
    ...queries: CollectionBuilder<S, N, any, any, T>[]
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T> {
    return this._query.intersect(...queries)
  }

  union<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any, any, T>[]
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T> {
    return this._query.union(...queries)
  }

  unionAll<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any, any, T>[]
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T> {
    return this._query.unionAll(...queries)
  }

  // ---------------------------------------------------------------------------
  // MUTATION API
  // ---------------------------------------------------------------------------

  get mutate(): GraphMutations<S, T> {
    return this._mutate
  }

  // ---------------------------------------------------------------------------
  // TRANSACTION API
  // ---------------------------------------------------------------------------

  async transaction<R>(fn: (tx: TransactionScope<S, T>) => Promise<R>): Promise<R> {
    return this._adapter.transaction<R>(async (txCtx: TransactionContext) => {
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
          return innerFn({
            run<X>(q: string, p: Record<string, unknown>): Promise<X[]> {
              return txCtx.run<X>(q, p)
            },
          })
        },
      }

      const txMutate: MutationTransaction<S, T> = new GraphMutationsImpl<S, T>(
        this._schema,
        txMutationExecutor,
        {
          idGenerator: this._options.idGenerator,
          mutationPasses: this._options.mutationPasses,
          hooks: this._options.hooks,
          validation: this._options.validation,
        },
      )

      const scope: TransactionScope<S, T> = {
        mutate: txMutate,
        raw: <R>(cypher: string, params?: Record<string, unknown>): Promise<R[]> => {
          return txCtx.run<R>(cypher, params)
        },
      }

      return fn(scope)
    })
  }

  // ---------------------------------------------------------------------------
  // METHOD INVOCATION
  // ---------------------------------------------------------------------------

  async call(type: string, id: string, method: string, args?: unknown): Promise<unknown> {
    if (!this._dispatch || this._auth === undefined) {
      throw new MethodNotDispatchedError(type, method)
    }

    let row: { n: Record<string, unknown> } | undefined
    const classId = this._schema.classRefs?.[type]
    if (classId) {
      ;[row] = await this._adapter.query<{ n: Record<string, unknown> }>(
        `MATCH (n:Node {id: $id})-[:instance_of]->(cls:Node {id: $classId}) RETURN n`,
        { id, classId },
      )
    } else {
      ;[row] = await this._adapter.query<{ n: Record<string, unknown> }>(
        `MATCH (n:${type} {id: $id}) RETURN n`,
        { id },
      )
    }
    if (!row) throw new Error(`${type} not found`)

    const { id: nodeId, ...props } = row.n
    return this._dispatch(`${type}.${method}`, this._auth, args ?? undefined, {
      id: (nodeId as string) ?? id,
      ...props,
    })
  }

  async callEdge(
    edgeType: string,
    endpoints: Record<string, string>,
    method: string,
    args?: unknown,
  ): Promise<unknown> {
    if (!this._dispatch || this._auth === undefined) {
      throw new MethodNotDispatchedError(edgeType, method)
    }
    if (!this._schemaInfo) throw new Error('schemaInfo required for callEdge()')

    const resolved = resolveEndpoints(edgeType, endpoints, this._schemaInfo)
    const [row] = await this._adapter.query<{ r: Record<string, unknown> }>(
      `MATCH (a {id: $from})-[r:${edgeType}]->(b {id: $to}) RETURN r`,
      { from: resolved.from, to: resolved.to },
    )
    if (!row) throw new Error(`${edgeType} edge not found`)

    return this._dispatch(`${edgeType}.${method}`, this._auth, args ?? undefined, {
      id: Object.values(resolved.mapping).join(':'),
      ...row.r,
      ...resolved.mapping,
    })
  }

  // ---------------------------------------------------------------------------
  // RAW QUERY
  // ---------------------------------------------------------------------------

  async raw<R>(cypher: string, params?: Record<string, unknown>): Promise<R[]> {
    return this._query.raw<R>(cypher, params)
  }

  // ---------------------------------------------------------------------------
  // SCHEMA EXTENSION
  // ---------------------------------------------------------------------------

  extendSchema(extension: Partial<SchemaShape>, options?: { validators?: ValidatorMap }): void {
    // 1. Merge new definitions into the shared schema object in-place
    const { pipelineStale } = mergeSchemaExtension(this._schema, extension)

    // 2. Invalidate compiler caches so they rebuild with the updated schema
    invalidateCompilerCache(this._schema)
    if (pipelineStale) {
      invalidatePipelineCache(this._schema)
    }

    // 3. Extend Zod validators if provided
    if (options?.validators && Object.keys(options.validators).length > 0) {
      ;(this._mutate as unknown as GraphMutationsImpl<S>).extendValidators(options.validators)
    }
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

/** Create a graph instance. Connects eagerly (fail-fast). */
export async function createGraph<S extends SchemaShape, T extends TypeMap = UntypedMap>(
  schema: S,
  options: GraphOptions<S>,
): Promise<Graph<S, T>> {
  await options.adapter.connect()
  return new GraphImpl<S, T>(schema, options)
}
