/**
 * Schema Type Inference Utilities
 *
 * Advanced TypeScript types for extracting type information from schemas.
 * These enable the fluent API to provide full type safety.
 */

import { type z } from 'zod'
import type { AnySchema, NodeDefinition, EdgeDefinition, Cardinality } from './types'

// =============================================================================
// BASE ENTITY TYPES (Structural Properties)
// =============================================================================

/**
 * Base properties for node OUTPUT (what you get back from queries).
 * Includes both `id` and `kind` - structural properties always present in results.
 *
 * - `id`: Unique identifier, auto-indexed by database
 * - `kind`: Node type/label, injected by SDK (pure SDK, no DB query needed)
 */
export interface BaseNodeProps<K extends string = string> {
  /** Unique identifier - present on all nodes */
  id: string
  /** Node type - injected by SDK, matches the schema node key */
  kind: K
}

/**
 * Base properties for node INPUT (what you provide to mutations).
 * Only `id` is structural - `kind` is determined by the mutation call itself.
 *
 * Example: `mutate.create('user', { id, ...props })` - 'user' IS the kind
 */
export interface BaseNodeInputProps {
  /** Unique identifier - must be provided or auto-generated */
  id: string
}

/**
 * Base properties for edge OUTPUT (what you get back from queries).
 * Includes `id` and `kind` - structural properties always present in results.
 */
export interface BaseEdgeProps<K extends string = string> {
  /** Unique identifier - present on all edges */
  id: string
  /** Edge type - injected by SDK, matches the schema edge key */
  kind: K
}

/**
 * Base properties for edge INPUT (what you provide to mutations).
 * Only `id` is structural - `kind` is determined by the mutation call.
 */
export interface BaseEdgeInputProps {
  /** Unique identifier - must be provided or auto-generated */
  id: string
}

// =============================================================================
// BASIC LABEL/TYPE EXTRACTION
// =============================================================================

/**
 * Extract all node labels from a schema.
 *
 * @example
 * NodeLabels<typeof schema> // 'user' | 'post' | 'comment'
 */
export type NodeLabels<S extends AnySchema> = keyof S['nodes'] & string

/**
 * Extract all edge types from a schema.
 *
 * @example
 * EdgeTypes<typeof schema> // 'authored' | 'likes' | 'commentedOn'
 */
export type EdgeTypes<S extends AnySchema> = keyof S['edges'] & string

// =============================================================================
// LABEL INHERITANCE HELPERS
// =============================================================================

/**
 * Convert a union type to an intersection type.
 * Used for merging properties from multiple parent labels.
 *
 * @example
 * UnionToIntersection<{ a: 1 } | { b: 2 }> // { a: 1 } & { b: 2 }
 */
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (
  k: infer I,
) => void
  ? I
  : never

/**
 * Get the direct parent labels for a node (from its `labels` array).
 * Returns `never` if the node has no labels.
 *
 * Extracts the TLabels type parameter from NodeDefinition and checks
 * if it's a specific literal tuple vs the widened `readonly string[]`.
 * When TLabels is widened (no specific labels provided), returns never.
 *
 * @example
 * // user: node({ labels: ['entity'] })
 * NodeLabelRefs<Schema, 'user'> // 'entity'
 */
export type NodeLabelRefs<S extends AnySchema, N extends NodeLabels<S>> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  S['nodes'][N] extends NodeDefinition<any, infer TLabels>
    ? TLabels extends readonly (infer L)[]
      ? // Check if TLabels is widened string[] (no specific labels) vs literal tuple
        string extends L
        ? never // Widened type, no labels
        : L & NodeLabels<S>
      : never
    : never

/**
 * Get all labels a node transitively inherits (not including itself).
 * Recursively resolves the full inheritance chain.
 *
 * @example
 * // agent: labels: ['module'], module: labels: ['entity']
 * InheritedLabels<Schema, 'agent'> // 'module' | 'entity'
 */
