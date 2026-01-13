/**
 * Graph Query Entry Point
 *
 * Main entry class for building graph queries and mutations.
 */

import { CollectionBuilder } from './collection'
import { SingleNodeBuilder } from './single-node'
import { type PathBuilder } from './path'
import { EdgeBuilder } from './edge'
import { QueryAST, createEdgeProjection } from '../ast'
import type { AnySchema, NodeLabels, EdgeTypes } from '../schema'
import type { ConnectionConfig } from '../executor'
import type {
  GraphMutations,
  IdGenerator,
  MutationTemplateProvider,
  MutationExecutor,
} from '../mutation'
import { GraphMutationsImpl } from '../mutation'
import type { QueryCompilerProvider } from '../compiler'

/**
 * Interface for executing raw queries.
 */
export interface RawQueryExecutor {
  run<T>(query: string, params?: Record<string, unknown>): Promise<T[]>
}

/**
 * Interface for executing compiled queries.
 * Must be provided by the database adapter.
 */
export interface QueryExecutor {
  /** Execute a query and return multiple results
   * @param query - The compiled query string (e.g., Cypher)
   * @param params - Query parameters
   * @param ast - Optional AST for direct execution (used by in-memory implementations)
   */
  run<T>(query: string, params?: Record<string, unknown>, ast?: QueryAST): Promise<T[]>
}

/**
 * Configuration for custom query compiler.
 */
export interface QueryCompilerConfig {
  /** Custom compiler provider (defaults to Cypher) */
  provider?: QueryCompilerProvider
}

/**
 * Extended connection config with mutation options.
 */
export interface GraphConfig extends ConnectionConfig {
  /** Custom ID generator for mutations */
  idGenerator?: IdGenerator
  /** Query executor (provided by database adapter) */
  queryExecutor?: QueryExecutor
  /** Mutation executor (provided by database adapter) */
  mutationExecutor?: MutationExecutor
  /** Custom mutation template provider (defaults to Cypher) */
  mutationTemplates?: MutationTemplateProvider
  /** Raw query executor (for escape hatch queries) */
  rawExecutor?: RawQueryExecutor
  /** Query compiler configuration */
  compiler?: QueryCompilerConfig
}

/**
 * Configuration for creating a graph with custom executors.
 * Use this when you have your own query/mutation executors and don't need a connection URI.
 */
export interface ExecutorConfig {
  /** Query executor (required) */
  queryExecutor: QueryExecutor
  /** Mutation executor (required) */
  mutationExecutor: MutationExecutor
  /** Custom ID generator for mutations */
  idGenerator?: IdGenerator
  /** Custom mutation template provider (defaults to Cypher) */
  mutationTemplates?: MutationTemplateProvider
  /** Raw query executor (for escape hatch queries) */
  rawExecutor?: RawQueryExecutor
  /** Query compiler configuration */
  compiler?: QueryCompilerConfig
}

/**
 * Main entry point for building graph queries and mutations.
 *
 * @example
 * ```typescript
 * const graph = createGraph(schema, { uri: 'bolt://localhost:7687' });
 *
 * // Queries
 * const users = await graph.node('user').execute();
 * const user = await graph.nodeById('user', '123').execute();
 *
 * // Mutations
 * const newUser = await graph.mutate.create('user', { name: 'John' });
 * await graph.mutate.link('authored', newUser.id, postId);
 * ```
 */
export class GraphQuery<S extends AnySchema> {
  private readonly _schema: S
  private readonly _mutate: GraphMutations<S> | null
  private readonly _rawExecutor: RawQueryExecutor | null
  private readonly _queryExecutor: QueryExecutor | null

  constructor(schema: S, config: GraphConfig) {
    this._schema = schema

    // Initialize query executor
    this._queryExecutor = config.queryExecutor ?? null

    // Initialize mutations if executor is provided
    if (config.mutationExecutor) {
      this._mutate = new GraphMutationsImpl(schema, config.mutationExecutor, {
        idGenerator: config.idGenerator,
        templates: config.mutationTemplates,
      })
    } else {
      this._mutate = null
    }

    // Initialize raw executor
    this._rawExecutor = config.rawExecutor ?? null
  }

  /**
   * Get the query executor (for internal use by builders).
   * @internal
   */
  get queryExecutor(): QueryExecutor | null {
    return this._queryExecutor
  }

  // ===========================================================================
  // QUERY API
  // ===========================================================================

  /**
   * Start a query for nodes of a given label.
   */
  node<N extends NodeLabels<S>>(label: N): CollectionBuilder<S, N, Record<string, never>> {
    const ast = new QueryAST().addMatch(label as string)
    return new CollectionBuilder(ast, this._schema, {}, {}, this._queryExecutor)
  }

