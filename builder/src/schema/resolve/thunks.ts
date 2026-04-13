import type { AnyDef } from '../../grammar/definition/discriminants.js'
import type { FnDef } from '../../grammar/function/def.js'

import { SchemaValidationError } from '../error.js'

/**
 * Resolve config thunks: if a def's config was wrapped in `() => ({...})`,
 * call the thunk and replace the config with its result.
 */
export function resolveConfigThunks(name: string, def: AnyDef): void {
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
}

/**
 * Resolve param thunks: if a method's params was wrapped in `() => ({...})`,
 * call the thunk and replace params with its result.
 */
export function resolveParamThunks(name: string, def: AnyDef): void {
  const methods = def.config.methods as Record<string, FnDef> | undefined
  if (!methods) return

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
