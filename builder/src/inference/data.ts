/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Def } from '../defs/definition.js'
import type { ExtractInherits, InferProps } from './props.js'

/** Extract own data shape from a def's config */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ExtractData<D> = D extends { config: { data: infer P } } ? P : {}

/** Resolve one inherits entry: own data + recursive ancestors */
type ResolveDataEntry<H extends Def<any>> =
  InferProps<ExtractData<H>> &
  CollectDataFromInherits<ExtractInherits<H>>

/** Collect data from an inherits list (later entries shadow earlier) */
type CollectDataFromInherits<T> = T extends readonly [
  infer Head extends Def<any>,
  ...infer Tail extends readonly Def<any>[],
]
  ? Omit<ResolveDataEntry<Head>, keyof CollectDataFromInherits<Tail>> &
      CollectDataFromInherits<Tail>
  : unknown

/** Full inferred data: own shadow inherited */
export type ExtractFullData<D> =
  D extends Def<any>
    ? Omit<CollectDataFromInherits<ExtractInherits<D>>, keyof InferProps<ExtractData<D>>> &
        InferProps<ExtractData<D>>
    : unknown

/** Check if a def has any data (own or inherited) */
export type HasData<D> = keyof ExtractFullData<D> extends never ? false : true
