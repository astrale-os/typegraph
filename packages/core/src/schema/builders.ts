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
  SinglePropertyIndex,
  CompositeIndex,
  HierarchyConfig,
} from './types'
import { SchemaValidationError } from '../errors'

// =============================================================================
// INDEX VALIDATION
// =============================================================================

/**
 * Index entry type for validation (matches what users pass in).
 */
type IndexEntry =
  | string
  | { property: string; type?: string; name?: string }
  | { properties: readonly string[]; type?: string; order?: Record<string, string>; name?: string }

/**
 * Validates index configurations in node/edge definitions.
 *
 * Checks:
 * - Property names exist in the definition
 * - Fulltext indexes are not composite
 * - Composite indexes have at least 2 properties
 * - Order properties match index properties (if specified)
 *
 * @throws SchemaValidationError with educational messages including valid options
 */
function validateIndexes(
  indexes: readonly IndexEntry[] | undefined,
  propertyNames: string[],
  context: string,
): void {
  if (!indexes) return

  for (const idx of indexes) {
    // Simple string index: 'email'
    if (typeof idx === 'string') {
      if (!propertyNames.includes(idx)) {
        throw new SchemaValidationError(
          `Index property '${idx}' not found in ${context}. Available: ${propertyNames.join(', ')}`,
          'indexes',
          propertyNames.join(', '),
          idx,
        )
      }
      continue
    }

    // Single property index: { property: 'email', type: 'unique' }
    if ('property' in idx && typeof idx.property === 'string') {
      if (!propertyNames.includes(idx.property)) {
        throw new SchemaValidationError(
          `Index property '${idx.property}' not found in ${context}. Available: ${propertyNames.join(', ')}`,
          'indexes',
          propertyNames.join(', '),
          idx.property,
        )
      }
      continue
    }

    // Composite index: { properties: ['firstName', 'lastName'], type: 'btree' }
    if ('properties' in idx && Array.isArray(idx.properties)) {
      // Validate fulltext not allowed for composite
      if (idx.type === 'fulltext') {
        throw new SchemaValidationError(
          'Fulltext indexes cannot be composite. Use a single property instead.',
          'indexes',
          'btree or unique',
          'fulltext',
        )
      }

      // Validate at least 2 properties
      if (idx.properties.length < 2) {
        throw new SchemaValidationError(
          `Composite indexes require at least 2 properties. Use simple syntax for single property: '${idx.properties[0] ?? 'property'}'`,
          'indexes',
          '2 or more properties',
          String(idx.properties.length),
        )
      }

      // Validate all properties exist
      for (const prop of idx.properties) {
        if (!propertyNames.includes(prop)) {
          throw new SchemaValidationError(
            `Composite index property '${prop}' not found in ${context}. Available: ${propertyNames.join(', ')}`,
            'indexes',
            propertyNames.join(', '),
            prop,
          )
        }
      }

      // Validate order properties match index properties
      if (idx.order) {
        for (const orderProp of Object.keys(idx.order)) {
          if (!idx.properties.includes(orderProp)) {
            throw new SchemaValidationError(
              `Order property '${orderProp}' not in composite index properties. Index properties: ${idx.properties.join(', ')}`,
              'indexes',
              idx.properties.join(', '),
              orderProp,
            )
          }
        }
      }
    }
  }
}

// =============================================================================
// NODE BUILDER
// =============================================================================

/**
 * Configuration options for node definition.
 */
export interface NodeConfig<
  TProps extends z.ZodRawShape,
  TLabels extends readonly string[] = readonly string[],
