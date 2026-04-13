// oxlint-disable typescript/no-explicit-any
import type { Kind } from '../../grammar/definition/discriminants.js'

/**
 * Internal factory that tags a config with __kind and __brand.
 * Handles thunk wrapping: if config is a function, it's stored as-is
 * and resolved later during defineSchema().
 */
export function createDef<K extends Kind>(kind: K, config: object): any {
  return {
    __kind: kind,
    config,
  }
}

/**
 * Internal factory for edge definitions.
 * Endpoints are top-level, config is the rest.
 */
export function createEdgeDef<K extends Kind>(
  kind: K,
  from: object,
  to: object,
  config?: object,
): any {
  return {
    __kind: kind,
    from,
    to,
    config: config ?? {},
  }
}
