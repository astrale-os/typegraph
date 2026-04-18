import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { ExtractInherits, InferProperties } from './properties.js'

/** Extract own content from a def's config */
// biome-ignore lint: empty object type is intentional for fallback
export type ExtractContent<D> = D extends { config: { content: infer C } } ? C : {}

/**
 * Collect inferred content from all ancestors via a tail-recursive worklist.
 *
 * Visits one def per frame; `inherits` are prepended so the DAG is flattened
 * without branching recursion. Eligible for TS tuple tail-call optimization.
 */
type CollectAncestorContent<T, Acc = unknown> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? CollectAncestorContent<
      [...ExtractInherits<Head>, ...Tail],
      Acc & InferProperties<ExtractContent<Head>>
    >
  : Acc

/** Full inferred content: own shadow inherited (own keys take precedence) */
export type ExtractFullContent<D> = D extends AnyDef
  ? Omit<CollectAncestorContent<ExtractInherits<D>>, keyof InferProperties<ExtractContent<D>>> &
      InferProperties<ExtractContent<D>>
  : unknown

/** Check if a def has any content (own or inherited) */
export type HasContent<D> = keyof ExtractFullContent<D> extends never ? false : true
