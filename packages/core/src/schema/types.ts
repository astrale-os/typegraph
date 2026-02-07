/**
 * Core Schema Type Definitions
 *
 * These types define the structure of a graph schema.
 * The schema is the "source of truth" for all type inference.
 *
 * IMPORTANT: All nodes and edges implicitly have an `id: string` field.
 * This is not declared in properties but is always present and indexed.
 */

import { type z } from 'zod'

// =============================================================================
// PROPERTY TYPES
// =============================================================================

/**
 * Supported property types in the schema.
 * Maps to both Zod types and Cypher types.
 */
export type PropertyType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'string[]'
  | 'number[]'

/**
 * Base index configuration shared by all index types.
 */
export interface BaseIndexConfig {
  /** Index type: btree for range queries, fulltext for search, unique for constraints */
  type: 'btree' | 'fulltext' | 'unique'
  /** Optional index name (auto-generated if not provided) */
  name?: string
}

/**
 * Single-property index configuration.
 * Used when indexing a single property with optional type and name.
 */
export interface SinglePropertyIndex extends BaseIndexConfig {
  /** The property to index */
  property: string
}

/**
 * Composite index configuration for multiple properties.
 * Used for multi-column indexes that improve query performance on combined filters.
 *
 * Note: fulltext indexes cannot be composite - only 'btree' and 'unique' are supported.
 *
 * @example
 * ```typescript
 * // Composite btree for queries like WHERE firstName = 'John' AND lastName = 'Doe'
 * { properties: ['firstName', 'lastName'], type: 'btree' }
 *
 * // Composite unique for multi-tenant uniqueness
 * { properties: ['tenantId', 'email'], type: 'unique' }
 *
 * // With ordering for range queries (Neo4j 5.x)
 * { properties: ['userId', 'createdAt'], type: 'btree', order: { createdAt: 'DESC' } }
 * ```
 */
export interface CompositeIndex {
  /** Index type: only 'btree' and 'unique' supported for composite indexes */
  type: 'btree' | 'unique'
  /** Properties to include in the composite index (order matters for query optimization) */
  properties: readonly string[]
  /** Optional ordering for each property (defaults to ASC). Only supported in Neo4j 5.x+ */
  order?: Partial<Record<string, 'ASC' | 'DESC'>>
  /** Optional index name (auto-generated if not provided) */
  name?: string
}

/**
 * Union type for all index configurations.
 * Backwards compatible - existing code using IndexConfig continues to work.
 */
export type IndexConfig = BaseIndexConfig | SinglePropertyIndex | CompositeIndex

/**
 * Type guard to check if an index config is a composite index.
 */
export function isCompositeIndex(
  config: IndexConfig | (IndexConfig & { property?: string; properties?: readonly string[] }),
): config is CompositeIndex {
  return 'properties' in config && Array.isArray(config.properties)
}

/**
 * Type guard to check if an index config is a single-property index with explicit property field.
 */
export function isSinglePropertyIndex(
  config: IndexConfig | (IndexConfig & { property?: string; properties?: readonly string[] }),
): config is SinglePropertyIndex {
  return 'property' in config && typeof config.property === 'string'
}

// =============================================================================
// NODE DEFINITION
// =============================================================================

/**
 * Definition of a node in the graph schema.
 *
 * All nodes implicitly have:
 * - `id: string` - Unique identifier (auto-indexed)
 *
 * @template TProps - Zod shape defining additional node properties
 */
export interface NodeDefinition<
  TProps extends z.ZodRawShape = z.ZodRawShape,
  TLabels extends readonly string[] = readonly string[],
> {
  readonly _type: 'node'

  /**
   * Zod schema for node properties.
   * Note: `id` is implicit and should NOT be declared here.
   */
  readonly properties: z.ZodObject<TProps>

  /**
   * Properties that should be indexed (in addition to `id` which is always indexed).
   *
   * Supports three formats:
   * - Simple string: `'email'` - Creates a btree index on the property
   * - Single property config: `{ property: 'email', type: 'unique' }`
   * - Composite index: `{ properties: ['firstName', 'lastName'], type: 'btree' }`
   */
  readonly indexes: Array<
    | keyof TProps
    | (Omit<SinglePropertyIndex, 'property'> & { property: keyof TProps })
    | (Omit<CompositeIndex, 'properties'> & { properties: readonly (keyof TProps)[] })
  >

  /** Optional description for documentation */
  readonly description?: string

  /**
   * Node types that this node also acts as (IS-A relationship).
   * Each entry references another node type key in the schema.
   *
   * Effects:
   * - Adds PascalCase Cypher labels for each referenced type
   * - Allows this node to satisfy edges expecting those types
   */
  readonly labels?: TLabels
}

