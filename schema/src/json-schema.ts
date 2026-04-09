/**
 * Standard JSON Schema object.
 * Any valid JSON Schema is accepted. Custom extensions:
 * - `$nodeRef: string` — references a graph node class
 * - `$dataRef: string` — references datastore content ("self" or a node name)
 */
export type JsonSchema = Record<string, unknown>

/**
 * Property declaration in the IR.
 * A JSON Schema extended with graph-specific metadata.
 * When `private` is absent or false, the property is public.
 */
export type PropertyDecl = JsonSchema & { private?: true }

/** JSON-serializable value type. Used for computed default arguments. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }
