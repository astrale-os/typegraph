import { z } from 'zod'
import type { Schema } from '../schema/schema.js'
import type { SchemaIR } from '@astrale/typegraph-schema'
import { SerializeContext } from './context.js'

export interface SerializeOptions {
  /**
   * Named types to hoist into the IR `types` record.
   * Pass Zod schemas that should be shared across multiple properties/params.
   * These are converted to JSON Schema and referenced via `$ref: '#/types/<name>'`.
   */
  types?: Record<string, z.ZodType>
}

export function serialize(schema: Schema, options?: SerializeOptions): SchemaIR {
  const ctx = new SerializeContext(schema, options)
  return ctx.run()
}