// =============================================================================
// EDGE DEFINITION
// =============================================================================

/**
 * Cardinality of an edge endpoint.
 * - 'one': Exactly one connected node (required)
 * - 'many': Zero or more connected nodes
 * - 'optional': Zero or one connected node
 */
export type Cardinality = 'one' | 'many' | 'optional'

/**
 * Definition of an edge in the graph schema.
 *
 * All edges implicitly have:
 * - `id: string` - Unique identifier
 *
 * Supports polymorphic edges: from and to can be a single node label or an array of labels.
 *
 * @template TFrom - Source node label(s) - string or readonly string[]
 * @template TTo - Target node label(s) - string or readonly string[]
 * @template TProps - Zod shape defining edge properties
 */
export interface EdgeDefinition<
  TFrom extends string | readonly string[] = string,
  TTo extends string | readonly string[] = string,
  TProps extends z.ZodRawShape = z.ZodRawShape,
  TOutbound extends Cardinality = Cardinality,
  TInbound extends Cardinality = Cardinality,
> {
  readonly _type: 'edge'

  /** Source node label(s) - can be single label or array for polymorphic edges */
  readonly from: TFrom

  /** Target node label(s) - can be single label or array for polymorphic edges */
  readonly to: TTo

  /**
   * Cardinality constraints with clear directional semantics.
   *
   * - outbound: How many edges can LEAVE from one source node (traversing forward)
   * - inbound: How many edges can ARRIVE at one target node (traversing backward)
   *
   * @example
   * ```typescript
   * // One user authors many posts, each post has one author
   * // user.to('authored') returns CollectionBuilder (many posts)
   * // post.from('authored') returns SingleNodeBuilder (one author)
   * cardinality: { outbound: 'many', inbound: 'one' }
   *
   * // Users can have many friends, each user can be friended by many
   * cardinality: { outbound: 'many', inbound: 'many' }
   *
   * // A node has at most one parent, parent can have many children
   * // node.to('parent') returns OptionalNodeBuilder (optional parent)
   * // node.from('parent') returns CollectionBuilder (many children)
   * cardinality: { outbound: 'optional', inbound: 'many' }
   * ```
   */
  readonly cardinality: {
    /** How many edges can leave from one source node (affects .to() return type) */
    outbound: TOutbound
    /** How many edges can arrive at one target node (affects .from() return type) */
    inbound: TInbound
  }

  /**
   * Zod schema for edge properties (optional).
   * Note: `id` is implicit and should NOT be declared here.
   */
  readonly properties: z.ZodObject<TProps>

  /**
   * Properties that should be indexed (in addition to `id` which is always indexed).
   *
   * Supports three formats:
   * - Simple string: `'since'` - Creates a btree index on the property
   * - Single property config: `{ property: 'since', type: 'btree' }`
   * - Composite index: `{ properties: ['type', 'since'], type: 'btree' }`
   */
  readonly indexes?: Array<
    | keyof TProps
    | (Omit<SinglePropertyIndex, 'property'> & { property: keyof TProps })
    | (Omit<CompositeIndex, 'properties'> & { properties: readonly (keyof TProps)[] })
  >

  /** Optional description for documentation */
  readonly description?: string
}

// =============================================================================
// HIERARCHY CONFIGURATION
// =============================================================================

/**
 * Configuration for hierarchical graph structure.
 * Defines the DEFAULT hierarchy edge used when not specified in method calls.
 * All hierarchy methods (parent, children, ancestors, etc.) accept an optional
 * edge parameter to override this default.
 *
 * @template TEdge - The edge type that defines the default hierarchy
 *
 * @example
 * ```typescript
 * const schema = defineSchema({
 *   nodes: { ... },
 *   edges: {
 *     hasParent: edge({ from: 'node', to: 'node', cardinality: { outbound: 'optional', inbound: 'many' } }),
 *     containedIn: edge({ from: 'item', to: 'container', cardinality: { outbound: 'optional', inbound: 'many' } }),
 *   },
 *   hierarchy: {
 *     defaultEdge: 'hasParent',
 *     direction: 'up',
 *   },
 * });
 *
 * // Uses default 'hasParent' edge
 * node.parent()
 * node.ancestors()
 *
 * // Override with specific edge
 * item.parent('containedIn')
 * item.ancestors('containedIn')
 * ```
 */
export interface HierarchyConfig<TEdge extends string = string> {
  /**
   * The default edge type for hierarchy navigation.
   * Used when hierarchy methods are called without an edge parameter.
   */
  readonly defaultEdge: TEdge

