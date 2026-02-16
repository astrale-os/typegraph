/**
 * Type Inference Utilities
 *
 * Simplified type-level inference for the codegen-based schema.
 * The codegen produces concrete types — inference is just lookups, not Zod gymnastics.
 */

import type { SchemaShape, Cardinality } from './schema'

// ─── Basic Extraction ────────────────────────────────────────

/** Extract all node type names from a schema. */
export type NodeLabels<S extends SchemaShape> = keyof S['nodes'] & string

/** Extract all edge type names from a schema. */
export type EdgeTypes<S extends SchemaShape> = keyof S['edges'] & string

// ─── Property Types ──────────────────────────────────────────

/** Node output type. Includes `id` and `kind` structural fields. */
export type NodeProps<S extends SchemaShape, N extends NodeLabels<S>> = {
  id: string
  kind: N
} & Record<string, unknown>

/** Edge output type. */
export type EdgeProps<S extends SchemaShape, E extends EdgeTypes<S>> = {
  id: string
  kind: E
} & Record<string, unknown>

// ─── Edge Navigation ─────────────────────────────────────────

export type OutgoingEdges<S extends SchemaShape, _N extends NodeLabels<S>> = EdgeTypes<S>
export type IncomingEdges<S extends SchemaShape, _N extends NodeLabels<S>> = EdgeTypes<S>
export type ConnectedEdges<S extends SchemaShape, N extends NodeLabels<S>> =
  | OutgoingEdges<S, N>
  | IncomingEdges<S, N>

export type EdgeTarget<S extends SchemaShape, _E extends EdgeTypes<S>> = NodeLabels<S>
export type EdgeSource<S extends SchemaShape, _E extends EdgeTypes<S>> = NodeLabels<S>

// ─── Endpoint type extraction ────────────────────────────────
// When the schema is `as const`, endpoint `types` are literal tuples (e.g. readonly ['Order']).
// We exploit this to narrow traversal results to the actual target node types.

/** Extract all endpoints from an edge definition. */
type _Endpoints<S extends SchemaShape, E extends EdgeTypes<S>> = S['edges'][E] extends {
  endpoints: infer EPs
}
  ? EPs
  : never

/** Union of all node types across every endpoint of an edge. */
type _AllEndpointTypes<EPs> = {
  [K in keyof EPs]: EPs[K] extends { types: readonly (infer U)[] } ? U : never
}[keyof EPs]

/** Node types from endpoints that do NOT contain N (i.e. the "other side"). */
type _NonSourceTypes<EPs, N extends string> = {
  [K in keyof EPs]: EPs[K] extends { types: readonly (infer U)[] }
    ? N extends U
      ? never
      : U
    : never
}[keyof EPs]

/**
 * Resolve target node types when traversing FROM node N via edge E.
 * Returns the types of the non-source endpoint.
 * For self-referencing edges (all endpoints contain N), falls back to all endpoint types.
 */
export type EdgeTargetsFrom<
  S extends SchemaShape,
  E extends EdgeTypes<S>,
  N extends NodeLabels<S>,
> = [_NonSourceTypes<_Endpoints<S, E>, N & string>] extends [never]
  ? _AllEndpointTypes<_Endpoints<S, E>> & NodeLabels<S>
  : _NonSourceTypes<_Endpoints<S, E>, N & string> & NodeLabels<S>

/**
 * Resolve source node types when traversing TO node N via edge E (reverse direction).
 * Same logic as EdgeTargetsFrom — returns the "other side" from N.
 */
export type EdgeSourcesTo<
  S extends SchemaShape,
  E extends EdgeTypes<S>,
  N extends NodeLabels<S>,
> = [_NonSourceTypes<_Endpoints<S, E>, N & string>] extends [never]
  ? _AllEndpointTypes<_Endpoints<S, E>> & NodeLabels<S>
  : _NonSourceTypes<_Endpoints<S, E>, N & string> & NodeLabels<S>

