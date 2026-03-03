import type { IfaceDef } from '../defs/iface.js'
import type { NodeDef } from '../defs/node.js'
import type { EdgeDef } from '../defs/edge.js'

/** Any def that can carry props. */
type HasPropsDef = IfaceDef | NodeDef | EdgeDef

/** Collect all reachable property names (own + inherited). */
export function collectAvailableProps(def: HasPropsDef): Set<string> {
  const props = new Set<string>()

  if (def.config.props) {
    for (const k of Object.keys(def.config.props)) props.add(k)
  }

  if (def.type === 'iface') {
    if (def.config.extends) {
      for (const parent of def.config.extends) {
        for (const p of collectAvailableProps(parent)) props.add(p)
      }
    }
  } else if (def.type === 'node') {
    if (def.config.implements) {
      for (const i of def.config.implements) {
        for (const p of collectAvailableProps(i)) props.add(p)
      }
    }
    if (def.config.extends) {
      for (const p of collectAvailableProps(def.config.extends)) props.add(p)
    }
  }

  return props
}
