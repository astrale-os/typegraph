import type { EdgeClassConfig, EdgeClassDef } from '../../grammar/definition/edge-class.js'
import type { EndpointConfig } from '../../grammar/facets/endpoints.js'

import { createEdgeDef } from './base.js'

/**
 * Create an edge class (concrete, has endpoints).
 * Endpoints are positional, config is optional.
 */
export function edgeClass<
  const From extends EndpointConfig,
  const To extends EndpointConfig,
  const C extends EdgeClassConfig,
>(from: From, to: To, config?: C): EdgeClassDef<From, To, C & EdgeClassConfig> {
  return createEdgeDef('edge-class', from, to, config)
}
