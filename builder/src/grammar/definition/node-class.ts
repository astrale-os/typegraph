// oxlint-disable typescript/no-explicit-any
import type { ContentShape } from '../facets/content.js'
import type { DefConfigBase } from './base.js'
import type { NodeInterfaceDef } from './node-interface.js'

/** Configuration for a node class (concrete, no endpoints) */
export interface NodeClassConfig extends DefConfigBase {
  readonly inherits?: readonly NodeInterfaceDef<any>[]
  readonly content?: ContentShape
}

/** Branded node class definition */
export interface NodeClassDef<out C extends NodeClassConfig = NodeClassConfig> {
  readonly __kind: 'node-class'
  readonly __brand: unique symbol
  readonly config: C
}
