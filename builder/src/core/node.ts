import type { Def } from '../defs/definition.js'
import type { ExtractFullProps } from '../inference/props.js'
import type { ExtractNodeInput } from '../inference/input.js'
import type { CoreInstance } from './types.js'

// Guard against infinite recursion when D carries `any` config (e.g. Def<any>).
type IsAny<T> = 0 extends 1 & T ? true : false

type NodeInputData<N extends Def<any>> =
  N extends Def<infer C>
    ? [IsAny<C>] extends [true]
      ? Record<string, unknown>
      : [keyof C & ('props' | 'data' | 'extends')] extends [never]
        ? Record<string, unknown>
        : Partial<ExtractNodeInput<N>>
    : Record<string, unknown>

export function node<N extends Def<any>>(def: N, data: NodeInputData<N>): CoreInstance<N> {
  return { type: 'core-instance', __nodeDef: def, __data: data as Record<string, unknown> }
}

type EdgeInputData<E extends Def<any>> =
  E extends Def<infer C>
    ? [IsAny<C>] extends [true]
      ? Record<string, unknown>
      : [keyof C & 'props'] extends [never]
        ? Record<string, unknown>
        : Partial<ExtractFullProps<E>>
    : Record<string, unknown>

export { type NodeInputData, type EdgeInputData }
