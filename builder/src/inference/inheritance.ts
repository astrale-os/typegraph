import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { FnDef } from '../grammar/function/def.js'
import type { ExtractInherits } from './attributes.js'
import type { ExtractMethods } from './methods.js'

/** Extract own sealed method keys from a def */
type SealedOwnKeys<D> = {
  [M in keyof ExtractMethods<D> & string]: ExtractMethods<D>[M] extends FnDef<infer C>
    ? C extends { inheritance: 'sealed' }
      ? M
      : never
    : never
}[keyof ExtractMethods<D> & string]

/** Collect sealed method keys recursively from inherits chain */
type SealedKeysFromInherits<T> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ?
      | SealedOwnKeys<Head>
      | SealedKeysFromInherits<ExtractInherits<Head>>
      | SealedKeysFromInherits<Tail>
  : never

/** All sealed method keys for a def (own + inherited) */
export type AllSealedKeys<D> = D extends AnyDef
  ? SealedOwnKeys<D> | SealedKeysFromInherits<ExtractInherits<D>>
  : never

/** Extract own abstract method keys from a def */
type AbstractOwnKeys<D> = {
  [M in keyof ExtractMethods<D> & string]: ExtractMethods<D>[M] extends FnDef<infer C>
    ? C extends { inheritance: 'abstract' }
      ? M
      : never
    : never
}[keyof ExtractMethods<D> & string]

/** Collect abstract method keys from inherits chain */
type AbstractKeysFromInherits<T> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ?
      | AbstractOwnKeys<Head>
      | AbstractKeysFromInherits<ExtractInherits<Head>>
      | AbstractKeysFromInherits<Tail>
  : never

/** Abstract method keys inherited that still need implementation (not overridden by own methods) */
export type InheritedAbstractKeys<D> = D extends AnyDef
  ? Exclude<AbstractKeysFromInherits<ExtractInherits<D>>, keyof ExtractMethods<D>>
  : never

/** Extract own default (non-abstract, non-sealed) method keys from a def */
type DefaultOwnKeys<D> = {
  [M in keyof ExtractMethods<D> & string]: ExtractMethods<D>[M] extends FnDef<infer C>
    ? C extends { inheritance: 'sealed' | 'abstract' }
      ? never
      : M
    : never
}[keyof ExtractMethods<D> & string]

/** Default method keys from inherits chain */
type DefaultKeysFromInherits<T> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ?
      | DefaultOwnKeys<Head>
      | DefaultKeysFromInherits<ExtractInherits<Head>>
      | DefaultKeysFromInherits<Tail>
  : never

/** Default method keys inherited that are NOT overridden by own methods */
export type InheritedDefaultKeys<D> = D extends AnyDef
  ? Exclude<DefaultKeysFromInherits<ExtractInherits<D>>, keyof ExtractMethods<D>>
  : never

/** Own method keys that need an implementation (sealed or default, not abstract) */
export type ImplementableOwnKeys<D> = DefaultOwnKeys<D> | SealedOwnKeys<D>

/** Check if a def has non-abstract own methods that need an implementation */
export type HasImplementableMethods<D> = ImplementableOwnKeys<D> extends never ? false : true
