import type { AnyDef } from '../../grammar/definition/discriminants.js'
import type { PropertyShape, NormalizedProperty } from '../../grammar/facets/properties.js'

import { normalizeProperty } from '../../grammar/facets/properties.js'

/**
 * Walk the inheritance chain and collect all property keys.
 * Returns a Set of all available property names (own + inherited).
 */
export function resolveAllPropertyKeys(def: AnyDef): Set<string> {
  const keys = new Set<string>()

  const inherits = (def.config.inherits as AnyDef[] | undefined) ?? []
  for (const parent of inherits) {
    for (const key of resolveAllPropertyKeys(parent)) {
      keys.add(key)
    }
  }

  const ownProps = (def.config.properties as PropertyShape | undefined) ?? {}
  for (const key of Object.keys(ownProps)) {
    keys.add(key)
  }

  return keys
}

/**
 * Walk the inheritance chain and collect all properties resolved.
 * Own properties shadow inherited ones.
 */
export function resolveAllProperties(def: AnyDef): Record<string, NormalizedProperty> {
  const result: Record<string, NormalizedProperty> = {}

  const inherits = (def.config.inherits as AnyDef[] | undefined) ?? []
  for (const parent of inherits) {
    const parentProps = resolveAllProperties(parent)
    Object.assign(result, parentProps)
  }

  const ownProps = (def.config.properties as PropertyShape | undefined) ?? {}
  for (const [key, prop] of Object.entries(ownProps)) {
    result[key] = normalizeProperty(prop)
  }

  return result
}