  /**
   * Get a single node by ID with a known label.
   */
  nodeByIdWithLabel<N extends NodeLabels<S>>(
    label: N,
    id: string,
  ): SingleNodeBuilder<S, N, Record<string, never>> {
    return this.node(label).byId(id)
  }

  /**
   * Get a single node by ID without specifying its label.
   */
  nodeById(id: string): SingleNodeBuilder<S, NodeLabels<S>, Record<string, never>> {
    const ast = new QueryAST().addMatchById(id)
    return new SingleNodeBuilder(ast, this._schema, {}, {}, this._queryExecutor)
  }

  /**
   * Start an edge-centric query.
   */
  edge<E extends EdgeTypes<S>>(
    edgeType: E,
  ): EdgeBuilder<S, E, Record<string, never>, Record<string, never>> {
    const ast = new QueryAST()
    const projection = createEdgeProjection('e0', 'edgeCollection')
    const newAst = ast.setProjection(projection)
    return new EdgeBuilder(newAst, this._schema, edgeType, {}, {}, this._queryExecutor)
  }

  /**
   * Intersect multiple queries (nodes that appear in ALL queries).
   * Note: Cypher doesn't have native INTERSECT - this uses pattern matching.
   *
   * @example
   * ```typescript
   * // Users who are both active AND admins
   * const activeAdmins = await graph.intersect(
   *   graph.node('user').where('status', 'eq', 'active'),
   *   graph.node('user').where('role', 'eq', 'admin')
   * ).execute()
   * ```
   */
  intersect<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any>[]
  ): CollectionBuilder<S, N, Record<string, never>> {
    if (queries.length < 2) {
      throw new Error('intersect() requires at least 2 queries')
    }

    // Create a branch AST with all queries
    const baseAst = new QueryAST()
    const branchAst = baseAst.addBranch({
      operator: 'intersect',
      branches: queries.map((q) => q.ast),
      distinct: true,
    })

    return new CollectionBuilder(branchAst, this._schema, {}, {}, this._queryExecutor)
  }

  /**
   * Union multiple queries (nodes that appear in ANY query).
   *
   * @example
   * ```typescript
   * // Users who are either active OR admins
   * const activeOrAdmins = await graph.union(
   *   graph.node('user').where('status', 'eq', 'active'),
   *   graph.node('user').where('role', 'eq', 'admin')
   * ).execute()
   *
   * // Union with distinct (default)
   * const results = await graph.union(query1, query2).execute()
   * ```
   */
  union<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any>[]
  ): CollectionBuilder<S, N, Record<string, never>> {
    if (queries.length < 2) {
      throw new Error('union() requires at least 2 queries')
    }

    // Create a branch AST with all queries
    const baseAst = new QueryAST()
    const branchAst = baseAst.addBranch({
      operator: 'union',
      branches: queries.map((q) => q.ast),
      distinct: true,
    })

    return new CollectionBuilder(branchAst, this._schema, {}, {}, this._queryExecutor)
  }

  /**
   * Union multiple queries without removing duplicates (UNION ALL).
   *
   * @example
   * ```typescript
   * // All users from both queries, including duplicates
   * const all = await graph.unionAll(query1, query2).execute()
   * ```
   */
  unionAll<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any>[]
  ): CollectionBuilder<S, N, Record<string, never>> {
    if (queries.length < 2) {
      throw new Error('unionAll() requires at least 2 queries')
    }

    const baseAst = new QueryAST()
    const branchAst = baseAst.addBranch({
      operator: 'union',
      branches: queries.map((q) => q.ast),
      distinct: false, // UNION ALL
    })

    return new CollectionBuilder(branchAst, this._schema, {}, {}, this._queryExecutor)
  }

  /**
   * Find the shortest path between two nodes.
   */
  shortestPath<
    NFrom extends NodeLabels<S>,
    NTo extends NodeLabels<S>,
    E extends EdgeTypes<S>,
  >(_config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
  }): PathBuilder<S, NFrom, NTo> {
    throw new Error('Not implemented')
  }

  /**
   * Find all shortest paths between two nodes.
   */
  allShortestPaths<
    NFrom extends NodeLabels<S>,
    NTo extends NodeLabels<S>,
    E extends EdgeTypes<S>,
  >(_config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
  }): PathBuilder<S, NFrom, NTo> {
    throw new Error('Not implemented')
  }

  /**
   * Find all paths between two nodes up to a maximum depth.
   */
  allPaths<
    NFrom extends NodeLabels<S>,
    NTo extends NodeLabels<S>,
    E extends EdgeTypes<S>,
  >(_config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    maxHops: number
    direction?: 'out' | 'in' | 'both'
  }): PathBuilder<S, NFrom, NTo> {
    throw new Error('Not implemented')
  }

  /**
   * Execute a raw Cypher query.
   *
   * @example
   * ```typescript
   * // Complex query that DSL can't express
   * const results = await graph.raw<{ user: User; score: number }>(`
   *   MATCH (u:user)-[r:follows*2..3]->(target:user {id: $targetId})
   *   WITH u, count(r) as score
   *   RETURN u as user, score
   *   ORDER BY score DESC
   *   LIMIT 10
   * `, { targetId: '123' });
   * ```
   */
  async raw<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    if (!this._rawExecutor) {
      throw new Error('Raw queries not available: no rawExecutor provided in config')
    }
    return this._rawExecutor.run<T>(cypher, params)
  }

  // ===========================================================================
  // MUTATION API
  // ===========================================================================

  /**
   * Access the mutation API.
   *
   * @example
   * ```typescript
   * // Create a node
   * const user = await graph.mutate.create('user', { name: 'John' });
   *
   * // Create with link
   * const post = await graph.mutate.createChild('post', userId, { title: 'Hello' });
   *
   * // Transaction
   * await graph.mutate.transaction(async (tx) => {
   *   const thread = await tx.create('thread', { title: 'Discussion' });
   *   await tx.createChild('message', thread.id, { content: 'First!' });
   * });
   * ```
   */
  get mutate(): GraphMutations<S> {
    if (!this._mutate) {
      throw new Error('Mutations not available: no mutationExecutor provided in config')
    }
    return this._mutate
  }

  // ===========================================================================
  // SCHEMA ACCESS
  // ===========================================================================

  /**
   * Access the schema definition.
   */
  get schema(): S {
    return this._schema
  }

  /**
   * Validate data against a node schema.
   */
  validateNode<N extends NodeLabels<S>>(
    _label: N,
    _data: unknown,
  ): import('zod').SafeParseReturnType<unknown, import('../schema').NodeProps<S, N>> {
    throw new Error('Not implemented')
  }
}

