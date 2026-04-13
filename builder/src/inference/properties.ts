import type { z } from 'zod'

import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { PropertyDef } from '../grammar/facets/properties.js'

/** Extract own properties from a def's config */
// biome-ignore lint: empty object type is intentional for fallback
export type ExtractProperties<D> = D extends { config: { properties: infer A } } ? A : {}

/** Infer Zod types in a property shape (handles both bare Zod and PropertyDef) */
export type InferProperties<A> = {
  [K in keyof A]: A[K] extends PropertyDef<infer S>
    ? S extends z.ZodType<infer O>
      ? O
      : never
    : A[K] extends z.ZodType<infer O>
      ? O
      : never
}

/** Extract inherits array from any def */
export type ExtractInherits<D> = D extends {
  config: { inherits: infer I extends readonly AnyDef[] }
}
  ? I
  : readonly []

/** Collect inferred properties from all ancestors as an intersection */
type CollectAncestorProperties<T> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? InferProperties<ExtractProperties<Head>> &
      CollectAncestorProperties<ExtractInherits<Head>> &
      CollectAncestorProperties<Tail>
  : unknown

/** Full inferred properties: own shadow inherited (own keys take precedence) */
export type ExtractFullProperties<D> = D extends AnyDef
  ? Omit<
      CollectAncestorProperties<ExtractInherits<D>>,
      keyof InferProperties<ExtractProperties<D>>
    > &
      InferProperties<ExtractProperties<D>>
  : unknown
