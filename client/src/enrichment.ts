/**
 * Node & Edge Enrichment
 *
 * Enriches raw query results with method dispatch proxies.
 * When a method name is accessed, the proxy dispatches through the kernel's
 * operation pipeline via the stored dispatch function.
 */

import type { MethodDispatchFn, OperationSelf } from './methods'

import { MethodNotDispatchedError } from './errors'

/**
 * Enrich a raw node result with method dispatch proxies.
 *
 * @param type - Node type name (e.g., 'Customer')
 * @param raw  - Raw result object (already has id, data props, etc.)
 * @param methodNames - Method names available on this type (from schema metadata)
 * @param dispatch - Operation dispatcher (kernel.call)
 * @param auth - Auth context captured from graph.as(auth)
 */
export function enrichNode<T extends Record<string, unknown>>(
  type: string,
  raw: T,
  methodNames: string[],
  dispatch: MethodDispatchFn | undefined,
  auth: unknown,
): T {
  if (!methodNames.length) return raw

  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && methodNames.includes(prop)) {
        if (!dispatch) throw new MethodNotDispatchedError(type, prop)
        return (args?: unknown) =>
          dispatch(`${type}.${prop}`, auth, args ?? undefined, target as unknown as OperationSelf)
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

/**
 * Enrich a raw edge result with method dispatch proxies.
 * Same mechanism as enrichNode but for edge payloads.
 */
export function enrichEdge<T extends Record<string, unknown>>(
  edgeType: string,
  raw: T,
  methodNames: string[],
  dispatch: MethodDispatchFn | undefined,
  auth: unknown,
): T {
  if (!methodNames.length) return raw

  return new Proxy(raw, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && methodNames.includes(prop)) {
        if (!dispatch) throw new MethodNotDispatchedError(edgeType, prop)
        return (args?: unknown) =>
          dispatch(
            `${edgeType}.${prop}`,
            auth,
            args ?? undefined,
            target as unknown as OperationSelf,
          )
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}
