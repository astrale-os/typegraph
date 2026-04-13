import type { AnyDef } from '../../grammar/definition/discriminants.js'
import type { FnDef } from '../../grammar/function/def.js'
import type { SchemaContext } from './context.js'

import { isConcrete } from '../../grammar/definition/discriminants.js'
import { SchemaValidationError } from '../error.js'
import { resolveAllMethods } from '../resolve/methods.js'

/**
 * Validate method inheritance rules:
 * - Sealed methods are not overridden
 * - Concrete defs implement all inherited abstract methods
 * - Inheritance modifier only allowed on interfaces
 */
export function validateMethods(ctx: SchemaContext): void {
  const allDefs: Record<string, AnyDef> = { ...ctx.interfaces, ...ctx.classes }

  for (const [name, def] of Object.entries(allDefs)) {
    const ownMethods = (def.config.methods as Record<string, FnDef> | undefined) ?? {}

    // Concrete defs must not declare inheritance on own methods
    if (isConcrete(def)) {
      for (const [methodName, fnDef] of Object.entries(ownMethods)) {
        if (fnDef.config.inheritance) {
          throw new SchemaValidationError(
            `Concrete def '${name}' declares '${methodName}' with inheritance '${fnDef.config.inheritance}'. ` +
              `The 'inheritance' modifier is only allowed on interface methods.`,
            `${name}.${methodName}.inheritance`,
            'undefined (no inheritance on concrete defs)',
            fnDef.config.inheritance,
          )
        }
      }
    }

    // Check sealed override violations
    const parents = (def.config.inherits as AnyDef[] | undefined) ?? []
    for (const parent of parents) {
      const parentMethods = resolveAllMethods(parent)
      for (const [methodName, parentFn] of Object.entries(parentMethods)) {
        if (parentFn.config.inheritance === 'sealed' && methodName in ownMethods) {
          throw new SchemaValidationError(
            `Definition '${name}' overrides sealed method '${methodName}'`,
            `${name}.${methodName}`,
            'no override (method is sealed)',
            'override declared',
          )
        }
      }
    }

    // Concrete defs must implement all inherited abstract methods
    if (isConcrete(def)) {
      const allInherited = resolveAllMethods(def)
      for (const [methodName, fnDef] of Object.entries(allInherited)) {
        if (fnDef.config.inheritance === 'abstract' && !(methodName in ownMethods)) {
          throw new SchemaValidationError(
            `Concrete def '${name}' does not implement abstract method '${methodName}'`,
            `${name}.${methodName}`,
            'method implementation',
            'missing',
          )
        }
      }
    }
  }
}
