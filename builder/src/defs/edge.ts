import type { PropShape, Cardinality } from './common.js'
import type { IfaceDef } from './iface.js'
import type { NodeDef } from './node.js'
import type { OpDef } from './op.js'

export interface EndpointCfg {
  readonly as: string
  readonly types: readonly (IfaceDef<any> | NodeDef<any>)[]
  readonly cardinality?: Cardinality
}

export interface EdgeConfig {
  readonly implements?: readonly IfaceDef<any>[]
  readonly noSelf?: boolean
  readonly acyclic?: boolean
  readonly unique?: boolean
  readonly symmetric?: boolean
  readonly onDeleteSource?: 'cascade' | 'unlink' | 'prevent'
  readonly onDeleteTarget?: 'cascade' | 'unlink' | 'prevent'
  readonly props?: PropShape
  readonly methods?: Record<string, OpDef>
}

export interface EdgeDef<
  out From extends EndpointCfg = EndpointCfg,
  out To extends EndpointCfg = EndpointCfg,
  out C extends EdgeConfig = EdgeConfig,
> {
  readonly type: 'edge'
  readonly _brand: unique symbol
  readonly from: From
  readonly to: To
  readonly config: C
}

export function edgeDef<
  const From extends EndpointCfg,
  const To extends EndpointCfg,
  const C extends EdgeConfig = Record<string, never> & EdgeConfig,
>(from: From, to: To, opts?: C): EdgeDef<From, To, C> {
  return {
    type: 'edge',
    from,
    to,
    config: (opts ?? {}) as C,
  } as EdgeDef<From, To, C>
}
