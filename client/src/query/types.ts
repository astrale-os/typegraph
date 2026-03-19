/**
 * Query Type Definitions
 *
 * Interfaces for the query layer: GraphQuery, QueryExecutor.
 */

import type { SchemaShape, TypeMap, UntypedMap } from '../schema'
import type { NodeLabels, EdgeTypes } from '../inference'
import type { QueryAST } from './ast'
import type { CollectionBuilder } from './collection'
import type { SingleNodeBuilder } from './single-node'
import type { EdgeBuilder } from './edge'
import type { PathBuilder } from './path'

/**
 * Interface for executing compiled queries.
 * Adapters provide an implementation of this interface.
 */
export interface QueryExecutor {
  /**
   * Execute a query and return results.
   *
   * @param query - The compiled query string (e.g., Cypher)
   * @param params - Query parameters
   * @param ast - Optional AST for direct execution (used by in-memory implementations)
   */
  run<T>(query: string, params?: Record<string, unknown>, ast?: QueryAST): Promise<T[]>
}

/**
 * Query API interface.
 *
 * Defines the entry points for building graph queries.
 * Implemented by GraphQueryImpl.
 */
export interface GraphQuery<S extends SchemaShape, T extends TypeMap = UntypedMap> {
  /** The schema definition */
  readonly schema: S

  /** The query executor */
  readonly executor: QueryExecutor | null

  // ---------------------------------------------------------------------------
  // NODE QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Start a query for nodes of a given label.
   *
   * @example
   * ```typescript
   * const users = await graph.node('user').execute()
   * const activeUsers = await graph.node('user').where({ status: 'active' }).execute()
   * ```
   */
  node<N extends NodeLabels<S>>(
    label: N,
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T>

  /**
   * Get a single node by ID with a known label.
   *
   * @example
   * ```typescript
   * const user = await graph.nodeByIdWithLabel('user', 'user_123').execute()
   * ```
   */
  nodeByIdWithLabel<N extends NodeLabels<S>>(
    label: N,
    id: string,
  ): SingleNodeBuilder<S, N, Record<string, never>, Record<string, never>, T>

  /**
   * Get a single node by ID without specifying its label.
   *
   * @example
   * ```typescript
   * const node = await graph.nodeById('user_123').execute()
   * ```
   */
  nodeById(
    id: string,
  ): SingleNodeBuilder<S, NodeLabels<S>, Record<string, never>, Record<string, never>, T>

  // ---------------------------------------------------------------------------
  // EDGE QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Start an edge-centric query.
   *
   * @example
   * ```typescript
   * const authoredEdges = await graph.edge('authored').execute()
   * ```
   */
  edge<E extends EdgeTypes<S>>(
    edgeType: E,
  ): EdgeBuilder<S, E, Record<string, never>, Record<string, never>, T>

  // ---------------------------------------------------------------------------
  // SET OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * Intersect multiple queries (nodes that appear in ALL queries).
   *
   * @example
   * ```typescript
   * const activeAdmins = await graph.intersect(
   *   graph.node('user').where({ status: 'active' }),
   *   graph.node('user').where({ role: 'admin' })
   * ).execute()
   * ```
   */

  intersect<N extends NodeLabels<S>>(
    // oxlint-disable-next-line no-explicit-any
    ...queries: CollectionBuilder<S, N, any, any, T>[]
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T>

  /**
   * Union multiple queries (nodes that appear in ANY query).
   *
   * @example
   * ```typescript
   * const activeOrAdmins = await graph.union(
   *   graph.node('user').where({ status: 'active' }),
   *   graph.node('user').where({ role: 'admin' })
   * ).execute()
   * ```
   */

  union<N extends NodeLabels<S>>(
    // oxlint-disable-next-line no-explicit-any
    ...queries: CollectionBuilder<S, N, any, any, T>[]
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T>

  /**
   * Union multiple queries without removing duplicates (UNION ALL).
   *
   * @example
   * ```typescript
   * const all = await graph.unionAll(query1, query2).execute()
   * ```
   */

  unionAll<N extends NodeLabels<S>>(
    // oxlint-disable-next-line no-explicit-any
    ...queries: CollectionBuilder<S, N, any, any, T>[]
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T>

  // ---------------------------------------------------------------------------
  // PATH QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Find the shortest path between two nodes.
   *
   * @example
   * ```typescript
   * const path = await graph.shortestPath({
   *   from: { label: 'user', id: 'user_1' },
   *   to: { label: 'user', id: 'user_2' },
   *   via: 'follows',
   *   direction: 'out'
   * }).execute()
   * ```
   */
  shortestPath<
    NFrom extends NodeLabels<S>,
    NTo extends NodeLabels<S>,
    E extends EdgeTypes<S>,
  >(config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
  }): PathBuilder<S, NFrom, NTo>

  /**
   * Find all shortest paths between two nodes.
   *
   * @example
   * ```typescript
   * const paths = await graph.allShortestPaths({
   *   from: { label: 'user', id: 'user_1' },
   *   to: { label: 'user', id: 'user_2' },
   *   via: 'follows'
   * }).execute()
   * ```
   */
  allShortestPaths<
    NFrom extends NodeLabels<S>,
    NTo extends NodeLabels<S>,
    E extends EdgeTypes<S>,
  >(config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
  }): PathBuilder<S, NFrom, NTo>

  /**
   * Find all paths between two nodes (up to a maximum depth).
   *
   * @example
   * ```typescript
   * const paths = await graph.allPaths({
   *   from: { label: 'user', id: 'user_1' },
   *   to: { label: 'user', id: 'user_2' },
   *   via: 'follows',
   *   maxDepth: 5
   * }).execute()
   * ```
   */
  allPaths<NFrom extends NodeLabels<S>, NTo extends NodeLabels<S>, E extends EdgeTypes<S>>(config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
    maxDepth?: number
  }): PathBuilder<S, NFrom, NTo>

  // ---------------------------------------------------------------------------
  // RAW QUERY
  // ---------------------------------------------------------------------------

  /**
   * Execute a raw Cypher query.
   *
   * @example
   * ```typescript
   * const results = await graph.raw<{ user: User; score: number }>(`
   *   MATCH (u:user)-[r:follows*2..3]->(target:user {id: $targetId})
   *   WITH u, count(r) as score
   *   RETURN u as user, score
   *   ORDER BY score DESC
   *   LIMIT 10
   * `, { targetId: '123' })
   * ```
   */
  raw<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>
}