export type EdgeOutboundCardinality<S extends SchemaShape, _E extends EdgeTypes<S>> = Cardinality
export type EdgeInboundCardinality<S extends SchemaShape, _E extends EdgeTypes<S>> = Cardinality

// ─── Multi-Edge ──────────────────────────────────────────────

export type MultiEdgeTargets<
  S extends SchemaShape,
  _N extends NodeLabels<S>,
  _Edges extends readonly EdgeTypes<S>[],
> = NodeLabels<S>
export type MultiEdgeSources<
  S extends SchemaShape,
  _N extends NodeLabels<S>,
  _Edges extends readonly EdgeTypes<S>[],
> = NodeLabels<S>
export type MultiEdgeBidirectional<
  S extends SchemaShape,
  _N extends NodeLabels<S>,
  _Edges extends readonly EdgeTypes<S>[],
> = NodeLabels<S>

// ─── Hierarchy ───────────────────────────────────────────────

export type HierarchyChildren<
  S extends SchemaShape,
  _N extends NodeLabels<S>,
  _E extends EdgeTypes<S> | undefined = undefined,
> = NodeLabels<S>
export type HierarchyParent<
  S extends SchemaShape,
  _N extends NodeLabels<S>,
  _E extends EdgeTypes<S> | undefined = undefined,
> = NodeLabels<S>
export type AncestorResult<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  E extends EdgeTypes<S> | undefined,
  K extends NodeLabels<S> | undefined,
> = K extends NodeLabels<S> ? K : HierarchyParent<S, N, E>

// ─── Cardinality Builder Selection ───────────────────────────

export type CardinalityToBuilder<
  C extends Cardinality,
  Single,
  Optional,
  Collection,
> = C extends 'one' ? Single : C extends 'optional' ? Optional : Collection

// ─── Alias Maps ──────────────────────────────────────────────

export type AliasMap<S extends SchemaShape> = Record<string, NodeLabels<S>>
export type EdgeAliasMap<S extends SchemaShape> = Record<string, EdgeTypes<S>>

export type AliasMapToReturnType<S extends SchemaShape, M extends AliasMap<S>> = {
  [K in keyof M]: NodeProps<S, M[K] & NodeLabels<S>>
}
export type EdgeAliasMapToReturnType<S extends SchemaShape, EA extends EdgeAliasMap<S>> = {
  [K in keyof EA]: EdgeProps<S, EA[K] & EdgeTypes<S>>
}

// ─── Proxy Types (for .return() API) ─────────────────────────

export type NodeProxy<S extends SchemaShape, N extends NodeLabels<S>> = NodeProps<S, N> & {
  readonly __nodeProxyBrand__: { schema: S; label: N }
}
export type OptionalNodeProxy<S extends SchemaShape, N extends NodeLabels<S>> =
  | NodeProxy<S, N>
  | undefined

export type EdgeProxy<S extends SchemaShape, E extends EdgeTypes<S>> = EdgeProps<S, E> & {
  readonly __edgeProxyBrand__: { schema: S; edge: E }
}
export type OptionalEdgeProxy<S extends SchemaShape, E extends EdgeTypes<S>> =
  | EdgeProxy<S, E>
  | undefined

export type QueryContext<
  S extends SchemaShape,
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

export type ResolveProxy<T> = T extends {
  readonly __nodeProxyBrand__: { schema: infer S; label: infer N }
}
  ? S extends SchemaShape
    ? N extends NodeLabels<S>
      ? NodeProps<S, N>
      : never
    : never
  : T extends { readonly __edgeProxyBrand__: { schema: infer S; edge: infer E } }
    ? S extends SchemaShape
      ? E extends EdgeTypes<S>
        ? EdgeProps<S, E>
        : never
      : never
    : T extends Array<infer U>
      ? Array<ResolveProxy<U>>
      : T

export type InferReturnType<T> = { [K in keyof T]: ResolveProxy<T[K]> }

export interface TypedReturnQuery<T> {
  execute(): Promise<Array<T>>
  compile(): { cypher: string; params: Record<string, unknown> }
  toCypher(): string
}
