import type { DomainUrl } from './domain.js'
import type { ClassDecl } from './classes.js'
import type { JsonSchema } from './json-schema.js'
import type { OperationDecl } from './operations.js'

/**
 * TypeGraph Schema IR.
 *
 * Universal, JSON-serializable intermediate representation for graph schemas.
 * Produced by `@astrale/builder`, consumed by client SDK and kernel.
 *
 * @example
 * ```json
 * {
 *   "version": "1.0",
 *   "domain": "acme.todo",
 *   "imports": { "Identity": "astrale.core" },
 *   "classes": { "TodoItem": { "type": "node", ... } },
 *   "operations": {}
 * }
 * ```
 */
export interface SchemaIR {
  /** IR format version. */
  version: '1.0'

  /**
   * Authoritative domain this schema belongs to (FQDN).
   * @example 'astrale.core', 'acme.billing'
   */
  domain: DomainUrl

  /**
   * Cross-domain dependency manifest.
   * Maps each referenced external name to its source domain.
   * Absent when the schema is self-contained.
   *
   * @example { "Node": "astrale.core", "Identity": "astrale.core" }
   */
  imports?: Record<string, DomainUrl>

  /**
   * Shared type definitions (JSON Schema).
   * Referenced from properties/params via `$ref: '#/types/<name>'`.
   *
   * @example { "Priority": { "enum": ["low", "medium", "high"] } }
   */
  types: Record<string, JsonSchema>

  /**
   * Graph class declarations: nodes and edges.
   * Discriminated on `type: 'node' | 'edge'`. Interfaces are nodes with `abstract: true`.
   */
  classes: Record<string, ClassDecl>

  /** Top-level operations not bound to any class. */
  operations: Record<string, OperationDecl>
}
