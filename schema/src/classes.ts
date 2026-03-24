import type { Endpoint, EdgeConstraints } from './endpoints.js'
import type { JsonSchema } from './json-schema.js'
import type { OperationDecl } from './operations.js'

/** An interface declaration. Cannot be instantiated directly. */
export interface InterfaceDecl {
  type: 'interface'

  /** Unique name within the schema. */
  name: string

  /** Parent interfaces this interface extends. */
  extends: string[]

  /** Own properties as a map: key = property name, value = JSON Schema. */
  properties: Record<string, JsonSchema>

  /** Own methods keyed by name (NOT inherited). */
  methods: Record<string, OperationDecl>

  /**
   * Optional datastore content schema (JSON Schema of type object).
   * Separate from graph properties — opaque content storage.
   */
  data?: JsonSchema
}

/** Concrete class declarations: nodes + edges. */
export type ClassDecl = NodeDecl | EdgeDecl

/** Every declaration kind. */
export type AnyDecl = InterfaceDecl | NodeDecl | EdgeDecl

/**
 * A concrete node declaration.
 * Own properties and methods only — consumer resolves inheritance via `implements`.
 */
export interface NodeDecl {
  type: 'node'

  /** Unique name within the schema. */
  name: string

  /**
   * Parent type names (interfaces or concrete nodes).
   * Consumer resolves by looking up the referenced class.
   */
  implements: string[]

  /** Own properties as a map: key = property name, value = JSON Schema. */
  properties: Record<string, JsonSchema>

  /** Own methods keyed by name (NOT inherited). */
  methods: Record<string, OperationDecl>

  /**
   * Optional datastore content schema (JSON Schema of type object).
   * Separate from graph properties — opaque content storage.
   */
  data?: JsonSchema
}

/**
 * An edge declaration representing a relationship between nodes.
 * Always has exactly two endpoints.
 */
export interface EdgeDecl {
  type: 'edge'

  /** Unique name within the schema. */
  name: string

  /** Parent type names (interfaces). Consumer resolves by lookup. */
  implements: string[]

  /** Exactly two endpoints defining the relationship. */
  endpoints: [Endpoint, Endpoint]

  /** Own properties as a map: key = property name, value = JSON Schema. */
  properties: Record<string, JsonSchema>

  /** Own methods on the edge, keyed by name. */
  methods: Record<string, OperationDecl>

  /** Structural constraints. */
  constraints?: EdgeConstraints
}
