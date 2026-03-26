import type { FnDef } from '../../defs/function.js'
import type { AnyDef } from '../../defs/index.js'
import type { SchemaContext } from './context.js'

import { SELF } from '../../defs/ref.js'
import { registerDef } from '../../registry.js'
import { SchemaValidationError } from '../schema.js'

/** Resolve all thunks (config + param) and collect defs. */
export function categorize(domain: string, defs: Record<string, AnyDef>): SchemaContext {
  for (const [name, def] of Object.entries(defs)) {
    resolveThunks(name, def)
    resolveSelfRefs(def.config, def)
    registerDef(def, domain, name)
    Object.defineProperty(def, 'name', {
      value: name,
      enumerable: true,
      writable: false,
      configurable: false,
    })
    if (def.type !== 'def') {
      throw new SchemaValidationError(
        `Unsupported def type '${(def as { type: string }).type}' for '${name}'. Expected def.`,
        `defs.${name}`,
        'def',
        (def as { type: string }).type,
      )
    }
  }

  const allDefValues = new Set<object>(Object.values(defs))
  return { domain, defs, allDefValues }
}

function resolveThunks(name: string, def: AnyDef): void {
  if (typeof def.config === 'function') {
    try {
      ;(def as { config: unknown }).config = (def.config as () => unknown)()
    } catch (e) {
      throw new SchemaValidationError(
        `Failed to resolve config thunk for '${name}': ${String(e)}`,
        name,
        'resolvable config thunk',
        'unresolvable',
      )
    }
  }
  const methods = def.config.methods as Record<string, FnDef> | undefined
  if (methods) {
    for (const [methodName, fnDef] of Object.entries(methods)) {
      if (typeof fnDef.config.params === 'function') {
        try {
          ;(fnDef.config as { params: unknown }).params = (fnDef.config.params as () => unknown)()
        } catch (e) {
          throw new SchemaValidationError(
            `Failed to resolve param thunk for '${name}.${methodName}': ${String(e)}`,
            `${name}.${methodName}.params`,
            'resolvable thunk',
            'unresolvable',
          )
        }
      }
    }
  }
}

/** Replace any ref(SELF) targets with the actual def object. */
function resolveSelfRefs(obj: unknown, actualDef: AnyDef, visited = new WeakSet<object>()): void {
  if (!obj || typeof obj !== 'object' || visited.has(obj)) return
  visited.add(obj)
  const record = obj as Record<string, unknown>
  if (record.__ref_target === SELF) {
    record.__ref_target = actualDef
  }
  for (const value of Object.values(record)) {
    resolveSelfRefs(value, actualDef, visited)
  }
}