export type InheritedLabels<S extends AnySchema, N extends NodeLabels<S>> =
  NodeLabelRefs<S, N> extends never
    ? never
    : NodeLabelRefs<S, N> extends infer L
      ? L extends NodeLabels<S>
        ? L | InheritedLabels<S, L>
        : never
      : never

/**
 * Get all labels a node satisfies (itself + all inherited labels).
 * Used for edge inheritance to check if a node can traverse an edge.
 *
 * @example
 * // user: labels: ['entity']
 * AllSatisfiedLabels<Schema, 'user'> // 'user' | 'entity'
 */
export type AllSatisfiedLabels<S extends AnySchema, N extends NodeLabels<S>> =
  | N
  | InheritedLabels<S, N>

// =============================================================================
// PROPERTY INHERITANCE
// =============================================================================

/**
 * Get a node's own properties (excluding inherited).
 */
type OwnProps<S extends AnySchema, N extends NodeLabels<S>> =
  S['nodes'][N] extends NodeDefinition<infer TProps> ? z.infer<z.ZodObject<TProps>> : object

/**
 * Get a node's own INPUT properties (excluding inherited).
 */
type OwnInputProps<S extends AnySchema, N extends NodeLabels<S>> =
  S['nodes'][N] extends NodeDefinition<infer TProps> ? z.input<z.ZodObject<TProps>> : object

/**
 * Collect properties from all inherited labels (no recursion with MergedProps).
 * Uses InheritedLabels to get all transitive parents, then collects their OwnProps.
 *
 * This avoids the mutual recursion issue by:
 * 1. Getting ALL inherited labels in one type (InheritedLabels handles recursion)
 * 2. Collecting OwnProps from each label (no further recursion)
 * 3. Merging via UnionToIntersection
 */
type InheritedProps<S extends AnySchema, N extends NodeLabels<S>> =
  InheritedLabels<S, N> extends never
    ? object
    : UnionToIntersection<
        InheritedLabels<S, N> extends infer L
          ? L extends NodeLabels<S>
            ? OwnProps<S, L>
            : never
          : never
      >

/**
 * Collect INPUT properties from all inherited labels.
 */
type InheritedInputProps<S extends AnySchema, N extends NodeLabels<S>> =
  InheritedLabels<S, N> extends never
    ? object
    : UnionToIntersection<
        InheritedLabels<S, N> extends infer L
          ? L extends NodeLabels<S>
            ? OwnInputProps<S, L>
            : never
          : never
      >

/**
 * Merge inherited and own properties.
 * Child properties override parent properties (like class inheritance).
 */
type MergedProps<S extends AnySchema, N extends NodeLabels<S>> = Omit<
  InheritedProps<S, N>,
  keyof OwnProps<S, N>
> &
  OwnProps<S, N>

/**
 * Merge inherited and own INPUT properties.
 */
type MergedInputProps<S extends AnySchema, N extends NodeLabels<S>> = Omit<
  InheritedInputProps<S, N>,
  keyof OwnInputProps<S, N>
> &
  OwnInputProps<S, N>

// =============================================================================
// PROPERTY EXTRACTION
// =============================================================================

/**
 * Extract the inferred TypeScript type of a node's properties (output type).
 * Includes the implicit `id` and `kind` fields, plus all inherited properties from labels.
 *
 * @example
 * // entity: { updatedAt: Date }, user: { email: string, labels: ['entity'] }
 * NodeProps<typeof schema, 'user'> // { id: string; kind: 'user'; email: string; updatedAt: Date; }
 */
export type NodeProps<S extends AnySchema, N extends NodeLabels<S>> = BaseNodeProps<N> &
  MergedProps<S, N>

/**
 * Extract the INPUT TypeScript type of a node's properties.
 * Uses z.input which respects .optional().default() - fields with defaults are optional for input.
 * Includes inherited properties from labels.
 *
 * @example
 * NodeInputProps<typeof schema, 'identity'> // { id: string; kind: 'identity'; iss: string; sub: string; frozen?: boolean }
 */
