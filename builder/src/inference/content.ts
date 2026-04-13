import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { ExtractInherits, InferAttributes } from './attributes.js'

/** Extract own content from a def's config */
// biome-ignore lint: empty object type is intentional for fallback
export type ExtractContent<D> = D extends { config: { content: infer C } } ? C : {}

/** Collect inferred content from all ancestors as an intersection */
type CollectAncestorContent<T> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? InferAttributes<ExtractContent<Head>> &
      CollectAncestorContent<ExtractInherits<Head>> &
      CollectAncestorContent<Tail>
  : unknown

/** Full inferred content: own shadow inherited (own keys take precedence) */
export type ExtractFullContent<D> = D extends AnyDef
  ? Omit<CollectAncestorContent<ExtractInherits<D>>, keyof InferAttributes<ExtractContent<D>>> &
      InferAttributes<ExtractContent<D>>
  : unknown

/** Check if a def has any content (own or inherited) */
export type HasContent<D> = keyof ExtractFullContent<D> extends never ? false : true
