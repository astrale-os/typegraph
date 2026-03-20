import type { OpDef } from '../defs/operation.js'
import type { AnyDef } from '../defs/index.js'
import { collectAllMethodDefs } from '../helpers/methods.js'
import type { Schema } from './schema.js'
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

function buildOpsMap(ctx: SchemaContext): Record<string, OpDef> {
  const ops: Record<string, OpDef> = {}
  for (const [name, def] of Object.entries(ctx.defs)) {
    // Only collect methods from concrete (non-abstract) defs
    if (def.config.abstract) continue
    const allMethods = collectAllMethodDefs(def)
    for (const [methodName, opDef] of Object.entries(allMethods)) {
      ops[`${name}.${methodName}`] = opDef
    }
  }
  return ops
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
  const ops = buildOpsMap(ctx)
  return {
    domain,
    defs,
    ops,
  } as unknown as Schema<D>
}
