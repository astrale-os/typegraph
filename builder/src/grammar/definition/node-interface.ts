// oxlint-disable typescript/no-explicit-any
import type { ContentShape } from '../facets/content.js'
import type { DefConfigBase } from './base.js'

/** Configuration for a node interface (abstract, no endpoints) */
export interface NodeInterfaceConfig extends DefConfigBase {
  readonly inherits?: readonly NodeInterfaceDef<any>[]
  readonly content?: ContentShape
}

/** Branded node interface definition */
export interface NodeInterfaceDef<out C extends NodeInterfaceConfig = NodeInterfaceConfig> {
  readonly __kind: 'node-interface'
  readonly __brand: unique symbol
  readonly config: C
}
