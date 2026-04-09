import type { Def } from '../defs/definition.js'

import { normalizeProp } from '../defs/property.js'

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

/** Collect all reachable private property names (own + inherited). */
export function collectPrivateProps(def: Def): Set<string> {
  const props = new Set<string>()

  if (def.config.inherits) {
    for (const parent of def.config.inherits) {
      for (const p of collectPrivateProps(parent)) props.add(p)
    }
  }

  // Own props shadow inherited (applied last)
  if (def.config.props) {
    for (const [k, input] of Object.entries(def.config.props)) {
      const { private: isPrivate } = normalizeProp(input)
      if (isPrivate) props.add(k)
      else props.delete(k)
    }
  }

  return props
}