export type NodeInputProps<S extends AnySchema, N extends NodeLabels<S>> = BaseNodeInputProps &
  MergedInputProps<S, N>

/**
 * Extract the inferred TypeScript type of an edge's properties (output type).
 * Includes the implicit `id` and `kind` fields.
 *
 * @example
 * EdgeProps<typeof schema, 'friendOf'> // { id: string; kind: 'friendOf'; since: Date; closeness: 'close' | 'acquaintance'; }
 */
export type EdgeProps<S extends AnySchema, E extends EdgeTypes<S>> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  S['edges'][E] extends EdgeDefinition<any, any, infer TProps>
    ? BaseEdgeProps<E> & z.infer<z.ZodObject<TProps>>
    : never

/**
 * Extract the INPUT TypeScript type of an edge's properties.
 * Uses z.input which respects .optional().default() - fields with defaults are optional for input.
 */
export type EdgeInputProps<S extends AnySchema, E extends EdgeTypes<S>> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  S['edges'][E] extends EdgeDefinition<any, any, infer TProps>
    ? BaseEdgeInputProps & z.input<z.ZodObject<TProps>>
    : never

/**
 * Extract only the user-defined properties (excluding implicit `id`).
 * Includes inherited properties from labels.
 */
export type NodeUserProps<S extends AnySchema, N extends NodeLabels<S>> = MergedProps<S, N>

/**
 * Extract only the user-defined edge properties (excluding implicit `id`).
 */
export type EdgeUserProps<S extends AnySchema, E extends EdgeTypes<S>> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  S['edges'][E] extends EdgeDefinition<any, any, infer TProps>
    ? z.infer<z.ZodObject<TProps>>
    : never

// =============================================================================
// POLYMORPHIC EDGE HELPERS
// =============================================================================

/**
 * Normalize edge endpoints to union types.
 * Converts readonly string[] to union, leaves string as-is.
 *
 * @example
 * NormalizeEdgeEndpoint<'user'> // 'user'
 * NormalizeEdgeEndpoint<readonly ['user', 'admin']> // 'user' | 'admin'
 */
export type NormalizeEdgeEndpoint<T> = T extends readonly (infer U)[] ? U : T

// =============================================================================
// EDGE NAVIGATION
// =============================================================================

/**
 * Get all edge types that originate FROM a given node.
 * Supports polymorphic edges and label inheritance.
 *
 * @example
 * // hasParent: { from: 'entity', to: 'entity' }, user: { labels: ['entity'] }
 * OutgoingEdges<typeof schema, 'user'> // 'hasParent' (inherited from entity)
 */
export type OutgoingEdges<S extends AnySchema, N extends NodeLabels<S>> = {
  [E in EdgeTypes<S>]: AllSatisfiedLabels<S, N> extends infer L
    ? L extends NormalizeEdgeEndpoint<S['edges'][E]['from']>
      ? E
      : never
    : never
}[EdgeTypes<S>]

/**
 * Get all edge types that point TO a given node.
 * Supports polymorphic edges and label inheritance.
 *
 * @example
 * // hasParent: { from: 'entity', to: 'entity' }, user: { labels: ['entity'] }
 * IncomingEdges<typeof schema, 'user'> // 'hasParent' (inherited from entity)
 */
export type IncomingEdges<S extends AnySchema, N extends NodeLabels<S>> = {
  [E in EdgeTypes<S>]: AllSatisfiedLabels<S, N> extends infer L
    ? L extends NormalizeEdgeEndpoint<S['edges'][E]['to']>
      ? E
      : never
    : never
}[EdgeTypes<S>]

/**
 * Get all edges connected to a node (either direction).
 */
export type ConnectedEdges<S extends AnySchema, N extends NodeLabels<S>> =
  | OutgoingEdges<S, N>
  | IncomingEdges<S, N>

/**
 * Get the target node label for a given edge type.
 * For polymorphic edges, returns union of all possible targets.
 *
 * @example
 * EdgeTarget<typeof schema, 'authored'> // 'post'
 * EdgeTarget<typeof schema, 'created'> // 'post' | 'comment' (polymorphic)
 */
