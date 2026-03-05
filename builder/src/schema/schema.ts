import type { OpDef } from '../defs/operation.js'
import type { AnyDef } from '../defs/index.js'
import type { Domain } from '@astrale/typegraph-schema'

/** A def with its schema-assigned name as a literal type. */
export type Named<D, K extends string = string> = D & { readonly name: K }

type Definitions<D extends Record<string, AnyDef>> = {
  readonly [K in keyof D & string]: Named<D[K], K>
}

export interface Schema<D extends Record<string, AnyDef> = Record<string, any>> {
  readonly domain: Domain
  readonly defs: Definitions<D>
  readonly ops: Record<string, OpDef>
}

export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly field: string,
    public readonly expected?: string,
    public readonly received?: string,
  ) {
    super(message)
    this.name = 'SchemaValidationError'
  }
}