  /**
   * Direction of the hierarchy edge.
   * - 'up': Edge points from child to parent (e.g., 'hasParent' edge)
   * - 'down': Edge points from parent to child (e.g., 'hasChildren' edge)
   */
  readonly direction: 'up' | 'down'
}

// =============================================================================
// SCHEMA DEFINITION
// =============================================================================

/**
 * Complete graph schema definition.
 *
 * @template TNodes - Record of node labels to node definitions
 * @template TEdges - Record of edge types to edge definitions
 */
export interface SchemaDefinition<
  TNodes extends Record<string, NodeDefinition> = Record<string, NodeDefinition>,
  TEdges extends Record<
    string,
    EdgeDefinition<
      string | readonly string[],
      string | readonly string[],
      import('zod').ZodRawShape
    >
  > = Record<
    string,
    EdgeDefinition<
      string | readonly string[],
      string | readonly string[],
      import('zod').ZodRawShape
    >
  >,
> {
  /** All node definitions keyed by label */
  readonly nodes: TNodes

  /** All edge definitions keyed by type */
  readonly edges: TEdges

  /** Optional hierarchy configuration for tree-structured graphs */
  readonly hierarchy?: HierarchyConfig<keyof TEdges & string>
}

// =============================================================================
// SCHEMA CONSTRAINT TYPE
// =============================================================================

/**
 * Base type for schema constraints in generic functions and classes.
 *
 * Uses `any` to bypass TypeScript's generic variance issues with interface
 * default parameters. This is necessary because TypeScript performs invariant
 * checking on generic interfaces, which prevents specific schemas from being
 * assignable to `SchemaDefinition<Record<string, ...>, Record<string, ...>>`.
 *
 * @example
 * ```typescript
 * // Instead of: function foo<S extends SchemaDefinition>(schema: S)
 * // Use:        function foo<S extends AnySchema>(schema: S)
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySchema = SchemaDefinition<any, any>

// =============================================================================
// HIERARCHY TYPE HELPERS
// =============================================================================

/**
 * Type helper to check if a schema has hierarchy configuration.
 */
export type HasHierarchy<S extends AnySchema> = S extends { hierarchy: HierarchyConfig }
  ? true
  : false

/**
 * Extract the default hierarchy edge type from a schema.
 */
export type HierarchyEdge<S extends AnySchema> = S extends { hierarchy: { defaultEdge: infer E } }
  ? E
  : never

/**
 * Extract the hierarchy direction from a schema.
 */
export type HierarchyDirection<S extends AnySchema> = S extends {
  hierarchy: { direction: infer D }
}
  ? D
  : never

/**
 * Get the default hierarchy edge or fall back to a provided edge.
 * Used internally by hierarchy methods.
 */
export type ResolveHierarchyEdge<
  S extends AnySchema,
  E extends string | undefined,
> = E extends string ? E : HierarchyEdge<S>

/**
 * Schema Diff Types
 *
 * Types for the result of comparing two schema versions.
 * Used by diffSchema() to classify changes as breaking or non-breaking.
 */

/**
 * A single change detected in a schema comparison.
 * Discriminated by `kind` for programmatic handling.
 */
export interface SchemaChange {
  /** What changed */
  readonly kind:
    | 'property-added'
    | 'property-removed'
    | 'property-changed'
    | 'property-required-changed'
    | 'index-added'
    | 'index-removed'
    | 'index-changed'
    | 'label-added'
    | 'label-removed'
    | 'description-changed'
    | 'from-changed'
    | 'to-changed'
    | 'cardinality-changed'
    | 'hierarchy-added'
    | 'hierarchy-removed'
    | 'hierarchy-changed'
  /** Human-readable description of the change */
  readonly description: string
  /** Whether this change breaks compatibility with existing data */
  readonly breaking: boolean
}

/**
 * The result of comparing two schema versions.
 * Classifies all changes as breaking or non-breaking.
 */
export interface SchemaDiff {
  readonly nodes: {
    readonly added: readonly string[]
    readonly removed: readonly string[]
    readonly modified: readonly {
      readonly label: string
      readonly changes: readonly SchemaChange[]
    }[]
  }
  readonly edges: {
    readonly added: readonly string[]
    readonly removed: readonly string[]
    readonly modified: readonly {
      readonly type: string
      readonly changes: readonly SchemaChange[]
    }[]
  }
  /** Hierarchy changes (empty array if no changes) */
  readonly hierarchy: readonly SchemaChange[]
  /** Whether any change requires explicit resolution */
  readonly breaking: boolean
  /** Human-readable reasons for breaking changes */
  readonly breakingReasons: readonly string[]
  /** Warnings for non-breaking but notable changes (index changes, hierarchy changes) */
  readonly warnings: readonly string[]
}
