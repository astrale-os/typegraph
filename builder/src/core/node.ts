import type { NodeDef } from '../defs/node.js'
import type { EdgeDef } from '../defs/edge.js'
import type { ExtractFullProps } from '../inference/props.js'
import type { ExtractNodeInput } from '../inference/input.js'
import type { CoreInstance } from './types.js'

// Guard against infinite recursion when N/E carries `any` config (e.g. NodeDef<any>).
type IsAny<T> = 0 extends 1 & T ? true : false

type NodeInputData<N extends NodeDef<any>> =
  N extends NodeDef<infer C>
    ? [IsAny<C>] extends [true]
      ? Record<string, unknown>
      : [keyof C & ('props' | 'data' | 'implements' | 'extends')] extends [never]
        ? Record<string, unknown>
        : Partial<ExtractNodeInput<N>>
    : Record<string, unknown>

export function node<N extends NodeDef<any>>(def: N, data: NodeInputData<N>): CoreInstance<N> {
  return { type: 'core-instance', __nodeDef: def, __data: data as Record<string, unknown> }
}

type EdgeInputData<E extends EdgeDef> =
  E extends EdgeDef<any, any, infer C>
    ? [IsAny<C>] extends [true]
      ? Record<string, unknown>
      : [keyof C & 'props'] extends [never]
        ? Record<string, unknown>
        : Partial<ExtractFullProps<E>>
    : Record<string, unknown>

export { type NodeInputData, type EdgeInputData }
