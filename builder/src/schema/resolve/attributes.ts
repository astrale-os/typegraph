import type { AnyDef } from '../../grammar/definition/discriminants.js'
import type { AttributeShape, NormalizedAttribute } from '../../grammar/facets/attributes.js'

import { normalizeAttribute } from '../../grammar/facets/attributes.js'

/**
 * Walk the inheritance chain and collect all attribute keys.
 * Returns a Set of all available attribute names (own + inherited).
 */
export function resolveAllAttributeKeys(def: AnyDef): Set<string> {
  const keys = new Set<string>()

  const inherits = (def.config.inherits as AnyDef[] | undefined) ?? []
  for (const parent of inherits) {
    for (const key of resolveAllAttributeKeys(parent)) {
      keys.add(key)
    }
  }

  const ownAttrs = (def.config.attributes as AttributeShape | undefined) ?? {}
  for (const key of Object.keys(ownAttrs)) {
    keys.add(key)
  }

  return keys
}

/**
 * Walk the inheritance chain and collect all attributes resolved.
 * Own attributes shadow inherited ones.
 */
export function resolveAllAttributes(def: AnyDef): Record<string, NormalizedAttribute> {
  const result: Record<string, NormalizedAttribute> = {}

  const inherits = (def.config.inherits as AnyDef[] | undefined) ?? []
  for (const parent of inherits) {
    const parentAttrs = resolveAllAttributes(parent)
    Object.assign(result, parentAttrs)
  }

  const ownAttrs = (def.config.attributes as AttributeShape | undefined) ?? {}
  for (const [key, prop] of Object.entries(ownAttrs)) {
    result[key] = normalizeAttribute(prop)
  }

  return result
}
