import type { AnyDef } from '../../grammar/definition/discriminants.js'
import type { SchemaContext } from './context.js'

import { isAbstract, isNode } from '../../grammar/definition/discriminants.js'
import { SchemaValidationError } from '../error.js'
import { isKnownDef } from '../refs.js'

/** Validate inheritance rules for all definitions */
export function validateInheritance(ctx: SchemaContext): void {
  const allDefs = { ...ctx.interfaces, ...ctx.classes }

  for (const [name, def] of Object.entries(allDefs)) {
    const parents = def.config.inherits as AnyDef[] | undefined
    if (!parents) continue

    for (const parent of parents) {
      // Rule 3: Inheritance targets exist
      if (!isKnownDef(parent, ctx.identityMap)) {
        throw new SchemaValidationError(
          `Definition '${name}' inherits from an unknown type`,
          `${name}.inherits`,
          'a def in this schema or imported',
          'unknown reference',
        )
      }

      // Rule 5: No concrete inheritance — only abstract can be inherited
      if (!isAbstract(parent)) {
        throw new SchemaValidationError(
          `Definition '${name}' inherits from a concrete type (kind: '${parent.__kind}'). Only interfaces can be inherited.`,
          `${name}.inherits`,
          'node-interface | edge-interface',
          parent.__kind,
        )
      }

      // Rule 4: Kind match — node defs inherit node interfaces only;
      // edge defs can inherit from both edge interfaces and node interfaces (mixins)
      if (isNode(def) && !isNode(parent)) {
        throw new SchemaValidationError(
          `Node definition '${name}' inherits from an edge interface`,
          `${name}.inherits`,
          'node-interface',
          parent.__kind,
        )
      }
    }
  }
}
