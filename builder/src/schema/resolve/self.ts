import type { AnyDef } from '../../grammar/definition/discriminants.js'
import type { REF_TAG } from '../../grammar/values/ref.js'
import type { SELF_TAG } from '../../grammar/values/self.js'

// Runtime symbols matching declared unique symbols
const SELF_TAG_RUNTIME = Symbol.for('SELF_TAG') as typeof SELF_TAG
const REF_TAG_RUNTIME = Symbol.for('REF_TAG') as typeof REF_TAG

/** Check if a value is a SELF token */
function isSelf(value: unknown): boolean {
  return typeof value === 'object' && value !== null && SELF_TAG_RUNTIME in value
}

/**
 * Replace all `ref(SELF)` targets in a def's config tree with the actual def object.
 * Walks the config recursively looking for RefSchema objects whose target is SELF.
 */
export function resolveSelfReferences(def: AnyDef): void {
  walkAndReplace(def.config, def, new WeakSet<object>())
}

function walkAndReplace(obj: unknown, actualDef: AnyDef, visited: WeakSet<object>): void {
  if (!obj || typeof obj !== 'object' || visited.has(obj)) return
  visited.add(obj)

  const record = obj as Record<string | symbol, unknown>

  // Check if this object is a RefSchema with a SELF target
  if (REF_TAG_RUNTIME in record) {
    const refMeta = record[REF_TAG_RUNTIME] as { target: unknown; includeData: boolean }
    if (isSelf(refMeta.target)) {
      ;(refMeta as { target: unknown }).target = actualDef
    }
  }

  // Recurse into all values
  for (const value of Object.values(record)) {
    walkAndReplace(value, actualDef, visited)
  }
}
