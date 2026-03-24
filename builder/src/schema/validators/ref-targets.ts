import type { OpDef } from '../../defs/operation.js'
import type { SchemaContext } from './context.js'

import { hasDefName } from '../../registry.js'
import { SchemaValidationError } from '../schema.js'

interface ZodInternals {
  element?: unknown
  innerType?: unknown
  _def?: { innerType?: unknown; type?: unknown }
}

function extractRefTargets(schema: unknown): object[] {
  if (schema === null || typeof schema !== 'object') return []
  const targets: object[] = []
  const s = schema as Record<string, unknown>
  if ('__ref_target' in s) targets.push(s.__ref_target as object)
  const zs = s as ZodInternals
  const inner = zs.element ?? zs.innerType ?? zs._def?.innerType ?? zs._def?.type
  if (inner && typeof inner === 'object') targets.push(...extractRefTargets(inner))
  return targets
}

export function validateRefTargets(ctx: SchemaContext): void {
  const isKnownDef = (target: object): boolean => ctx.allDefValues.has(target) || hasDefName(target)

  const validateOpRefs = (path: string, opDef: OpDef) => {
    const params = opDef.config.params
    if (params && typeof params === 'object' && typeof params !== 'function') {
      for (const [paramName, paramSchema] of Object.entries(params as Record<string, unknown>)) {
        for (const target of extractRefTargets(paramSchema)) {
          if (!isKnownDef(target)) {
            throw new SchemaValidationError(
              `'${path}' param '${paramName}' references an unknown def`,
              `${path}.params.${paramName}`,
              'a def in this schema or registered in another schema',
              'unknown reference',
            )
          }
        }
      }
    }
    for (const target of extractRefTargets(opDef.config.returns)) {
      if (!isKnownDef(target)) {
        throw new SchemaValidationError(
          `'${path}' return type references an unknown def`,
          `${path}.returns`,
          'a def in this schema or registered in another schema',
          'unknown reference',
        )
      }
    }
  }

  for (const [name, def] of Object.entries(ctx.defs)) {
    const methods = def.config.methods as Record<string, OpDef> | undefined
    if (methods) {
      for (const [methodName, methodDef] of Object.entries(methods)) {
        validateOpRefs(`${name}.${methodName}`, methodDef)
      }
    }
  }
}
