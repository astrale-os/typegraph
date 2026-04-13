// oxlint-disable typescript/no-explicit-any
import { z } from 'zod'

import type { BITMASK_TAG } from '../grammar/values/bitmask.js'

import { type BitmaskDef } from '../grammar/values/bitmask.js'

// Runtime symbol matching the declared unique symbol
const BITMASK_TAG_RUNTIME = Symbol.for('BITMASK_TAG') as typeof BITMASK_TAG

/** Create a bitmask value type — permissions bitfield (resolves to integer) */
export function bitmask(): z.ZodNumber & BitmaskDef {
  const schema = z.number().int().nonnegative()

  ;(schema as any)[BITMASK_TAG_RUNTIME] = true

  return schema as z.ZodNumber & BitmaskDef
}