export type EdgeTarget<S extends AnySchema, E extends EdgeTypes<S>> = NormalizeEdgeEndpoint<
  S['edges'][E]['to']
> &
  NodeLabels<S>

/**
 * Get the source node label for a given edge type.
 * For polymorphic edges, returns union of all possible sources.
 *
 * @example
 * EdgeSource<typeof schema, 'authored'> // 'user'
 */
export type EdgeSource<S extends AnySchema, E extends EdgeTypes<S>> = NormalizeEdgeEndpoint<
  S['edges'][E]['from']
> &
  NodeLabels<S>

/**
 * Get valid target nodes for an edge when traversing from a specific source node.
 * For polymorphic edges, filters targets based on the current source.
 * Respects label inheritance - if source satisfies the edge's from type, traversal is valid.
 *
 * @example
 * // Edge 'created' from ['user'] to ['post', 'comment']
 * EdgeTargetsFrom<Schema, 'created', 'user'> // 'post' | 'comment'
 */
export type EdgeTargetsFrom<S extends AnySchema, E extends EdgeTypes<S>, N extends NodeLabels<S>> =
  AllSatisfiedLabels<S, N> extends infer L
    ? L extends NormalizeEdgeEndpoint<S['edges'][E]['from']>
      ? NormalizeEdgeEndpoint<S['edges'][E]['to']> & NodeLabels<S>
      : never
    : never

/**
 * Get valid source nodes for an edge when traversing to a specific target node.
 * For polymorphic edges, filters sources based on the current target.
 * Respects label inheritance - if target satisfies the edge's to type, traversal is valid.
 *
 * @example
 * // Edge 'created' from ['user', 'admin'] to ['post']
 * EdgeSourcesTo<Schema, 'created', 'post'> // 'user' | 'admin'
 */
export type EdgeSourcesTo<S extends AnySchema, E extends EdgeTypes<S>, N extends NodeLabels<S>> =
  AllSatisfiedLabels<S, N> extends infer L
    ? L extends NormalizeEdgeEndpoint<S['edges'][E]['to']>
      ? NormalizeEdgeEndpoint<S['edges'][E]['from']> & NodeLabels<S>
      : never
    : never

/**
 * Get the outbound cardinality of an edge (affects .to() return type).
 * This is how many edges can leave from one source node.
 *
 * @example
 * EdgeOutboundCardinality<typeof schema, 'authored'> // 'many' (one user authors many posts)
 */
export type EdgeOutboundCardinality<
  S extends AnySchema,
  E extends EdgeTypes<S>,
> = S['edges'][E]['cardinality']['outbound']

/**
 * Get the inbound cardinality of an edge (affects .from() return type).
 * This is how many edges can arrive at one target node.
 *
 * @example
 * EdgeInboundCardinality<typeof schema, 'authored'> // 'one' (one post has one author)
 */
export type EdgeInboundCardinality<
  S extends AnySchema,
  E extends EdgeTypes<S>,
> = S['edges'][E]['cardinality']['inbound']

/**
 * @deprecated Use EdgeOutboundCardinality instead
 */
export type EdgeCardinality<S extends AnySchema, E extends EdgeTypes<S>> = EdgeOutboundCardinality<
  S,
  E
>

/**
 * @deprecated Use EdgeInboundCardinality instead
 */
export type EdgeInverseCardinality<
  S extends AnySchema,
  E extends EdgeTypes<S>,
> = EdgeInboundCardinality<S, E>

// =============================================================================
// MULTI-EDGE TRAVERSAL
// =============================================================================

/**
 * Get the union of all possible target nodes when traversing any of the given edges.
 * Used for multi-edge traversal with toAny().
 *
 * @example
 * // Given edges: 'seeAlso' -> Page, 'references' -> Page, 'relatedTo' -> Document
 * MultiEdgeTargets<Schema, 'page', ['seeAlso', 'references', 'relatedTo']>
 * // Result: 'page' | 'document'
 */
