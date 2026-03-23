/* eslint-disable @typescript-eslint/no-explicit-any */
import type { z } from 'zod'
import type { OpDef } from '../defs/operation.js'
import type { ParamShape } from '../defs/operation.js'
import type { Def } from '../defs/definition.js'
import type { ExtractInherits, ExtractFullProps } from './props.js'
import type { ExtractFullData } from './data.js'

/** Extract own methods from a def's config (not inherited) */
export type ExtractMethods<D> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  D extends { config: { methods: infer M extends Record<string, OpDef> } } ? M : {}

/** Collect methods from an inherits list (own + recursive parents) */
type CollectMethodsFromInherits<T> = T extends readonly [
  infer Head extends Def<any>,
  ...infer Tail extends readonly Def<any>[],
]
  ? ExtractMethods<Head> &
      CollectMethodsFromInherits<ExtractInherits<Head>> &
      CollectMethodsFromInherits<Tail>
  : unknown

/** All methods for a def: own + inherited from inherits chain (own shadows inherited) */
export type AllMethods<D> =
  D extends Def<any>
    ? Omit<CollectMethodsFromInherits<ExtractInherits<D>>, keyof ExtractMethods<D>> &
        ExtractMethods<D>
    : ExtractMethods<D>

/** Check if a def has methods (own or inherited) */
export type HasMethods<D> = keyof AllMethods<D> extends never ? false : true

/** Get method names from a def (own + inherited) */
export type ExtractMethodNames<D> = keyof AllMethods<D> & string

/** Get the config of a specific method (own or inherited) */
type GetMethodConfig<D, M extends string> = M extends keyof AllMethods<D>
  ? AllMethods<D>[M] extends OpDef<infer MC>
    ? MC
    : never
  : never

/** Check if a specific method on a def is static */
export type IsStaticMethod<D, M extends string> =
  GetMethodConfig<D, M> extends { static: true } ? true : false

/** Extract resolved params (handles thunks at type level) */
export type ExtractMethodParams<D, M extends string> =
  GetMethodConfig<D, M> extends { params: infer P }
    ? P extends (() => infer R extends ParamShape)
      ? R
      : P extends ParamShape
        ? P
        : Record<string, never>
    : Record<string, never>

/** Extract return type */
export type ExtractMethodReturns<D, M extends string> =
  GetMethodConfig<D, M> extends { returns: infer R extends z.ZodType } ? R : never

type MethodReturnValue<D, R extends z.ZodType> = R extends { readonly __data_self: true }
  ? D extends Def<any>
    ? ExtractFullData<D>
    : never
  : R extends { readonly __data_grant: true; readonly __data_target: infer T }
    ? T extends Def<any>
      ? ExtractFullData<T>
      : unknown
    : z.infer<R>

export type ExtractMethodReturnValue<D, M extends string> = MethodReturnValue<
  D,
  ExtractMethodReturns<D, M>
>

/** Self type for a method context */
export type MethodSelf<D> =
  D extends Def<infer C>
    ? C extends { endpoints: readonly [any, any] }
      ? ExtractFullProps<D> & {
          readonly id: string
          readonly from: string
          readonly to: string
        }
      : ExtractFullProps<D> & { readonly id: string }
    : { readonly id: string }

// ── Method inheritance type-level utilities ───────────────────────────────

/** Extract the inheritance of a specific method. No inheritance = 'default'. */
export type ExtractMethodInheritance<D, M extends string> =
  GetMethodConfig<D, M> extends { inheritance: 'sealed' }
    ? 'sealed'
    : GetMethodConfig<D, M> extends { inheritance: 'abstract' }
      ? 'abstract'
      : 'default'

/** Extract own sealed method keys from a def */
type SealedOwnKeys<D> = {
  [M in keyof ExtractMethods<D> & string]: ExtractMethods<D>[M] extends OpDef<infer C>
    ? C extends { inheritance: 'sealed' }
      ? M
      : never
    : never
}[keyof ExtractMethods<D> & string]

/** Collect sealed method keys recursively from inherits chain */
type SealedKeysFromInherits<T> = T extends readonly [
  infer Head extends Def<any>,
  ...infer Tail extends readonly Def<any>[],
]
  ?
      | SealedOwnKeys<Head>
      | SealedKeysFromInherits<ExtractInherits<Head>>
      | SealedKeysFromInherits<Tail>
  : never

/** All sealed method keys for a def (own + inherited) */
export type AllSealedKeys<D> =
  D extends Def<any> ? SealedOwnKeys<D> | SealedKeysFromInherits<ExtractInherits<D>> : never

/** Extract own abstract method keys from a def */
type AbstractOwnKeys<D> = {
  [M in keyof ExtractMethods<D> & string]: ExtractMethods<D>[M] extends OpDef<infer C>
    ? C extends { inheritance: 'abstract' }
      ? M
      : never
    : never
}[keyof ExtractMethods<D> & string]

/** Collect abstract method keys recursively from inherits chain (only if not overridden) */
type AbstractKeysFromInherits<T> = T extends readonly [
  infer Head extends Def<any>,
  ...infer Tail extends readonly Def<any>[],
]
  ?
      | Exclude<AbstractOwnKeys<Head>, keyof ExtractMethods<Head>>
      | AbstractKeysFromInherits<ExtractInherits<Head>>
      | AbstractKeysFromInherits<Tail>
  : never

/** All abstract method keys inherited (not own) that need implementation */
export type InheritedAbstractKeys<D> =
  D extends Def<any>
    ? Exclude<AbstractKeysFromInherits<ExtractInherits<D>>, keyof ExtractMethods<D>>
    : never

/** Extract own default (non-abstract, non-sealed) method keys from a def */
type DefaultOwnKeys<D> = {
  [M in keyof ExtractMethods<D> & string]: ExtractMethods<D>[M] extends OpDef<infer C>
    ? C extends { inheritance: 'sealed' | 'abstract' }
      ? never
      : M
    : never
}[keyof ExtractMethods<D> & string]

/** Default method keys inherited that are NOT overridden — these don't need class impl */
type DefaultKeysFromInherits<T> = T extends readonly [
  infer Head extends Def<any>,
  ...infer Tail extends readonly Def<any>[],
]
  ?
      | DefaultOwnKeys<Head>
      | DefaultKeysFromInherits<ExtractInherits<Head>>
      | DefaultKeysFromInherits<Tail>
  : never

/** All inherited default method keys for a def (own excluded, these use the interface impl) */
export type InheritedDefaultKeys<D> =
  D extends Def<any>
    ? Exclude<DefaultKeysFromInherits<ExtractInherits<D>>, keyof ExtractMethods<D>>
    : never

/** All default method keys from the parent chain (includes keys overridden by own methods) */
export type AllParentDefaultKeys<D> =
  D extends Def<any> ? DefaultKeysFromInherits<ExtractInherits<D>> : never

/** Own method keys that need an implementation (sealed or default, not abstract) */
export type ImplementableOwnKeys<D> = DefaultOwnKeys<D> | SealedOwnKeys<D>

/**
 * Check if a def has non-abstract own methods (default or sealed) that need an implementation.
 * Used to determine if an interface needs to appear in SchemaMethodsImpl.
 */
export type HasImplementableMethods<D> = ImplementableOwnKeys<D> extends never ? false : true
