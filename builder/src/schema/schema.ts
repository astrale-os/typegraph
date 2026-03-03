import type { OpDef } from '../defs/op.js'
import type { AnyDef } from '../defs/index.js'
import type { DefType } from '../defs/common.js'
import type { Domain } from '@astrale/typegraph-schema'

/** A def with its schema-assigned name as a literal type. */
export type Named<D, K extends string = string> = D & { readonly name: K }

type NamedDefs<D extends Record<string, AnyDef>> = {
  readonly [K in keyof D & string]: Named<D[K], K>
}

type OnlyType<D extends Record<string, AnyDef>, T extends DefType> = {
  [K in keyof D as D[K] extends { type: T } ? K : never]: D[K]
}

export interface Schema<D extends Record<string, AnyDef> = Record<string, any>> {
  readonly domain: Domain
  readonly defs: NamedDefs<D>
  readonly ifaces: OnlyType<NamedDefs<D>, 'iface'>
  readonly nodes: OnlyType<NamedDefs<D>, 'node'>
  readonly edges: OnlyType<NamedDefs<D>, 'edge'>
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
