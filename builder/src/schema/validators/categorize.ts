import type { AnyDef } from '../../defs/index.js'
import type { OpDef } from '../../defs/operation.js'
import { registerDef } from '../../registry.js'
import { SchemaValidationError } from '../schema.js'
import type { SchemaContext } from './context.js'

/** Resolve all thunks (config + param) and collect defs. */
export function categorize(domain: string, defs: Record<string, AnyDef>): SchemaContext {
  for (const [name, def] of Object.entries(defs)) {
    resolveThunks(name, def)
    registerDef(def, domain, name)
    Object.defineProperty(def, 'name', { value: name, enumerable: true, writable: false, configurable: false })
    if (def.type !== 'def') {
      throw new SchemaValidationError(
        `Unsupported def type '${(def as any).type}' for '${name}'. Expected def.`,
        `defs.${name}`,
        'def',
        (def as any).type,
      )
    }
  }

  const allDefValues = new Set<object>(Object.values(defs))
  return { domain, defs, allDefValues }
}

function resolveThunks(name: string, def: AnyDef): void {
  if (typeof def.config === 'function') {
    try {
      ;(def as any).config = (def.config as () => unknown)()
    } catch (e) {
      throw new SchemaValidationError(
        `Failed to resolve config thunk for '${name}': ${String(e)}`,
        name,
        'resolvable config thunk',
        'unresolvable',
      )
    }
  }
  const methods = def.config.methods as Record<string, OpDef> | undefined
  if (methods) {
    for (const [methodName, opDef] of Object.entries(methods)) {
      if (typeof opDef.config.params === 'function') {
        try {
          ;(opDef.config as any).params = (opDef.config.params as () => unknown)()
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
