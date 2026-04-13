// oxlint-disable typescript/no-explicit-any
import { z } from 'zod'

import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { DATA_TAG } from '../grammar/values/data.js'

import { type DataGrantSchema, type DataSelfSchema } from '../grammar/values/data.js'

// Runtime symbol matching the declared unique symbol
const DATA_TAG_RUNTIME = Symbol.for('DATA_TAG') as typeof DATA_TAG

/** Create a data-self marker (owning node's datastore content) */
export function data(): DataSelfSchema
/** Create a data-grant marker (another node's datastore content) */
export function data<D extends AnyDef>(target: D): DataGrantSchema<D>
export function data(target?: AnyDef): DataSelfSchema | DataGrantSchema {
  const schema = z.unknown()

  if (target === undefined) {
    ;(schema as any)[DATA_TAG_RUNTIME] = { kind: 'self' as const }
  } else {
    ;(schema as any)[DATA_TAG_RUNTIME] = { kind: 'grant' as const, target }
  }

  return schema as any
}