export type MultiEdgeTargets<
  S extends AnySchema,
  N extends NodeLabels<S>,
  Edges extends readonly EdgeTypes<S>[],
> = {
  [E in Edges[number]]: E extends OutgoingEdges<S, N>
    ? EdgeTargetsFrom<S, E & EdgeTypes<S>, N>
    : never
}[Edges[number]]

/**
 * Get the union of all possible source nodes when traversing any of the given edges in reverse.
 * Used for fromAny() multi-edge traversal.
 *
 * @example
 * MultiEdgeSources<Schema, 'post', ['authored', 'edited']>
 * // Result: 'user' | 'admin'
 */
export type MultiEdgeSources<
  S extends AnySchema,
  N extends NodeLabels<S>,
  Edges extends readonly EdgeTypes<S>[],
> = {
  [E in Edges[number]]: E extends IncomingEdges<S, N>
    ? EdgeSourcesTo<S, E & EdgeTypes<S>, N>
    : never
}[Edges[number]]

/**
 * Get the union of all nodes when traversing any of the given edges bidirectionally.
 * Used for viaAny() multi-edge traversal.
 *
 * @example
 * MultiEdgeBidirectional<Schema, 'page', ['seeAlso', 'relatedTo']>
 */
export type MultiEdgeBidirectional<
  S extends AnySchema,
  N extends NodeLabels<S>,
  Edges extends readonly EdgeTypes<S>[],
> = {
  [E in Edges[number]]: E extends OutgoingEdges<S, N> & IncomingEdges<S, N>
    ? EdgeTargetsFrom<S, E & EdgeTypes<S>, N> | EdgeSourcesTo<S, E & EdgeTypes<S>, N>
    : never
}[Edges[number]]

// =============================================================================
// CONDITIONAL CARDINALITY TYPES
// =============================================================================

/**
 * Determine the appropriate builder type based on cardinality.
 * Used internally by the query builder.
 */
export type CardinalityToBuilder<
  C extends Cardinality,
  SingleType,
  OptionalType,
  CollectionType,
> = C extends 'one' ? SingleType : C extends 'optional' ? OptionalType : CollectionType

// =============================================================================
// FULL SCHEMA INFERENCE
// =============================================================================

/**
 * Infer the complete TypeScript representation of a schema.
 * Useful for generating types or runtime validation.
 */
export type InferSchema<S extends AnySchema> = {
  nodes: {
    [N in NodeLabels<S>]: NodeProps<S, N>
  }
  edges: {
    [E in EdgeTypes<S>]: {
      from: EdgeSource<S, E>
      to: EdgeTarget<S, E>
      properties: EdgeProps<S, E>
    }
  }
}

// =============================================================================
// ALIAS TRACKING (For multi-node returns)
// =============================================================================

/**
 * Maps alias names to their node types.
 * Used for `.as()` and `.returning()` type inference.
 */
export type AliasMap<S extends AnySchema> = Record<string, NodeLabels<S>>

/**
 * Alternative export name for compatibility
 */
export type { AliasMap as AliasMapType }

/**
 * Infer the return type from an alias map.
 */
export type AliasMapToReturnType<S extends AnySchema, M extends AliasMap<S>> = {
  [K in keyof M]: NodeProps<S, M[K] & NodeLabels<S>>
}

/**
 * Maps edge alias names to their edge types.
 * Used for returning edge properties along with nodes.
 */
export type EdgeAliasMap<S extends AnySchema> = Record<string, EdgeTypes<S>>

/**
 * Infer the return type from an edge alias map.
 * Returns edge properties for each alias.
 */
export type EdgeAliasMapToReturnType<S extends AnySchema, EA extends EdgeAliasMap<S>> = {
  [K in keyof EA]: EdgeProps<S, EA[K] & EdgeTypes<S>>
}

// =============================================================================
// HIERARCHY TYPE HELPERS
// =============================================================================

