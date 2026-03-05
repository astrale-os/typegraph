import type { Def } from '../defs/def.js'

/** Collect all reachable property names (own + inherited). */
export function collectAvailableProps(def: Def): Set<string> {
  const props = new Set<string>()

  if (def.config.props) {
    for (const k of Object.keys(def.config.props)) props.add(k)
  }

  if (def.config.inherits) {
    for (const parent of def.config.inherits) {
      for (const p of collectAvailableProps(parent)) props.add(p)
    }
  }

  return props
}
