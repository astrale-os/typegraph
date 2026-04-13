import type { AnyDef } from '../../grammar/definition/discriminants.js'
import type { IndexDef } from '../../grammar/facets/indexes.js'
import type { SchemaContext } from './context.js'

import { SchemaValidationError } from '../error.js'
import { resolveAllPropertyKeys } from '../resolve/properties.js'

/** Validate that all indexed properties exist on the definition or its ancestors */
export function validateIndexes(ctx: SchemaContext): void {
  const allDefs: Record<string, AnyDef> = { ...ctx.interfaces, ...ctx.classes }

  for (const [name, def] of Object.entries(allDefs)) {
    const indexes = def.config.indexes as IndexDef[] | undefined
    if (!indexes) continue

    const available = resolveAllPropertyKeys(def)

    for (const idx of indexes) {
      const prop = typeof idx === 'string' ? idx : idx.property
      if (!available.has(prop)) {
        throw new SchemaValidationError(
          `Index on '${name}' references unknown property '${prop}'`,
          `${name}.indexes`,
          [...available].join(', ') || '(no properties)',
          prop,
        )
      }
    }
  }
}