/**
 * Extract the default hierarchy edge from a schema, or use provided edge.
 */
export type ResolveHierarchyEdgeType<S extends AnySchema, E extends EdgeTypes<S> | undefined> =
  E extends EdgeTypes<S>
    ? E
    : S extends { hierarchy: { defaultEdge: infer DE } }
      ? DE & EdgeTypes<S>
      : never

/**
 * Get all node types that can be children of N via the hierarchy edge.
 * For direction='up': children have edge FROM them TO parent (N)
 * For direction='down': children have edge FROM parent (N) TO them
 *
 * @example
 * // hasParent: from: ["module", "type", "app", ...] to: ["module", "root", "app", "group"]
 * HierarchyChildren<Schema, "application"> // "module" | "type" | "application" | "space" | ...
 */
export type HierarchyChildren<
  S extends AnySchema,
  N extends NodeLabels<S>,
  E extends EdgeTypes<S> | undefined = undefined,
> =
  ResolveHierarchyEdgeType<S, E> extends infer RE
    ? RE extends EdgeTypes<S>
      ? S extends { hierarchy: { direction: 'up' } }
        ? EdgeSourcesTo<S, RE, N> // Children have edge FROM them TO parent
        : S extends { hierarchy: { direction: 'down' } }
          ? EdgeTargetsFrom<S, RE, N> // Children have edge FROM parent TO them
          : EdgeSourcesTo<S, RE, N> // Default to 'up' direction
      : never
    : never

/**
 * Get all node types that can be parents of N via the hierarchy edge.
 * For direction='up': parent is target of edge FROM child (N)
 * For direction='down': parent is source of edge TO child (N)
 */
export type HierarchyParent<
  S extends AnySchema,
  N extends NodeLabels<S>,
  E extends EdgeTypes<S> | undefined = undefined,
> =
  ResolveHierarchyEdgeType<S, E> extends infer RE
    ? RE extends EdgeTypes<S>
      ? S extends { hierarchy: { direction: 'up' } }
        ? EdgeTargetsFrom<S, RE, N> // Parent is target of edge FROM child
        : S extends { hierarchy: { direction: 'down' } }
          ? EdgeSourcesTo<S, RE, N> // Parent is source of edge TO child
          : EdgeTargetsFrom<S, RE, N> // Default to 'up' direction
      : never
    : never

/**
 * Resolve ancestor result type based on whether untilKind is specified.
 * When untilKind is provided, narrows the return type to that specific kind.
 * Otherwise, returns the union of all possible parent types.
 */
export type AncestorResult<
  S extends AnySchema,
  N extends NodeLabels<S>,
  E extends EdgeTypes<S> | undefined,
  K extends NodeLabels<S> | undefined,
> = K extends NodeLabels<S> ? K : HierarchyParent<S, N, E>

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Validates that an edge's from/to references exist in nodes.
 * Returns `true` if valid, error message if not.
 */
export type ValidateEdgeReferences<S extends AnySchema, E extends EdgeTypes<S>> =
  EdgeSource<S, E> extends NodeLabels<S>
    ? EdgeTarget<S, E> extends NodeLabels<S>
      ? true
      : `Edge '${E}' references unknown target node '${EdgeTarget<S, E>}'`
    : `Edge '${E}' references unknown source node '${EdgeSource<S, E>}'`

// =============================================================================
// TYPED RETURN PROXY SYSTEM
// =============================================================================

/**
 * Symbol brand for NodeProxy to enable type-level detection.
 * @internal
 */
declare const NODE_PROXY_BRAND: unique symbol

/**
 * A proxy type representing a matched node in a query.
 *
 * When used directly in a return expression, represents the full NodeProps.
 * When a property is accessed (e.g., `q.u.email`), returns the property type.
 *
 * @example
 * ```typescript
 * .return(q => ({
 *   user: q.u,           // NodeProxy used directly -> NodeProps<S, 'user'>
 *   email: q.u.email     // Property access -> string
 * }))
 * ```
 */
