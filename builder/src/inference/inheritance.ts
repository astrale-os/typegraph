import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { FnDef } from '../grammar/function/def.js'
import type { ExtractMethods } from './methods.js'
import type { ExtractInherits } from './properties.js'

/** Extract own sealed method keys from a def */
type SealedOwnKeys<D> = {
  [M in keyof ExtractMethods<D> & string]: ExtractMethods<D>[M] extends FnDef<infer C>
    ? C extends { inheritance: 'sealed' }
      ? M
      : never
    : never
}[keyof ExtractMethods<D> & string]

/**
 * Collect sealed method keys via a tail-recursive worklist.
 *
 * Single recursive call per frame — `inherits` of the head get prepended to
 * the worklist so the DAG is flattened. Union accumulates in `Acc`.
 */
type SealedKeysFromInherits<T, Acc = never> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? SealedKeysFromInherits<[...ExtractInherits<Head>, ...Tail], Acc | SealedOwnKeys<Head>>
  : Acc

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

/** Tail-recursive worklist over the inherits DAG. Union accumulates in `Acc`. */
type AbstractKeysFromInherits<T, Acc = never> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? AbstractKeysFromInherits<[...ExtractInherits<Head>, ...Tail], Acc | AbstractOwnKeys<Head>>
  : Acc

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

/** Tail-recursive worklist over the inherits DAG. Union accumulates in `Acc`. */
type DefaultKeysFromInherits<T, Acc = never> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? DefaultKeysFromInherits<[...ExtractInherits<Head>, ...Tail], Acc | DefaultOwnKeys<Head>>
  : Acc

/** Default method keys inherited that are NOT overridden by own methods */
export type InheritedDefaultKeys<D> = D extends AnyDef
  ? Exclude<DefaultKeysFromInherits<ExtractInherits<D>>, keyof ExtractMethods<D>>
  : never

/** Own method keys that need an implementation (sealed or default, not abstract) */
export type ImplementableOwnKeys<D> = DefaultOwnKeys<D> | SealedOwnKeys<D>

/** Check if a def has non-abstract own methods that need an implementation */
export type HasImplementableMethods<D> = ImplementableOwnKeys<D> extends never ? false : true
