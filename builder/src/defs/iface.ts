import type { PropShape, DataShape, IndexDef } from './common.js'
import type { OpDef } from './op.js'

export interface IfaceConfig {
  readonly extends?: readonly IfaceDef<any>[]
  readonly props?: PropShape
  readonly data?: DataShape
  readonly indexes?: readonly IndexDef[]
  readonly methods?: Record<string, OpDef>
}

export interface IfaceDef<out C extends IfaceConfig = IfaceConfig> {
  readonly type: 'iface'
  readonly _brand: unique symbol
  readonly config: C
}

export function iface<const C extends IfaceConfig>(config: C | (() => C)): IfaceDef<C> {
  return { type: 'iface', config } as IfaceDef<C>
}