export type NodeProxy<S extends AnySchema, N extends NodeLabels<S>> = NodeProps<S, N> & {
  readonly [NODE_PROXY_BRAND]: { schema: S; label: N }
}

/**
 * Optional variant of NodeProxy for optional traversals.
 * Returns NodeProxy | undefined when the traversal may not match.
 */
export type OptionalNodeProxy<S extends AnySchema, N extends NodeLabels<S>> =
  | NodeProxy<S, N>
  | undefined

/**
 * Symbol brand for EdgeProxy to enable type-level detection.
 * @internal
 */
declare const EDGE_PROXY_BRAND: unique symbol

/**
 * A proxy type representing a matched edge in a query.
 * Similar to NodeProxy but for edges.
 */
export type EdgeProxy<S extends AnySchema, E extends EdgeTypes<S>> = EdgeProps<S, E> & {
  readonly [EDGE_PROXY_BRAND]: { schema: S; edge: E }
}

/**
 * Optional variant of EdgeProxy for optional traversals.
 */
export type OptionalEdgeProxy<S extends AnySchema, E extends EdgeTypes<S>> =
  | EdgeProxy<S, E>
  | undefined

/**
 * Query context passed to `.return()` callbacks.
 * Provides typed access to all registered aliases.
 *
 * @template S - Schema type
 * @template Aliases - Map of required alias names to node labels
 * @template OptionalAliases - Map of optional alias names to node labels (nullable in results)
 * @template EdgeAliases - Map of edge alias names to edge types
 *
 * @example
 * ```typescript
 * // Given: .as('u').to('authored').as('p').optionalTo('hasProfile').as('profile')
 * // QueryContext provides:
 * // q.u: NodeProxy<S, 'user'>           (required)
 * // q.p: NodeProxy<S, 'post'>           (required)
 * // q.profile?: NodeProxy<S, 'profile'> (optional - may be undefined)
 * ```
 */
export type QueryContext<
  S extends AnySchema,
  Aliases extends AliasMap<S>,
  OptionalAliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
> = {
  readonly [K in keyof Aliases]: NodeProxy<S, Aliases[K] & NodeLabels<S>>
} & {
  readonly [K in keyof OptionalAliases]?: OptionalNodeProxy<S, OptionalAliases[K] & NodeLabels<S>>
} & {
  readonly [K in keyof EdgeAliases]: EdgeProxy<S, EdgeAliases[K] & EdgeTypes<S>>
}

/**
 * Resolves a proxy type to its underlying data type.
 *
 * - NodeProxy<S, N> -> NodeProps<S, N>
 * - EdgeProxy<S, E> -> EdgeProps<S, E>
 * - Array<NodeProxy<S, N>> -> Array<NodeProps<S, N>>
 * - Other types pass through unchanged
 *
 * @internal
 */
export type ResolveProxy<T> = T extends { readonly [NODE_PROXY_BRAND]: { schema: infer S; label: infer N } }
  ? S extends AnySchema
    ? N extends NodeLabels<S>
      ? NodeProps<S, N>
      : never
    : never
  : T extends { readonly [EDGE_PROXY_BRAND]: { schema: infer S; edge: infer E } }
    ? S extends AnySchema
      ? E extends EdgeTypes<S>
        ? EdgeProps<S, E>
        : never
      : never
    : T extends Array<infer U>
      ? Array<ResolveProxy<U>>
      : T

/**
 * Infers the return type from a `.return()` callback's result object.
 * Recursively resolves all proxy types to their underlying data types.
 *
 * @example
 * ```typescript
 * // Given callback returning:
 * // { author: q.u, email: q.u.email, posts: collect(q.p) }
 * //
 * // InferReturnType produces:
 * // { author: NodeProps<S, 'user'>, email: string, posts: Array<NodeProps<S, 'post'>> }
 * ```
 */
export type InferReturnType<T> = {
  [K in keyof T]: ResolveProxy<T[K]>
}
