import type { OpDef } from '../../defs/operation.js'
import type { SchemaContext } from './context.js'

import { SchemaValidationError } from '../schema.js'

/**
 * Validates that concrete (non-abstract) defs do not declare `inheritance`
 * on their own methods. Only `static` is allowed on concrete def methods.
 * `inheritance` (`sealed` | `abstract` | `default`) only makes sense on
 * interface methods.
 */
export function validateMethods(ctx: SchemaContext): void {
  for (const [name, def] of Object.entries(ctx.defs)) {
    if (def.config.abstract) continue

    const methods = def.config.methods as Record<string, OpDef> | undefined
    if (!methods) continue

    for (const [methodName, opDef] of Object.entries(methods)) {
      if (opDef.config.inheritance) {
        throw new SchemaValidationError(
          `Concrete def '${name}' declares '${methodName}' with inheritance '${opDef.config.inheritance}'. ` +
            `The 'inheritance' modifier is only allowed on interface methods. ` +
            `Use 'static' for class-level operations instead.`,
          `${name}.${methodName}.inheritance`,
          'undefined (no inheritance on concrete defs)',
          opDef.config.inheritance,
        )
      }
    }
  }
}