> {
  /**
   * Zod shape defining node properties.
   * Do NOT include `id` - it is implicit on all nodes.
   */
  properties: TProps

  /**
   * Properties to index (in addition to `id` which is always indexed).
   *
   * Supports three formats:
   * - Simple string: `'email'`
   * - Single property config: `{ property: 'email', type: 'unique' }`
   * - Composite index: `{ properties: ['firstName', 'lastName'], type: 'btree' }`
   *
   * @example
   * ```typescript
   * indexes: [
   *   'email',                                          // Simple btree index
   *   { property: 'name', type: 'fulltext' },          // Fulltext search
   *   { properties: ['tenantId', 'email'], type: 'unique' },  // Composite unique
   * ]
   * ```
   */
  indexes?: Array<
    | keyof TProps
    | (Omit<SinglePropertyIndex, 'property'> & { property: keyof TProps })
    | (Omit<CompositeIndex, 'properties'> & { properties: readonly (keyof TProps)[] })
  >

  /** Optional description */
  description?: string

  /**
   * Node types that this node also acts as (IS-A relationship).
   * Each entry references another node type key in the schema.
   */
  labels?: TLabels
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
export function node<
  TProps extends z.ZodRawShape,
  const TLabels extends readonly string[] = readonly string[],
>(config: NodeConfig<TProps, TLabels>): NodeDefinition<TProps, TLabels> {
  // Validate index configurations
  const propertyNames = Object.keys(config.properties)
  validateIndexes(config.indexes as IndexEntry[] | undefined, propertyNames, 'node properties')

  return {
    _type: 'node',
    properties: z.object(config.properties),
    indexes: (config.indexes ?? []) as NodeDefinition<TProps, TLabels>['indexes'],
    description: config.description,
    labels: config.labels,
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

  /**
   * Properties to index (in addition to `id` which is always indexed).
   *
   * Supports three formats:
   * - Simple string: `'since'`
   * - Single property config: `{ property: 'since', type: 'btree' }`
   * - Composite index: `{ properties: ['type', 'since'], type: 'btree' }`
   */
  indexes?: Array<
    | keyof TProps
    | (Omit<SinglePropertyIndex, 'property'> & { property: keyof TProps })
    | (Omit<CompositeIndex, 'properties'> & { properties: readonly (keyof TProps)[] })
  >

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
  const TFrom extends string | readonly string[],
  const TTo extends string | readonly string[],
  TProps extends z.ZodRawShape = Record<string, never>,
  const TOutbound extends Cardinality = Cardinality,
  const TInbound extends Cardinality = Cardinality,
>(
  config: EdgeConfig<TFrom, TTo, TProps, TOutbound, TInbound>,
): EdgeDefinition<TFrom, TTo, TProps, TOutbound, TInbound> {
  const propertyNames = Object.keys(config.properties ?? {})
  validateIndexes(config.indexes as IndexEntry[] | undefined, propertyNames, 'edge properties')

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
// LABEL INHERITANCE VALIDATION
// =============================================================================

/**
 * Validates label references exist and detects cycles in label inheritance.
 *
 * @throws SchemaValidationError if a label references a non-existent node
 * @throws SchemaValidationError if circular label dependencies exist
 */
function validateLabelInheritance(
  nodes: Record<string, NodeDefinition>,
  nodeLabels: Set<string>,
): void {
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(nodeKey: string, path: string[]): void {
    if (visited.has(nodeKey)) return

    if (visiting.has(nodeKey)) {
      throw new SchemaValidationError(
        `Circular label inheritance: ${[...path, nodeKey].join(' -> ')}`,
        'labels',
      )
    }

    visiting.add(nodeKey)

    const nodeDef = nodes[nodeKey]
    for (const ref of nodeDef?.labels ?? []) {
      if (!nodeLabels.has(ref)) {
        throw new SchemaValidationError(
          `Node '${nodeKey}' references unknown label '${ref}'. Available: ${[...nodeLabels].join(', ')}`,
          'labels',
        )
      }
      visit(ref, [...path, nodeKey])
    }

    visiting.delete(nodeKey)
    visited.add(nodeKey)
  }

  for (const nodeKey of nodeLabels) {
    visit(nodeKey, [])
  }
}

// =============================================================================
// SCHEMA BUILDER
// =============================================================================

/**
 * Configuration for schema definition.
 *
 * Uses `any` in constraints to avoid TypeScript variance issues while still
 * preserving the specific types through inference.
 */
export interface SchemaConfig<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TNodes extends Record<string, NodeDefinition<any>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TEdges extends Record<string, EdgeDefinition<any, any, any, any, any>>,
> {
  nodes: TNodes
  edges: TEdges
  hierarchy?: HierarchyConfig<keyof TEdges & string>
}

/**
 * Creates a complete schema definition with validation.
 *
 * Validates:
 * - All edge from/to references exist in nodes
 * - All label references in nodes exist and form no cycles
 * - Hierarchy edge exists if specified
 *
 * @throws SchemaValidationError if label references are invalid or circular
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TNodes extends Record<string, NodeDefinition<any>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TEdges extends Record<string, EdgeDefinition<any, any, any, any, any>>,
>(config: SchemaConfig<TNodes, TEdges>): SchemaDefinition<TNodes, TEdges> {
  const nodeLabels = new Set(Object.keys(config.nodes))

  // Validate edge references
  for (const [edgeName, edgeDef] of Object.entries(config.edges)) {
    const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
    const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]

    for (const from of fromLabels) {
      if (!nodeLabels.has(from)) {
        throw new SchemaValidationError(
          `Edge '${edgeName}' references unknown source node '${from}'. Available nodes: ${[...nodeLabels].join(', ')}`,
          'from',
          [...nodeLabels].join(', '),
          from,
        )
      }
    }

    for (const to of toLabels) {
      if (!nodeLabels.has(to)) {
        throw new SchemaValidationError(
          `Edge '${edgeName}' references unknown target node '${to}'. Available nodes: ${[...nodeLabels].join(', ')}`,
          'to',
          [...nodeLabels].join(', '),
          to,
        )
      }
    }
  }

  // Validate hierarchy edge exists
  if (config.hierarchy) {
    if (!config.edges[config.hierarchy.defaultEdge]) {
      throw new SchemaValidationError(
        `Hierarchy defaultEdge '${config.hierarchy.defaultEdge}' does not exist in edges. Available edges: ${Object.keys(config.edges).join(', ')}`,
        'hierarchy.defaultEdge',
        Object.keys(config.edges).join(', '),
        config.hierarchy.defaultEdge,
      )
    }
  }

  // Validate label references exist and detect cycles
  validateLabelInheritance(config.nodes, nodeLabels)

  return {
    nodes: config.nodes,
    edges: config.edges,
    hierarchy: config.hierarchy,
  }
}
