import type { Def } from '../../defs/definition.js'
import type { SchemaContext } from './context.js'

import { hasDefName } from '../../registry.js'
import { SchemaValidationError } from '../schema.js'

export function validateInheritance(ctx: SchemaContext): void {
  const isKnownDef = (target: object): boolean => ctx.allDefValues.has(target) || hasDefName(target)

  for (const [name, def] of Object.entries(ctx.defs)) {
    const parents = def.config.inherits as Def[] | undefined
    if (!parents) continue
    for (const parent of parents) {
      if (!isKnownDef(parent)) {
        throw new SchemaValidationError(
          `Definition '${name}' inherits from an unknown type`,
          `${name}.inherits`,
          'a def in this schema or registered in another schema',
          'unknown reference',
        )
      }
      // TODO: optionally enforce that inherits targets are abstract
      // (relaxed for now to support concrete-inherits-concrete patterns)
    }
  }
}
