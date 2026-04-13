import type {
  EdgeInterfaceConfig,
  EdgeInterfaceDef,
} from '../../grammar/definition/edge-interface.js'
import type { EndpointConfig } from '../../grammar/facets/endpoints.js'

import { createEdgeDef } from './base.js'

/**
 * Create an edge interface (abstract, has endpoints).
 * Endpoints are positional, config is optional.
 */
export function edgeInterface<
  const From extends EndpointConfig,
  const To extends EndpointConfig,
  const C extends EdgeInterfaceConfig,
>(from: From, to: To, config?: C): EdgeInterfaceDef<From, To, C & EdgeInterfaceConfig> {
  return createEdgeDef('edge-interface', from, to, config)
}
