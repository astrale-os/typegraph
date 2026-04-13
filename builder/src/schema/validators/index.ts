import type { SchemaContext } from './context.js'

import { validateEndpoints } from './endpoints.js'
import { validateIndexes } from './indexes.js'
import { validateInheritance } from './inheritance.js'
import { validateMethods } from './methods.js'
import { validateUniqueNames } from './names.js'
import { validateRefTargets } from './ref-targets.js'

export type { SchemaContext } from './context.js'
export { validateUniqueNames } from './names.js'
export { validateInheritance } from './inheritance.js'
export { validateEndpoints } from './endpoints.js'
export { validateIndexes } from './indexes.js'
export { validateRefTargets } from './ref-targets.js'
export { validateMethods } from './methods.js'

/** Run all schema validators in sequence */
export function validateSchema(ctx: SchemaContext): void {
  validateUniqueNames(ctx)
  validateInheritance(ctx)
  validateEndpoints(ctx)
  validateIndexes(ctx)
  validateRefTargets(ctx)
  validateMethods(ctx)
}
