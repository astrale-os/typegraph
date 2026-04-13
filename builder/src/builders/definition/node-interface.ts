import type {
  NodeInterfaceConfig,
  NodeInterfaceDef,
} from '../../grammar/definition/node-interface.js'

import { createDef } from './base.js'

/**
 * Create a node interface (abstract, no endpoints).
 * Accepts a config object or a thunk for forward references.
 */
export function nodeInterface<const C extends NodeInterfaceConfig>(
  config: C | (() => C),
): NodeInterfaceDef<C> {
  return createDef('node-interface', config)
}
