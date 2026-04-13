import type { NodeClassConfig, NodeClassDef } from '../../grammar/definition/node-class.js'

import { createDef } from './base.js'

/**
 * Create a node class (concrete, no endpoints).
 * Accepts a config object or a thunk for forward references.
 */
export function nodeClass<const C extends NodeClassConfig>(config: C | (() => C)): NodeClassDef<C> {
  return createDef('node-class', typeof config === 'function' ? config : config)
}
