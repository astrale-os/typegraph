/**
 * Schema Builder Functions
 *
 * Fluent API for defining graph schemas with full type inference.
 */

import { z } from 'zod'
import type {
  SchemaDefinition,
  NodeDefinition,
  EdgeDefinition,
  Cardinality,
  IndexConfig,
  HierarchyConfig,
} from './types'

// =============================================================================
// NODE BUILDER
// =============================================================================

/**
 * Configuration options for node definition.
 */
export interface NodeConfig<TProps extends z.ZodRawShape> {
  /**
   * Zod shape defining node properties.
   * Do NOT include `id` - it is implicit on all nodes.
   */
  properties: TProps

  /** Properties to index (string keys or full config) */
  indexes?: Array<keyof TProps | (IndexConfig & { property: keyof TProps })>

  /** Optional description */
  description?: string
}

/**
 * Creates a node definition.
 *
 * All nodes automatically have an `id: string` property that is indexed.
 * You do not need to (and should not) declare it.
 *
 * @example
 * ```typescript
 * const userNode = node({
 *   properties: {
 *     email: z.string().email(),
 *     name: z.string(),
 *     createdAt: z.date(),
 *   },
 *   indexes: ['email', { property: 'name', type: 'fulltext' }],
 * });
 * ```
 */
export function node<TProps extends z.ZodRawShape>(
  config: NodeConfig<TProps>,
): NodeDefinition<TProps> {
  return {
    _type: 'node',
    properties: z.object(config.properties),
    indexes: (config.indexes ?? []) as NodeDefinition<TProps>['indexes'],
    description: config.description,
  }
}

// =============================================================================
// EDGE BUILDER
// =============================================================================

/**
 * Configuration options for edge definition.
 */
export interface EdgeConfig<
  TFrom extends string | readonly string[],
  TTo extends string | readonly string[],
  TProps extends z.ZodRawShape = Record<string, never>,
  TOutbound extends Cardinality = Cardinality,
  TInbound extends Cardinality = Cardinality,
> {
  /** Source node label(s) */
  from: TFrom

  /** Target node label(s) */
  to: TTo

  /**
   * Cardinality constraints with clear directional semantics.
   *
   * - outbound: How many edges can LEAVE from one source node
   * - inbound: How many edges can ARRIVE at one target node
   */
  cardinality: {
    outbound: TOutbound
    inbound: TInbound
  }

  /**
   * Optional edge properties.
   * Do NOT include `id` - it is implicit on all edges.
   */
  properties?: TProps

  /** Properties to index (string keys or full config) */
  indexes?: Array<keyof TProps | (IndexConfig & { property: keyof TProps })>

  /** Optional description */
  description?: string
}

/**
 * Creates an edge definition.
 *
 * All edges automatically have an `id: string` property.
 * You do not need to (and should not) declare it.
 *
 * @example
 * ```typescript
 * const friendsEdge = edge({
 *   from: 'user',
 *   to: 'user',
 *   // outbound: one user can have many friends
 *   // inbound: one user can be friended by many
 *   cardinality: { outbound: 'many', inbound: 'many' },
 *   properties: {
 *     since: z.date(),
 *     closeness: z.enum(['close', 'acquaintance']),
 *   },
 * });
 *
 * // Edge with no properties (just represents a relationship)
 * const likesEdge = edge({
 *   from: 'user',
 *   to: 'post',
 *   // outbound: one user can like many posts
 *   // inbound: one post can be liked by many users
 *   cardinality: { outbound: 'many', inbound: 'many' },
 * });
 *
 * // Parent-child hierarchy
 * const parentEdge = edge({
 *   from: 'node',
 *   to: 'node',
 *   // outbound: one node has at most one parent (optional)
 *   // inbound: one node can have many children
 *   cardinality: { outbound: 'optional', inbound: 'many' },
 * });
 * ```
 */
export function edge<
  TFrom extends string | readonly string[],
  TTo extends string | readonly string[],
  TProps extends z.ZodRawShape = Record<string, never>,
  TOutbound extends Cardinality = Cardinality,
  TInbound extends Cardinality = Cardinality,
>(
  config: EdgeConfig<TFrom, TTo, TProps, TOutbound, TInbound>,
): EdgeDefinition<TFrom, TTo, TProps, TOutbound, TInbound> {
  return {
    _type: 'edge',
    from: config.from,
    to: config.to,
    cardinality: config.cardinality,
    properties: z.object(config.properties ?? ({} as TProps)),
    indexes: config.indexes as EdgeDefinition<TFrom, TTo, TProps, TOutbound, TInbound>['indexes'],
    description: config.description,
  }
}

// =============================================================================
// SCHEMA BUILDER
// =============================================================================

/**
 * Configuration for schema definition.
 */
export interface SchemaConfig<
  TNodes extends Record<string, NodeDefinition>,
  TEdges extends Record<
    string,
    EdgeDefinition<string | readonly string[], string | readonly string[], z.ZodRawShape>
  >,
> {
  nodes: TNodes
  edges: TEdges
  hierarchy?: HierarchyConfig<keyof TEdges & string>
  version?: string
  meta?: {
    name?: string
    description?: string
  }
}

/**
 * Creates a complete schema definition with validation.
 *
 * Validates:
 * - All edge from/to references exist in nodes
 * - No duplicate node labels or edge types
 * - Index properties exist in node properties
 *
 * @example
 * ```typescript
 * const schema = defineSchema({
 *   nodes: {
 *     user: node({ ... }),
 *     post: node({ ... }),
 *   },
 *   edges: {
 *     authored: edge({ from: 'user', to: 'post', ... }),
 *     likes: edge({ from: 'user', to: 'post', ... }),
 *   },
 * });
 * ```
 */
export function defineSchema<
  TNodes extends Record<string, NodeDefinition>,
  TEdges extends Record<
    string,
    EdgeDefinition<string | readonly string[], string | readonly string[], z.ZodRawShape>
  >,
>(config: SchemaConfig<TNodes, TEdges>): SchemaDefinition<TNodes, TEdges> {
  const nodeLabels = new Set(Object.keys(config.nodes))

  // Validate edge references
  for (const [edgeName, edgeDef] of Object.entries(config.edges)) {
    const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
    const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]

    for (const from of fromLabels) {
      if (!nodeLabels.has(from)) {
        throw new Error(`Edge '${edgeName}' references unknown source node '${from}'`)
      }
    }

    for (const to of toLabels) {
      if (!nodeLabels.has(to)) {
        throw new Error(`Edge '${edgeName}' references unknown target node '${to}'`)
      }
    }
  }

  // Validate hierarchy edge exists
  if (config.hierarchy) {
    if (!config.edges[config.hierarchy.defaultEdge]) {
      throw new Error(
        `Hierarchy defaultEdge '${config.hierarchy.defaultEdge}' does not exist in edges`,
      )
    }
  }

  return {
    nodes: config.nodes,
    edges: config.edges,
    hierarchy: config.hierarchy,
    version: config.version,
    meta: config.meta,
  }
}
