/* eslint-disable @typescript-eslint/no-explicit-any */
import type { z } from 'zod'
import type { Def } from '../defs/definition.js'

/** Extract own props from a def's config */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ExtractProps<D> = D extends { config: { props: infer P } } ? P : {}

/** Infer Zod types in a PropShape to their runtime values */
export type InferProps<P> = {
  [K in keyof P]: P[K] extends z.ZodType<infer O> ? O : never
}

// ── Traversal helpers ────────────────────────────────────────────────

/** Extract inherits array from a Def */
export type ExtractInherits<D> =
  D extends Def<infer C>
    ? C extends { inherits: infer I extends readonly Def<any>[] }
      ? I
      : readonly []
    : readonly []

/** Collect props from an inherits list (own + recursive parents) */
export type CollectPropsFromInherits<T> = T extends readonly [
  infer Head extends Def<any>,
  ...infer Tail extends readonly Def<any>[],
]
  ? InferProps<ExtractProps<Head>> &
      CollectPropsFromInherits<ExtractInherits<Head>> &
      CollectPropsFromInherits<Tail>
  : unknown

/** Full inferred props: own + inherited from inherits chain */
export type ExtractFullProps<D> =
  D extends Def<any>
    ? InferProps<ExtractProps<D>> & CollectPropsFromInherits<ExtractInherits<D>>
    : unknown
