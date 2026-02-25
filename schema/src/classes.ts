import type { JsonSchema } from './json-schema.js'
import type { OperationDecl } from './operations.js'
import type { Endpoint, EdgeConstraints } from './endpoints.js'

/** A graph class declaration: either a node or an edge. */
export type ClassDecl = NodeDecl | EdgeDecl

/**
 * A node declaration. Interfaces are nodes with `abstract: true`.
 * Own properties and methods only — consumer resolves inheritance via `implements`.
 */
export interface NodeDecl {
  type: 'node'

  /** Unique name within the schema. */
  name: string

  /** If true, this is an interface (cannot be instantiated directly). */
  abstract: boolean

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

  /** Exactly two endpoints defining the relationship. */
  endpoints: [Endpoint, Endpoint]

  /** Own properties as a map: key = property name, value = JSON Schema. */
  properties: Record<string, JsonSchema>

  /** Own methods on the edge, keyed by name. */
  methods: Record<string, OperationDecl>

  /** Structural constraints. */
  constraints?: EdgeConstraints
}
