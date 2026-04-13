import type { AnyDef } from '../../grammar/definition/discriminants.js'
import type { IndexDef } from '../../grammar/facets/indexes.js'
import type { SchemaContext } from './context.js'

import { SchemaValidationError } from '../error.js'
import { resolveAllAttributeKeys } from '../resolve/attributes.js'

/** Validate that all indexed attributes exist on the definition or its ancestors */
export function validateIndexes(ctx: SchemaContext): void {
  const allDefs: Record<string, AnyDef> = { ...ctx.interfaces, ...ctx.classes }

  for (const [name, def] of Object.entries(allDefs)) {
    const indexes = def.config.indexes as IndexDef[] | undefined
    if (!indexes) continue

    const available = resolveAllAttributeKeys(def)

    for (const idx of indexes) {
      const attr = typeof idx === 'string' ? idx : idx.attribute
      if (!available.has(attr)) {
        throw new SchemaValidationError(
          `Index on '${name}' references unknown attribute '${attr}'`,
          `${name}.indexes`,
          [...available].join(', ') || '(no attributes)',
          attr,
        )
      }
    }
  }
}