/**
 * Create a new GraphQuery instance.
 *
 * @param schema - The graph schema definition
 * @param config - Database connection and mutation configuration
 * @returns A GraphQuery instance for building queries and mutations
 *
 * @example
 * ```typescript
 * import { createGraph, defineSchema, node, edge } from 'typegraph';
 * import { z } from 'zod';
 *
 * const schema = defineSchema({
 *   nodes: {
 *     user: node({ properties: { name: z.string() } }),
 *     post: node({ properties: { title: z.string() } }),
 *   },
 *   edges: {
 *     authored: edge({
 *       from: 'user',
 *       to: 'post',
 *       cardinality: { outbound: 'many', inbound: 'one' },
 *     }),
 *   },
 *   hierarchy: { defaultEdge: 'hasParent', direction: 'up' },
 * });
 *
 * const graph = createGraph(schema, {
 *   uri: 'bolt://localhost:7687',
 *   mutationExecutor: myNeo4jAdapter,
 * });
 *
 * // Queries
 * const posts = await graph.node('post').execute();
 *
 * // Mutations
 * const user = await graph.mutate.create('user', { name: 'John' });
 * ```
 */
export function createGraph<S extends AnySchema>(schema: S, config: GraphConfig): GraphQuery<S> {
  return new GraphQuery(schema, config)
}

/**
 * Create a new GraphQuery instance with custom executors.
 *
 * Use this when you have your own query/mutation executors (e.g., in-memory, custom adapters)
 * and don't need to connect via a URI.
 *
 * @param schema - The graph schema definition
 * @param config - Executor configuration (no URI required)
 * @returns A GraphQuery instance for building queries and mutations
 *
 * @example
 * ```typescript
 * import { createGraphWithExecutors, defineSchema, node, edge } from 'typegraph';
 *
 * const graph = createGraphWithExecutors(schema, {
 *   queryExecutor: {
 *     run: async (cypher, params) => myCustomQuery(cypher, params)
 *   },
 *   mutationExecutor: {
 *     run: async (cypher, params) => myCustomMutation(cypher, params)
 *   }
 * });
 * ```
 */
export function createGraphWithExecutors<S extends AnySchema>(
  schema: S,
  config: ExecutorConfig,
): GraphQuery<S> {
  return new GraphQuery(schema, {
    ...config,
    uri: '', // Not used when executors are provided directly
  })
}
