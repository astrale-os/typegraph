import { SchemaValidationError } from '../schema.js'
import type { SchemaContext } from './context.js'

export function validateUniqueNames(ctx: SchemaContext): void {
  const allNames = new Set<string>()
  for (const name of Object.keys(ctx.defs)) {
    if (allNames.has(name)) {
      throw new SchemaValidationError(
        `Duplicate definition name '${name}'`,
        'defs',
        'unique names',
        name,
      )
    }
    allNames.add(name)
  }
}
