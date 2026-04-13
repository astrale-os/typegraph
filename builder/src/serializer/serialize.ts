import type { SchemaIR } from '@astrale/typegraph-schema'
import type { z } from 'zod'

import type { Schema } from '../schema/schema.js'

import { SerializeContext } from './context.js'

export interface SerializeOptions {
  /**
   * Named types to hoist into the IR `types` record.
   * Pass Zod schemas that should be shared across multiple properties/params.
   */
  types?: Record<string, z.ZodType>
}

export function serialize(schema: Schema, options?: SerializeOptions): SchemaIR {
  const ctx = new SerializeContext(schema, options)
  return ctx.run()
}
