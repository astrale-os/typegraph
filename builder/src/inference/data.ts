/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Def } from '../defs/definition.js'
import type { ExtractInherits, InferProps } from './props.js'

/** Extract own data shape from a def's config */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ExtractData<D> = D extends { config: { data: infer P } } ? P : {}

/** Collect data from an inherits list (own + recursive parents) */
type CollectDataFromInherits<T> = T extends readonly [
  infer Head extends Def<any>,
  ...infer Tail extends readonly Def<any>[],
]
  ? InferProps<ExtractData<Head>> &
      CollectDataFromInherits<ExtractInherits<Head>> &
      CollectDataFromInherits<Tail>
  : unknown

/** Full inferred data: own + inherited from inherits chain */
export type ExtractFullData<D> =
  D extends Def<any>
    ? InferProps<ExtractData<D>> & CollectDataFromInherits<ExtractInherits<D>>
    : unknown

/** Check if a def has any data (own or inherited) */
export type HasData<D> = keyof ExtractFullData<D> extends never ? false : true
