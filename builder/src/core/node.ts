import type { Def } from '../defs/definition.js'
import type { ExtractNodeInput } from '../inference/input.js'
import type { ExtractFullProps } from '../inference/props.js'
import type { CoreNode } from './types.js'

// Guard against infinite recursion when D carries `any` config (e.g. Def<any>).
type IsAny<T> = 0 extends 1 & T ? true : false

// oxlint-disable-next-line no-explicit-any
type NodeInputData<N extends Def<any>> =
  N extends Def<infer C>
    ? [IsAny<C>] extends [true]
      ? Record<string, unknown>
      : [keyof C & ('props' | 'data' | 'extends')] extends [never]
        ? Record<string, unknown>
        : Partial<ExtractNodeInput<N>>
    : Record<string, unknown>

// oxlint-disable-next-line no-explicit-any
type EdgeInputData<E extends Def<any>> =
  E extends Def<infer C>
    ? [IsAny<C>] extends [true]
      ? Record<string, unknown>
      : [keyof C & 'props'] extends [never]
        ? Record<string, unknown>
        : Partial<ExtractFullProps<E>>
    : Record<string, unknown>

/** Create a leaf core node (no children). */
// oxlint-disable-next-line no-explicit-any
export function node<N extends Def<any>>(def: N, data: NodeInputData<N>): CoreNode<N>

/** Create a core node with children. */
// oxlint-disable-next-line no-explicit-any
export function node<N extends Def<any>, C extends Record<string, CoreNode<any, any>>>(
  def: N,
  data: NodeInputData<N>,
  children: C,
): CoreNode<N, C>

/** Implementation. */
export function node(
  def: Def,
  data: Record<string, unknown>,
  children?: Record<string, CoreNode>,
): CoreNode {
  return {
    type: 'core-node',
    __nodeDef: def,
    __data: data as Record<string, unknown>,
    __children: (children ?? {}) as Record<string, never>,
  }
}

export { type NodeInputData, type EdgeInputData }
