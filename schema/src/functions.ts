import type { JsonSchema } from './json-schema.js'

/** A function declaration: a callable with params and returns. Used as class methods. */
export interface FunctionDecl {
  /** Function name. */
  name: string

  /** Parameters keyed by name. Each value is a JSON Schema for that parameter. */
  params: Record<string, JsonSchema>

  /** Return type as JSON Schema. May contain $nodeRef or $dataRef. */
  returns: JsonSchema

  /** Whether the return value can be null. Default: false (omitted). */
  returnsNullable?: boolean

  /** Whether this is a static (class-level) method with no `self`. */
  static: boolean

  /** Method inheritance. `'sealed'` = non-overridable, `'abstract'` = no impl, `'default'` = impl provided, overridable. */
  inheritance: 'sealed' | 'abstract' | 'default'
}
