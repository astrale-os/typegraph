import type { AnyDef } from '../../grammar/definition/discriminants.js'
import type { FnDef } from '../../grammar/function/def.js'
import type { REF_TAG } from '../../grammar/values/ref.js'
import type { SchemaContext } from './context.js'

import { SchemaValidationError } from '../error.js'
import { isKnownDef } from '../refs.js'

// Runtime symbol
const REF_TAG_RUNTIME = Symbol.for('REF_TAG') as typeof REF_TAG

/** Extract all ref targets from a Zod schema tree */
function extractRefTargets(schema: unknown): object[] {
  if (schema === null || typeof schema !== 'object') return []
  const targets: object[] = []

  const record = schema as Record<string | symbol, unknown>

  // Check for our REF_TAG brand
  if (REF_TAG_RUNTIME in record) {
    const meta = record[REF_TAG_RUNTIME] as { target: unknown }
    if (meta.target && typeof meta.target === 'object') {
      targets.push(meta.target as object)
    }
  }

  // Walk into Zod internals to find nested refs
  const zod = record as { element?: unknown; innerType?: unknown; _def?: Record<string, unknown> }
  const inner = zod.element ?? zod.innerType ?? zod._def?.innerType ?? zod._def?.type
  if (inner && typeof inner === 'object') {
    targets.push(...extractRefTargets(inner))
  }

  return targets
}

/** Validate that all ref() targets in params/returns point to known definitions */
export function validateRefTargets(ctx: SchemaContext): void {
  const allDefs: Record<string, AnyDef> = { ...ctx.interfaces, ...ctx.classes }

  const validateFnRefs = (path: string, fnDef: FnDef) => {
    const params = fnDef.config.params
    if (params && typeof params === 'object' && typeof params !== 'function') {
      for (const [paramName, paramSchema] of Object.entries(params as Record<string, unknown>)) {
        for (const target of extractRefTargets(paramSchema)) {
          if (!isKnownDef(target, ctx.descriptorMap)) {
            throw new SchemaValidationError(
              `'${path}' param '${paramName}' references an unknown def`,
              `${path}.params.${paramName}`,
              'a def in this schema or imported',
              'unknown reference',
            )
          }
        }
      }
    }
    for (const target of extractRefTargets(fnDef.config.returns)) {
      if (!isKnownDef(target, ctx.descriptorMap)) {
        throw new SchemaValidationError(
          `'${path}' return type references an unknown def`,
          `${path}.returns`,
          'a def in this schema or imported',
          'unknown reference',
        )
      }
    }
  }

  for (const [name, def] of Object.entries(allDefs)) {
    const methods = def.config.methods as Record<string, FnDef> | undefined
    if (!methods) continue
    for (const [methodName, methodDef] of Object.entries(methods)) {
      validateFnRefs(`${name}.${methodName}`, methodDef)
    }
  }
}
