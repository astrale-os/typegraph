/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Def } from '../defs/definition.js'
import type { ExtractProps, ExtractInherits, InferProps } from './props.js'
import type { ExtractData } from './data.js'

/** Collect all props AND data from inherits chain — single traversal */
type CollectInputFromInherits<T> = T extends readonly [
  infer Head extends Def<any>,
  ...infer Tail extends readonly Def<any>[],
]
  ? InferProps<ExtractProps<Head>> &
      InferProps<ExtractData<Head>> &
      CollectInputFromInherits<ExtractInherits<Head>> &
      CollectInputFromInherits<Tail>
  : unknown

/** Full inferred props AND data — single traversal for node() input */
export type ExtractNodeInput<D> =
  D extends Def<any>
    ? InferProps<ExtractProps<D>> &
        InferProps<ExtractData<D>> &
        CollectInputFromInherits<ExtractInherits<D>>
    : unknown
