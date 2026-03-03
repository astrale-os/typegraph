import type { PropShape, DataShape, IndexDef } from './common.js'
import type { IfaceDef } from './iface.js'
import type { OpDef } from './op.js'

export interface NodeConfig {
  readonly extends?: NodeDef<any>
  readonly implements?: readonly IfaceDef<any>[]
  readonly props?: PropShape
  readonly data?: DataShape
  readonly indexes?: readonly IndexDef[]
  readonly methods?: Record<string, OpDef>
}

export interface NodeDef<out C extends NodeConfig = NodeConfig> {
  readonly type: 'node'
  readonly _brand: unique symbol
  readonly config: C
}

export function rawNodeDef<const C extends NodeConfig>(config: C | (() => C)): NodeDef<C> {
  return { type: 'node', config } as NodeDef<C>
}
