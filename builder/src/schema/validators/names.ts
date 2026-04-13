import type { SchemaContext } from './context.js'

import { SchemaValidationError } from '../error.js'

/** Validate that no two definitions share a name within the same group */
export function validateUniqueNames(ctx: SchemaContext): void {
  const interfaceNames = new Set<string>()
  for (const name of Object.keys(ctx.interfaces)) {
    if (interfaceNames.has(name)) {
      throw new SchemaValidationError(
        `Duplicate interface name '${name}'`,
        'interfaces',
        'unique names',
        name,
      )
    }
    interfaceNames.add(name)
  }

  const classNames = new Set<string>()
  for (const name of Object.keys(ctx.classes)) {
    if (classNames.has(name)) {
      throw new SchemaValidationError(
        `Duplicate class name '${name}'`,
        'classes',
        'unique names',
        name,
      )
    }
    classNames.add(name)
  }
}
