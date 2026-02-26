import type { JsonSchema } from './json-schema.js'

/** An operation: a callable with params and returns. Used both as class methods and top-level operations. */
export interface OperationDecl {
  /** Operation name. */
  name: string

  /** Visibility. */
  access: 'public' | 'private'

  /** Parameters keyed by name. Each value is a JSON Schema for that parameter. */
  params: Record<string, JsonSchema>

  /** Return type as JSON Schema. May contain $nodeRef or $dataRef. */
  returns: JsonSchema

  /** Whether the return value can be null. Default: false (omitted). */
  returnsNullable?: boolean

  /** Whether this is a static (class-level) method with no `self`. Default: false (omitted). */
  static?: boolean
}
