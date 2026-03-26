import type { FnDef } from '../defs/function.js'
import type { AnyDef } from '../defs/index.js'
import type { Schema } from './schema.js'

import { collectAllMethodDefs } from '../helpers/methods.js'
import {
  categorize,
  validateUniqueNames,
  validateInheritance,
  validateEndpoints,
  validateIndexes,
  validateRefTargets,
  validateMethods,
  type SchemaContext,
} from './validators/index.js'

function buildFnsMap(ctx: SchemaContext): Record<string, FnDef> {
  const fns: Record<string, FnDef> = {}
  for (const [name, def] of Object.entries(ctx.defs)) {
    // Only collect methods from concrete (non-abstract) defs
    if (def.config.abstract) continue
    const allMethods = collectAllMethodDefs(def)
    for (const [methodName, fnDef] of Object.entries(allMethods)) {
      fns[`${name}.${methodName}`] = fnDef
    }
  }
  return fns
}

export function defineSchema<const D extends Record<string, AnyDef>>(
  domain: string,
  defs: D,
): Schema<D> {
  const ctx = categorize(domain, defs)
  validateUniqueNames(ctx)
  validateInheritance(ctx)
  validateEndpoints(ctx)
  validateIndexes(ctx)
  validateRefTargets(ctx)
  validateMethods(ctx)
  const fns = buildFnsMap(ctx)
  return {
    domain,
    defs,
    fns,
  } as unknown as Schema<D>
}
