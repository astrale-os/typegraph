import type {
  AnyDef,
  AnyInterfaceDef,
  AnyClassDef,
} from '../../grammar/definition/discriminants.js'
import type { DefDescriptor } from '../refs.js'
import type { Schema } from '../schema.js'

/** Validation context passed to each validator */
export interface SchemaContext {
  readonly domain: string
  readonly interfaces: Record<string, AnyInterfaceDef>
  readonly classes: Record<string, AnyClassDef>
  readonly imports: readonly Schema[]
  /** Descriptor map for all defs in this schema */
  readonly descriptorMap: Map<AnyDef, DefDescriptor>
}
