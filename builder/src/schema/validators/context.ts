import type { AnyDef } from '../../defs/index.js'

export interface SchemaContext {
  readonly domain: string
  readonly defs: Record<string, AnyDef>
  readonly allDefValues: Set<object>
}
