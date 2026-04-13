import type {
  AnyDef,
  AnyInterfaceDef,
  AnyClassDef,
} from '../../grammar/definition/discriminants.js'
import type { DefIdentity } from '../refs.js'
import type { Schema } from '../schema.js'

/** Validation context passed to each validator */
export interface SchemaContext {
  readonly domain: string
  readonly interfaces: Record<string, AnyInterfaceDef>
  readonly classes: Record<string, AnyClassDef>
  readonly imports: readonly Schema[]
  /** Identity map for all defs in this schema */
  readonly identityMap: Map<AnyDef, DefIdentity>
}
