// oxlint-disable typescript/no-explicit-any
import type { DefConstraints } from '../facets/constraints.js'
import type { EndpointConfig } from '../facets/endpoints.js'
import type { DefConfigBase } from './base.js'
import type { NodeInterfaceDef } from './node-interface.js'

/** Configuration for an edge interface (abstract, has endpoints) */
export interface EdgeInterfaceConfig extends DefConfigBase {
  readonly inherits?: readonly (EdgeInterfaceDef<any, any> | NodeInterfaceDef<any>)[]
  readonly constraints?: DefConstraints
}

/** Branded edge interface definition */
export interface EdgeInterfaceDef<
  out From extends EndpointConfig = EndpointConfig,
  out To extends EndpointConfig = EndpointConfig,
  out C extends EdgeInterfaceConfig = EdgeInterfaceConfig,
> {
  readonly __kind: 'edge-interface'
  readonly __brand: unique symbol
  readonly from: From
  readonly to: To
  readonly config: C
}
