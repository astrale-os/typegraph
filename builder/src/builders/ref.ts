// oxlint-disable typescript/no-explicit-any
import { z } from 'zod'

import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { REF_TAG } from '../grammar/values/ref.js'
import type { SELF_TAG } from '../grammar/values/self.js'

import { type RefSchema } from '../grammar/values/ref.js'
import { type SelfDef } from '../grammar/values/self.js'

// Runtime symbol matching the declared unique symbol
const REF_TAG_RUNTIME = Symbol.for('REF_TAG') as typeof REF_TAG

/** Check if a value is a SELF token */
function isSelf(value: unknown): value is SelfDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Symbol.for('SELF_TAG') as typeof SELF_TAG) in value
  )
}

/** Create a ref schema for SELF */
export function ref(target: SelfDef): RefSchema<SelfDef, false>
/** Create a ref schema for a definition */
export function ref<D extends AnyDef>(target: D): RefSchema<D, false>
/** Create a ref schema for a definition, including its data */
export function ref<D extends AnyDef>(target: D, opts: { data: true }): RefSchema<D, true>
export function ref(target: AnyDef | SelfDef, opts?: { data?: boolean }): any {
  const schema = z
    .union([z.string(), z.object({ id: z.string() }).passthrough()])
    .transform((value) => (typeof value === 'string' ? { id: value } : value))

  ;(schema as any)[REF_TAG_RUNTIME] = {
    target,
    includeData: opts?.data ?? false,
  }

  if (isSelf(target)) {
    ;(schema as any).__self = true
  }

  return schema
}
