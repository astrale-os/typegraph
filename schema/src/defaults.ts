import type { JsonValue } from './json-schema.js'

/** A computed default value (fn call). Stored in SchemaIR.defaults, NOT inline on properties. */
export interface ComputedDefault {
  /** Function name (e.g., 'now', 'seq', 'uuid'). */
  fn: string
  /** Optional arguments to the function. */
  args?: JsonValue[]
}
