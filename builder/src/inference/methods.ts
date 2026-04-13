// oxlint-disable typescript/no-explicit-any
import type { z } from 'zod'

import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { ParamShape } from '../grammar/function/config.js'
import type { FnDef } from '../grammar/function/def.js'
import type { DATA_TAG } from '../grammar/values/data.js'
import type { ExtractInherits, ExtractFullAttributes } from './attributes.js'
import type { ExtractFullContent } from './content.js'

/** Extract own methods from a def's config */
// biome-ignore lint: empty object type is intentional for fallback
export type ExtractMethods<D> = D extends {
  config: { methods: infer M extends Record<string, FnDef> }
}
  ? M
  : {}

/** Collect methods from all ancestors (own + recursive parents) */
type CollectAncestorMethods<T> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? ExtractMethods<Head> &
      CollectAncestorMethods<ExtractInherits<Head>> &
      CollectAncestorMethods<Tail>
  : unknown

/** All methods for a def: own + inherited (own shadows inherited) */
export type AllMethods<D> = D extends AnyDef
  ? Omit<CollectAncestorMethods<ExtractInherits<D>>, keyof ExtractMethods<D>> & ExtractMethods<D>
  : ExtractMethods<D>

/** Check if a def has methods (own or inherited) */
export type HasMethods<D> = keyof AllMethods<D> extends never ? false : true

/** Get method names from a def (own + inherited) */
export type ExtractMethodNames<D> = keyof AllMethods<D> & string

/** Get the config of a specific method */
type GetMethodConfig<D, M extends string> = M extends keyof AllMethods<D>
  ? AllMethods<D>[M] extends FnDef<infer MC>
    ? MC
    : never
  : never

/** Extract resolved params (handles thunks at type level) */
export type ExtractMethodParams<D, M extends string> =
  GetMethodConfig<D, M> extends { params: infer P }
    ? P extends () => infer R
      ? R extends ParamShape
        ? R
        : Record<string, never>
      : P extends ParamShape
        ? P
        : Record<string, never>
    : Record<string, never>

/** Extract return Zod type */
export type ExtractMethodReturns<D, M extends string> =
  GetMethodConfig<D, M> extends {
    returns: infer R
  }
    ? R extends z.ZodType
      ? R
      : never
    : never

/** Resolve return value — handles data() markers */
type MethodReturnValue<D, R extends z.ZodType> = R extends {
  readonly [DATA_TAG]: { readonly kind: 'self' }
}
  ? D extends AnyDef
    ? ExtractFullContent<D>
    : never
  : R extends { readonly [DATA_TAG]: { readonly kind: 'grant'; readonly target: infer T } }
    ? T extends AnyDef
      ? ExtractFullContent<T>
      : unknown
    : z.infer<R>

/** Extract the resolved return value of a method */
export type ExtractMethodReturnValue<D, M extends string> = MethodReturnValue<
  D,
  ExtractMethodReturns<D, M>
>

/** Self type for a method context — attributes + id (+ from/to for edges) */
export type MethodSelf<D> = D extends { from: any; to: any }
  ? ExtractFullAttributes<D> & { readonly id: string; readonly from: string; readonly to: string }
  : ExtractFullAttributes<D> & { readonly id: string }
