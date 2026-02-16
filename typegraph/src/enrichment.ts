/**
 * Node & Edge Enrichment
 *
 * Enriches raw query results with bound method proxies.
 * The proxy intercepts property access to transparently bind method handlers.
 */

import type { MethodsConfig, MethodCallContext } from './methods'

/**
 * Enrich a raw node result with bound method proxies.
 * Returns an object where method names resolve to callable functions.
 *
 * @param type - Node type name (e.g., 'Customer')
 * @param raw  - Raw result object (already has id, data props, etc.)
 * @param methods - Methods config from createGraph
 * @param graph - The Graph instance (passed as method context)
 */
export function enrichNode<T extends Record<string, unknown>>(
  type: string,
  raw: T,
  methods: MethodsConfig | undefined,
  graph: unknown,
): T {
  const handlers = methods?.[type]
  if (!handlers || Object.keys(handlers).length === 0) return raw

  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && handlers[prop]) {
        return (args?: unknown) =>
          handlers[prop]({
            self: target as unknown as MethodCallContext['self'],
            args: args ?? undefined,
            graph,
          })
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

/**
 * Enrich a raw edge result with bound method proxies.
 * Same mechanism as enrichNode but for edge payloads.
 */
export function enrichEdge<T extends Record<string, unknown>>(
  edgeType: string,
  raw: T,
  methods: MethodsConfig | undefined,
  graph: unknown,
): T {
  const handlers = methods?.[edgeType]
  if (!handlers || Object.keys(handlers).length === 0) return raw

  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && handlers[prop]) {
        return (args?: unknown) =>
          handlers[prop]({
            self: target as unknown as MethodCallContext['self'],
            args: args ?? undefined,
            graph,
          })
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}
