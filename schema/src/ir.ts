import type { ClassDecl, InterfaceDecl, AnyDecl } from './classes.js'
import type { DomainOrigin } from './domain.js'
import type { JsonSchema } from './json-schema.js'

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
 *   "interfaces": { "Trackable": { "type": "interface", ... } },
 *   "classes": { "TodoItem": { "type": "node", ... } }
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
  domain: DomainOrigin

  /**
   * Cross-domain dependency manifest.
   * Maps each referenced external name to its source domain and whether
   * it is an interface or a class. The `definition` tag is required: the
   * graph form of a domain is the round-trip source of truth, and without
   * it a re-serialization cannot distinguish `class implements interface`
   * from `class extends class` for imported parents.
   *
   * Absent when the schema is self-contained.
   *
   * @example
   * {
   *   "Node": { "origin": "astrale.core", "definition": "class" },
   *   "Identity": { "origin": "astrale.core", "definition": "interface" }
   * }
   */
  imports?: Record<string, { origin: DomainOrigin; definition: 'interface' | 'class' }>

  /**
   * Shared type definitions (JSON Schema).
   * Referenced from properties/params via `$ref: '#/types/<name>'`.
   *
   * @example { "Priority": { "enum": ["low", "medium", "high"] } }
   */
  types: Record<string, JsonSchema>

  /** Interface declarations (abstract types). */
  interfaces: Record<string, InterfaceDecl>

  /** Concrete class declarations (nodes + edges). */
  classes: Record<string, ClassDecl>
}

/** Merge interfaces + classes for lookups that need all declarations. */
export function allDeclarations(schema: SchemaIR): Record<string, AnyDecl> {
  return { ...schema.interfaces, ...schema.classes }
}
