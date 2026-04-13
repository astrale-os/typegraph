import type { AnyDef } from '../../grammar/definition/discriminants.js'
import type { FnDef } from '../../grammar/function/def.js'

/**
 * Walk the inheritance chain and collect all methods for a definition.
 * Own methods shadow inherited ones.
 */
export function resolveAllMethods(def: AnyDef): Record<string, FnDef> {
  const result: Record<string, FnDef> = {}

  // Collect from ancestors first (later inherits entries shadow earlier ones)
  const inherits = (def.config.inherits as AnyDef[] | undefined) ?? []
  for (const parent of inherits) {
    const parentMethods = resolveAllMethods(parent)
    Object.assign(result, parentMethods)
  }

  // Own methods shadow inherited
  const ownMethods = (def.config.methods as Record<string, FnDef> | undefined) ?? {}
  Object.assign(result, ownMethods)

  return result
}
