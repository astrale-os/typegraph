import type { ClassDecl } from './classes.js'
import type { JsonSchema } from './json-schema.js'
import type { ComputedDefault } from './defaults.js'
import type { OperationDecl } from './operations.js'

/**
 * TypeGraph Schema IR.
 
 * Universal, JSON-serializable intermediate representation for graph schemas.
 * Produced by `@astrale/builder`, consumed by client SDK and kernel.
 */
export interface SchemaIR {
  /** IR format version. */
  version: '1.0'

  /**
   * Shared type definitions as JSON Schemas.
   * Keyed by type name. Referenced via `$ref: '#/types/<name>'`.
   */
  types: Record<string, JsonSchema>

  /**
   * Graph class declarations: nodes and edges.
   * Keyed by class name. Discriminated on `type: 'node' | 'edge'`.
   * Interfaces are nodes with `abstract: true`.
   */
  classes: Record<string, ClassDecl>

  /**
   * Top-level operations not bound to any class.
   * Keyed by operation name. Same shape as class methods, but declared at schema root.
   */
  operations: Record<string, OperationDecl>

  /**
   * Computed defaults (fn calls) separated from properties.
   * Key format: "ClassName.propName" or "ClassName.methodName.paramName".
   * Absent if no computed defaults exist.
   */
  defaults?: Record<string, ComputedDefault>
}
