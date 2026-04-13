// oxlint-disable typescript/no-explicit-any
import type { DefConstraints } from '../facets/constraints.js'
import type { EndpointConfig } from '../facets/endpoints.js'
import type { DefConfigBase } from './base.js'
import type { EdgeInterfaceDef } from './edge-interface.js'
import type { NodeInterfaceDef } from './node-interface.js'

/** Configuration for an edge class (concrete, has endpoints) */
export interface EdgeClassConfig extends DefConfigBase {
  readonly inherits?: readonly (EdgeInterfaceDef<any, any> | NodeInterfaceDef<any>)[]
  readonly constraints?: DefConstraints
}

/** Branded edge class definition */
export interface EdgeClassDef<
  out From extends EndpointConfig = EndpointConfig,
  out To extends EndpointConfig = EndpointConfig,
  out C extends EdgeClassConfig = EdgeClassConfig,
> {
  readonly __kind: 'edge-class'
  readonly __brand: unique symbol
  readonly from: From
  readonly to: To
  readonly config: C
}
