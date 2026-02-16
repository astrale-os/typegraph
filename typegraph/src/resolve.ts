/**
 * Type Resolution
 *
 * Conditional types that resolve node/edge names to concrete TypeScript types
 * when a TypeMap is provided, falling back to untyped shapes otherwise.
 *
 * TypeMap is a phantom generic — it exists only at the type level, zero runtime cost.
 */

import type { TypeMap, UntypedMap } from './schema'

/**
 * Resolve the output type for a node label.
 * Uses the concrete type from TypeMap when available, otherwise falls back to untyped.
 */
export type ResolveNode<T extends TypeMap, N extends string> = N extends keyof T['nodes']
  ? T['nodes'][N]
  : { id: string; kind: N } & Record<string, unknown>

/**
 * Resolve the output type for an edge type.
 * Merges structural fields (id, kind) with the edge payload from TypeMap.
 */
export type ResolveEdge<T extends TypeMap, E extends string> = E extends keyof T['edges']
  ? T['edges'][E] & { id: string; kind: E }
  : { id: string; kind: E } & Record<string, unknown>

/**
 * Resolve the input type for creating/updating a node.
 * Falls back to Record<string, unknown> when nodeInputs isn't provided.
 */
export type ResolveNodeInput<T extends TypeMap, N extends string> = T extends {
  nodeInputs: infer I extends Record<string, unknown>
}
  ? N extends keyof I
    ? I[N]
    : Record<string, unknown>
  : Record<string, unknown>

/**
 * Resolve the input type for an edge payload.
 * Returns never for edges without attributes (payload-less edges).
 */
export type ResolveEdgeInput<T extends TypeMap, E extends string> = E extends keyof T['edges']
  ? T['edges'][E] extends Record<string, never>
    ? never
    : T['edges'][E]
  : Record<string, unknown>

/** Check if T is the untyped fallback. */
export type IsUntyped<T extends TypeMap> = T extends UntypedMap ? true : false
