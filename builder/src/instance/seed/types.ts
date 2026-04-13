// oxlint-disable typescript/no-explicit-any
import type { Schema } from '../../schema/schema.js'
import type { CorePath } from '../core/path.js'
import type { Core, CoreNodeEntry, CoreEdgeEntry } from '../core/types.js'

/** The output of defineSeed() — seed data extending a core */
export interface SeedDef<
  S extends Schema = Schema,
  C extends Core = Core,
  _Paths extends Record<string, any> = Record<string, CorePath>,
> {
  readonly schema: S
  readonly core: C
  readonly domain: string
  readonly __nodes: readonly CoreNodeEntry[]
  readonly __edges: readonly CoreEdgeEntry[]
}
