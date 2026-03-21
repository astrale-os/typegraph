/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Def } from '../defs/definition.js'
import type { ExtractProps, ExtractInherits, InferProps } from './props.js'
import type { ExtractData } from './data.js'

/** Resolve one inherits entry: own props + data + recursive ancestors */
type ResolveInheritsEntry<H extends Def<any>> =
  InferProps<ExtractProps<H>> &
  InferProps<ExtractData<H>> &
  CollectInputFromInherits<ExtractInherits<H>>

/** Collect all props AND data from inherits chain (later entries shadow earlier) */
type CollectInputFromInherits<T> = T extends readonly [
  infer Head extends Def<any>,
  ...infer Tail extends readonly Def<any>[],
]
  ? Omit<ResolveInheritsEntry<Head>, keyof CollectInputFromInherits<Tail>> &
      CollectInputFromInherits<Tail>
  : unknown

/** Full inferred props AND data — own props shadow inherited */
export type ExtractNodeInput<D> =
  D extends Def<any>
    ? Omit<
        CollectInputFromInherits<ExtractInherits<D>>,
        keyof InferProps<ExtractProps<D>> | keyof InferProps<ExtractData<D>>
      > &
        InferProps<ExtractProps<D>> &
        InferProps<ExtractData<D>>
    : unknown
