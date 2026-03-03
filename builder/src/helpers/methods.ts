import type { IfaceDef } from '../defs/iface.js'
import type { NodeDef } from '../defs/node.js'
import type { EdgeDef } from '../defs/edge.js'
import type { OpDef } from '../defs/op.js'

/** Any def that can carry methods. */
type HasMethodsDef = IfaceDef | NodeDef | EdgeDef

/** Collect all method OpDef objects (own + inherited) from a def. */
export function collectAllMethodDefs(def: HasMethodsDef): Record<string, OpDef> {
  const out: Record<string, OpDef> = {}

  if (def.type === 'iface') {
    if (def.config.extends) {
      for (const parent of def.config.extends) collectIfaceMethodDefs(parent, out)
    }
  } else if (def.type === 'node') {
    if (def.config.implements) {
      for (const i of def.config.implements) collectIfaceMethodDefs(i, out)
    }
    if (def.config.extends) Object.assign(out, collectAllMethodDefs(def.config.extends))
  }

  if (def.config.methods) Object.assign(out, def.config.methods)
  return out
}

function collectIfaceMethodDefs(def: IfaceDef, out: Record<string, OpDef>): void {
  if (def.config.extends) {
    for (const parent of def.config.extends) collectIfaceMethodDefs(parent, out)
  }
  if (def.config.methods) Object.assign(out, def.config.methods)
}

/** Collect all method names (own + inherited). */
export function collectAllMethodNames(def: HasMethodsDef): Set<string> {
  return new Set(Object.keys(collectAllMethodDefs(def)))
}
