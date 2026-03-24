/**
 * Schema Builder Functions
 *
 * Fluent API for defining graph schemas with full type inference.
 */

import { z } from 'zod'

import type { ResolvedNodes } from './inference'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TExtends extends readonly NodeDefinition<any, any>[] = readonly NodeDefinition<any, any>[],
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
   * Node definitions that this node extends (IS-A relationship).
   * Each entry is a reference to another node definition variable.
   * Resolved to string keys by defineSchema().
   *
   * @example
   * ```typescript
   * const entityNode = node({ properties: { createdAt: z.date() } })
   * const userNode = node({ properties: { email: z.string() }, extends: [entityNode] })
   * ```
   */
  extends?: TExtends
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const TExtends extends readonly NodeDefinition<any, any>[] = readonly [],
>(config: NodeConfig<TProps, TExtends>): NodeDefinition<TProps, readonly string[]> {
  // Validate index configurations
  const propertyNames = Object.keys(config.properties)
  validateIndexes(config.indexes as IndexEntry[] | undefined, propertyNames, 'node properties')

  return {
    _type: 'node',
    properties: z.object(config.properties),
    indexes: (config.indexes ?? []) as NodeDefinition<TProps>['indexes'],
    description: config.description,
    // Store raw refs for defineSchema() to resolve
    _extendsRefs: config.extends,
    // extends is populated by defineSchema() after ref resolution
    extends: undefined,
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
 * Validates extends references exist and detects cycles in inheritance.
 *
 * @throws SchemaValidationError if an extends reference is not in the schema
 * @throws SchemaValidationError if circular extends dependencies exist
 */
function validateExtendsInheritance(
  nodes: Record<string, NodeDefinition>,
  nodeKeys: Set<string>,
): void {
  const visited = new Set<string>()
  const visiting = new Set<string>()

  function visit(nodeKey: string, path: string[]): void {
    if (visited.has(nodeKey)) return

    if (visiting.has(nodeKey)) {
      throw new SchemaValidationError(
        `Circular extends inheritance: ${[...path, nodeKey].join(' -> ')}`,
        'extends',
      )
    }

    visiting.add(nodeKey)

    const nodeDef = nodes[nodeKey]
    for (const ref of nodeDef?.extends ?? []) {
      if (!nodeKeys.has(ref)) {
        throw new SchemaValidationError(
          `Node '${nodeKey}' extends unknown node '${ref}'. Available: ${[...nodeKeys].join(', ')}`,
          'extends',
        )
      }
      visit(ref, [...path, nodeKey])
    }

    visiting.delete(nodeKey)
    visited.add(nodeKey)
  }

  for (const nodeKey of nodeKeys) {
    visit(nodeKey, [])
  }
}

// =============================================================================
// PROPERTY INHERITANCE
// =============================================================================

/**
 * Collects parent Zod schemas from a node's extends hierarchy.
 * Uses DFS with visited tracking to handle diamond inheritance.
 *
 * Semantic rules:
 * - Properties merge left-to-right from extends array
 * - Grandparent properties come before parent properties
 * - Visited nodes are skipped (diamond inheritance dedup)
 */
function collectParentSchemas(
  nodeDef: NodeDefinition,
  allNodes: Record<string, NodeDefinition>,
): z.ZodObject<z.ZodRawShape>[] {
  const visited = new Set<string>()
  const schemas: z.ZodObject<z.ZodRawShape>[] = []

  function collect(extendsKeys: readonly string[] | undefined): void {
    if (!extendsKeys) return
    for (const key of extendsKeys) {
      if (visited.has(key)) continue
      visited.add(key)

      const parent = allNodes[key]
      if (!parent) continue

      // Collect grandparents first (DFS)
      collect(parent.extends)
      schemas.push(parent.properties)
    }
  }

  collect(nodeDef.extends)
  return schemas
}

/**
 * Merges inherited properties into nodes that have extends.
 * Uses shape reconstruction (not Zod .merge()) to preserve modifiers.
 *
 * Semantic rules:
 * - Child properties override parent properties (same name)
 * - Indexes are NOT inherited (explicit per-node)
 * - Modifiers (.default(), .transform()) are preserved
 */
export function mergeNodeSchemas(
  nodes: Record<string, NodeDefinition>,
): Record<string, NodeDefinition> {
  const merged: Record<string, NodeDefinition> = {}

  for (const [nodeKey, nodeDef] of Object.entries(nodes)) {
    // No extends = no inheritance
    if (!nodeDef.extends?.length) {
      merged[nodeKey] = nodeDef
      continue
    }

    const parentSchemas = collectParentSchemas(nodeDef, nodes)
    if (parentSchemas.length === 0) {
      merged[nodeKey] = nodeDef
      continue
    }

    // Shape reconstruction: parents first, then child (child overrides)
    // Type assertion needed because Zod's shape type is complex
    let mergedShape: z.ZodRawShape = {}
    for (const parentSchema of parentSchemas) {
      mergedShape = { ...mergedShape, ...(parentSchema.shape as z.ZodRawShape) }
    }
    mergedShape = { ...mergedShape, ...(nodeDef.properties.shape as z.ZodRawShape) }

    merged[nodeKey] = {
      ...nodeDef,
      properties: z.object(mergedShape),
      // Indexes are NOT inherited - keep only node's own indexes
    }
  }

  return merged
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
 * - All extends references in nodes exist and form no cycles
 * - Hierarchy edge exists if specified
 *
 * Resolves NodeDefinition references in `_extendsRefs` to string keys,
 * populating the `extends` field on each node.
 *
 * @throws SchemaValidationError if extends references are invalid or circular
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
>(config: SchemaConfig<TNodes, TEdges>): SchemaDefinition<ResolvedNodes<TNodes>, TEdges> {
  const nodeKeys = new Set(Object.keys(config.nodes))

  // Build reverse map: NodeDefinition reference -> key
  const reverseMap = new Map<NodeDefinition, string>()
  for (const [key, nodeDef] of Object.entries(config.nodes)) {
    reverseMap.set(nodeDef, key)
  }

  // Resolve _extendsRefs -> extends (string keys)
  const resolvedNodes: Record<string, NodeDefinition> = {}
  for (const [key, nodeDef] of Object.entries(config.nodes)) {
    // If node already has resolved extends (from a previous defineSchema call),
    // validate and pass through. This handles nodes from extendSchema's base.
    if (nodeDef.extends?.length) {
      for (const extKey of nodeDef.extends) {
        if (!nodeKeys.has(extKey)) {
          throw new SchemaValidationError(
            `Node '${key}' extends unknown node '${extKey}'. ` +
              `Available nodes: ${[...nodeKeys].join(', ')}`,
            'extends',
          )
        }
      }
      resolvedNodes[key] = nodeDef
      continue
    }

    // Otherwise, resolve _extendsRefs -> extends (string keys)
    const refs = nodeDef._extendsRefs ?? []
    const resolvedExtends: string[] = []

    for (const ref of refs) {
      const refKey = reverseMap.get(ref)
      if (!refKey) {
        throw new SchemaValidationError(
          `Node '${key}' extends an unknown node definition. ` +
            `Make sure all extended nodes are included in the schema's nodes record.`,
          'extends',
        )
      }
      resolvedExtends.push(refKey)
    }

    resolvedNodes[key] = {
      ...nodeDef,
      extends: resolvedExtends.length > 0 ? resolvedExtends : undefined,
    } as NodeDefinition
  }

  // Validate edge references
  for (const [edgeName, edgeDef] of Object.entries(config.edges)) {
    const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
    const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]

    for (const from of fromLabels) {
      if (!nodeKeys.has(from)) {
        throw new SchemaValidationError(
          `Edge '${edgeName}' references unknown source node '${from}'. Available nodes: ${[...nodeKeys].join(', ')}`,
          'from',
          [...nodeKeys].join(', '),
          from,
        )
      }
    }

    for (const to of toLabels) {
      if (!nodeKeys.has(to)) {
        throw new SchemaValidationError(
          `Edge '${edgeName}' references unknown target node '${to}'. Available nodes: ${[...nodeKeys].join(', ')}`,
          'to',
          [...nodeKeys].join(', '),
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

  // Validate extends references exist and detect cycles
  validateExtendsInheritance(resolvedNodes, nodeKeys)

  // Merge inherited properties from extends
  const mergedNodes = mergeNodeSchemas(resolvedNodes)

  return {
    nodes: mergedNodes as ResolvedNodes<TNodes>,
    edges: config.edges,
    hierarchy: config.hierarchy,
  }
}

// =============================================================================
// SCHEMA EXTENSION
// =============================================================================

/**
 * Extends an existing schema with additional nodes and edges.
 *
 * Use this to build distribution schemas that inherit from the kernel schema.
 * Extension nodes can reference labels from the base schema.
 *
 * Semantic rules:
 * - Extension nodes/edges override base nodes/edges with same key
 * - Extension nodes can use labels from base schema
 * - Property inheritance works across base and extension
 * - Hierarchy inherits from base unless overridden
 *
 * @example
 * ```typescript
 * const TaskSchema = extendSchema(KernelSchema, {
 *   nodes: {
 *     task: node({
 *       properties: { title: z.string() },
 *       labels: ['module'],  // Inherits from kernel's module
 *     }),
 *   },
 *   edges: {
 *     taskOwner: edge({
 *       from: 'task',
 *       to: 'identity',  // References kernel node
 *       cardinality: { outbound: 'one', inbound: 'many' },
 *     }),
 *   },
 * })
 * ```
 */
export function extendSchema<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TBaseNodes extends Record<string, NodeDefinition<any>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TBaseEdges extends Record<string, EdgeDefinition<any, any, any, any, any>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TExtNodes extends Record<string, NodeDefinition<any>> = Record<string, never>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TExtEdges extends Record<string, EdgeDefinition<any, any, any, any, any>> = Record<string, never>,
>(
  base: SchemaDefinition<TBaseNodes, TBaseEdges>,
  extension: {
    nodes?: TExtNodes
    edges?: TExtEdges
    hierarchy?: HierarchyConfig<keyof (TBaseEdges & TExtEdges) & string>
  },
): SchemaDefinition<ResolvedNodes<TBaseNodes & TExtNodes>, TBaseEdges & TExtEdges> {
  const mergedNodes = { ...base.nodes, ...extension.nodes }
  const mergedEdges = { ...base.edges, ...extension.edges }

  // Validate extension extends refs reference valid nodes (base or extension)
  for (const [name, nodeDef] of Object.entries(extension.nodes ?? {})) {
    const refs = nodeDef._extendsRefs
    if (!refs?.length) continue
    for (const ref of refs) {
      let found = false
      for (const n of Object.values(mergedNodes)) {
        if (n === ref) {
          found = true
          break
        }
      }
      if (!found) {
        throw new SchemaValidationError(
          `Node '${name}' extends a node definition not found in base or extension schema. Available: ${Object.keys(mergedNodes).join(', ')}`,
          'extends',
        )
      }
    }
  }

  // Delegate to defineSchema for full validation + property merging
  return defineSchema({
    nodes: mergedNodes as TBaseNodes & TExtNodes,
    edges: mergedEdges as TBaseEdges & TExtEdges,
    hierarchy: extension.hierarchy ?? base.hierarchy,
  })
}
