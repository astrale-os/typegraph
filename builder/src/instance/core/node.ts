// oxlint-disable typescript/no-explicit-any
import type { AnyNodeDef } from '../../grammar/definition/discriminants.js'
import type { CoreNode } from './types.js'

/** Create a leaf core node (no children) */
export function node<N extends AnyNodeDef>(def: N, data: Record<string, unknown>): CoreNode<N>
/** Create a core node with children */
export function node<N extends AnyNodeDef, C extends Record<string, CoreNode<any, any>>>(
  def: N,
  data: Record<string, unknown>,
  children: C,
): CoreNode<N, C>
export function node(
  def: AnyNodeDef,
  data: Record<string, unknown>,
  children?: Record<string, CoreNode>,
): CoreNode {
  return {
    type: 'core-node',
    __nodeDef: def,
    __data: data,
    __children: (children ?? {}) as Record<string, never>,
  }
}
