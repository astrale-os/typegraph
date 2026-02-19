/**
 * Core Refs Proxy
 *
 * Creates a Proxy that enables hierarchical property access to core refs.
 * Supports nested access like `core.electronics.phones` where `electronics`
 * is a parent with children.
 */

import type { CoreRefs } from './core'

/**
 * Creates a Proxy that enables hierarchical property access to core refs.
 *
 * The proxy recursively handles nested structures:
 * - Leaf nodes return the node ID (string)
 * - Parent nodes return another proxy for further traversal
 *
 * @example
 * ```typescript
 * const proxy = createCoreProxy({
 *   electronics: {
 *     phones: 'node-id-123',
 *     laptops: 'node-id-456'
 *   },
 *   admin: 'node-id-789'
 * })
 *
 * proxy.electronics.phones  // → 'node-id-123'
 * proxy.admin               // → 'node-id-789'
 * ```
 */
export function createCoreProxy(refs: CoreRefs): any {
  return new Proxy({} as any, {
    get(_, prop: string) {
      const value = (refs as any)[prop]
      if (typeof value === 'string') return value // Leaf: return ID
      if (typeof value === 'object' && value !== null) {
        return createCoreProxy(value) // Parent: recurse
      }
      return undefined
    },

    has(_, prop) {
      return prop in refs
    },

    ownKeys(_) {
      return Object.keys(refs)
    },

    getOwnPropertyDescriptor(_, prop) {
      if (!(prop in refs)) return undefined
      return { enumerable: true, configurable: true }
    },
  })
}
