import type { Def } from '../defs/definition.js'
import type { OpDef } from '../defs/operation.js'

/** Collect all method OpDef objects (own + inherited) from a def. */
export function collectAllMethodDefs(def: Def): Record<string, OpDef> {
  const out: Record<string, OpDef> = {}

  if (def.config.inherits) {
    for (const parent of def.config.inherits) {
      Object.assign(out, collectAllMethodDefs(parent))
    }
  }

  if (def.config.methods) Object.assign(out, def.config.methods)
  return out
}

/** Collect all method names (own + inherited). */
export function collectAllMethodNames(def: Def): Set<string> {
  return new Set(Object.keys(collectAllMethodDefs(def)))
}
