import type { IndexDef } from '../../defs/indexing.js'
import { collectAvailableProps } from '../../helpers/props.js'
import { SchemaValidationError } from '../schema.js'
import type { SchemaContext } from './context.js'

export function validateIndexes(ctx: SchemaContext): void {
  for (const [name, def] of Object.entries(ctx.defs)) {
    const indexes = def.config.indexes as IndexDef[] | undefined
    if (!indexes) continue
    const available = collectAvailableProps(def)
    for (const idx of indexes) {
      const prop = typeof idx === 'string' ? idx : idx.property
      if (!available.has(prop)) {
        throw new SchemaValidationError(
          `Index on '${name}' references unknown property '${prop}'`,
          `${name}.indexes`,
          [...available].join(', ') || '(no props)',
          prop,
        )
      }
    }
  }
}
