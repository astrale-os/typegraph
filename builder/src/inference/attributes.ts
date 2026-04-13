import type { z } from 'zod'

import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { AttributeDef } from '../grammar/facets/attributes.js'

/** Extract own attributes from a def's config */
// biome-ignore lint: empty object type is intentional for fallback
export type ExtractAttributes<D> = D extends { config: { attributes: infer A } } ? A : {}

/** Infer Zod types in an attribute shape (handles both bare Zod and AttributeDef) */
export type InferAttributes<A> = {
  [K in keyof A]: A[K] extends AttributeDef<infer S>
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

/** Collect inferred attributes from all ancestors as an intersection */
type CollectAncestorAttributes<T> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? InferAttributes<ExtractAttributes<Head>> &
      CollectAncestorAttributes<ExtractInherits<Head>> &
      CollectAncestorAttributes<Tail>
  : unknown

/** Full inferred attributes: own shadow inherited (own keys take precedence) */
export type ExtractFullAttributes<D> = D extends AnyDef
  ? Omit<
      CollectAncestorAttributes<ExtractInherits<D>>,
      keyof InferAttributes<ExtractAttributes<D>>
    > &
      InferAttributes<ExtractAttributes<D>>
  : unknown
