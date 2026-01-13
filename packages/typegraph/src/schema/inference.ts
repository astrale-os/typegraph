/**
 * Schema Type Inference Utilities
 *
 * Advanced TypeScript types for extracting type information from schemas.
 * These enable the fluent API to provide full type safety.
 */

import { type z } from "zod"
import type { AnySchema, NodeDefinition, EdgeDefinition, Cardinality } from "./types"

// =============================================================================
// BASE ENTITY TYPE (Implicit ID)
// =============================================================================

/**
 * Base properties that ALL nodes have (implicit).
 */
export interface BaseNodeProps {
  /** Unique identifier - present on all nodes */
  id: string
}

/**
 * Base properties that ALL edges have (implicit).
 */
export interface BaseEdgeProps {
  /** Unique identifier - present on all edges */
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
export type NodeLabels<S extends AnySchema> = keyof S["nodes"] & string

/**
 * Extract all edge types from a schema.
 *
 * @example
 * EdgeTypes<typeof schema> // 'authored' | 'likes' | 'commentedOn'
 */
export type EdgeTypes<S extends AnySchema> = keyof S["edges"] & string

// =============================================================================
// PROPERTY EXTRACTION
// =============================================================================

/**
 * Extract the inferred TypeScript type of a node's properties.
 * Includes the implicit `id` field.
 *
 * @example
 * NodeProps<typeof schema, 'user'> // { id: string; email: string; name: string; }
 */
export type NodeProps<S extends AnySchema, N extends NodeLabels<S>> =
  S["nodes"][N] extends NodeDefinition<infer TProps>
    ? BaseNodeProps & z.infer<z.ZodObject<TProps>>
    : never

/**
 * Extract the inferred TypeScript type of an edge's properties.
 * Includes the implicit `id` field.
 *
 * @example
 * EdgeProps<typeof schema, 'friendOf'> // { id: string; since: Date; closeness: 'close' | 'acquaintance'; }
 */
export type EdgeProps<S extends AnySchema, E extends EdgeTypes<S>> =
  S["edges"][E] extends EdgeDefinition<any, any, infer TProps>
    ? BaseEdgeProps & z.infer<z.ZodObject<TProps>>
    : never

/**
 * Extract only the user-defined properties (excluding implicit `id`).
 */
export type NodeUserProps<S extends AnySchema, N extends NodeLabels<S>> =
  S["nodes"][N] extends NodeDefinition<infer TProps> ? z.infer<z.ZodObject<TProps>> : never

/**
 * Extract only the user-defined edge properties (excluding implicit `id`).
 */
export type EdgeUserProps<S extends AnySchema, E extends EdgeTypes<S>> =
  S["edges"][E] extends EdgeDefinition<any, any, infer TProps>
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
 * Supports polymorphic edges.
 *
 * @example
 * OutgoingEdges<typeof schema, 'user'> // 'authored' | 'likes' | 'friendOf'
 */
export type OutgoingEdges<S extends AnySchema, N extends NodeLabels<S>> = {
  [E in EdgeTypes<S>]: N extends NormalizeEdgeEndpoint<S["edges"][E]["from"]> ? E : never
}[EdgeTypes<S>]

/**
 * Get all edge types that point TO a given node.
 * Supports polymorphic edges.
 *
 * @example
 * IncomingEdges<typeof schema, 'post'> // 'authored' | 'likes'
 */
export type IncomingEdges<S extends AnySchema, N extends NodeLabels<S>> = {
  [E in EdgeTypes<S>]: N extends NormalizeEdgeEndpoint<S["edges"][E]["to"]> ? E : never
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
  S["edges"][E]["to"]
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
  S["edges"][E]["from"]
> &
  NodeLabels<S>

/**
 * Get valid target nodes for an edge when traversing from a specific source node.
 * For polymorphic edges, filters targets based on the current source.
 *
 * @example
 * // Edge 'created' from ['user'] to ['post', 'comment']
 * EdgeTargetsFrom<Schema, 'created', 'user'> // 'post' | 'comment'
 */
export type EdgeTargetsFrom<S extends AnySchema, E extends EdgeTypes<S>, N extends NodeLabels<S>> =
  N extends NormalizeEdgeEndpoint<S["edges"][E]["from"]>
    ? NormalizeEdgeEndpoint<S["edges"][E]["to"]> & NodeLabels<S>
    : never

/**
 * Get valid source nodes for an edge when traversing to a specific target node.
 * For polymorphic edges, filters sources based on the current target.
 *
 * @example
 * // Edge 'created' from ['user', 'admin'] to ['post']
 * EdgeSourcesTo<Schema, 'created', 'post'> // 'user' | 'admin'
 */
export type EdgeSourcesTo<S extends AnySchema, E extends EdgeTypes<S>, N extends NodeLabels<S>> =
  N extends NormalizeEdgeEndpoint<S["edges"][E]["to"]>
    ? NormalizeEdgeEndpoint<S["edges"][E]["from"]> & NodeLabels<S>
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
> = S["edges"][E]["cardinality"]["outbound"]

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
> = S["edges"][E]["cardinality"]["inbound"]

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
> = C extends "one" ? SingleType : C extends "optional" ? OptionalType : CollectionType

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
      ? S extends { hierarchy: { direction: "up" } }
        ? EdgeSourcesTo<S, RE, N> // Children have edge FROM them TO parent
        : S extends { hierarchy: { direction: "down" } }
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
      ? S extends { hierarchy: { direction: "up" } }
        ? EdgeTargetsFrom<S, RE, N> // Parent is target of edge FROM child
        : S extends { hierarchy: { direction: "down" } }
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
