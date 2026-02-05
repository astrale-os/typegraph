/**
 * Date Utilities
 *
 * Shared date schema detection and deserialization.
 * Used by both mutation and query paths to ensure Date round-trip fidelity
 * across all adapters (Neo4j, FalkorDB, Memgraph, etc.).
 */

import type { AnySchema } from '@astrale/typegraph-core'

/**
 * Check if a Zod schema represents a Date type.
 * Handles optional and default wrappers.
 * Supports both Zod v3 (typeName) and Zod v4 (type) structures.
 */
export function isDateSchema(schema: unknown): boolean {
  const s = schema as {
    _def?: { typeName?: string; type?: string; innerType?: unknown }
    type?: string
    def?: { type?: string }
  }

  // Zod v3 style
  const typeName = s._def?.typeName
  if (typeName === 'ZodDate') return true
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault') {
    return isDateSchema(s._def?.innerType)
  }

  // Zod v4 style
  const type = s._def?.type ?? s.type ?? s.def?.type
  if (type === 'date') return true
  if (type === 'optional' || type === 'default') {
    const inner = s._def?.innerType
    if (inner) return isDateSchema(inner)
  }

  return false
}

/**
 * Deserialize ISO string date fields back to Date objects using schema introspection.
 * Idempotent: only converts strings, leaves existing Date objects untouched.
 */
export function deserializeDateFields(
  schema: AnySchema,
  label: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const nodeDef = schema.nodes[label]
  if (!nodeDef) return data

  const result = { ...data }
  const shape = nodeDef.properties.shape

  for (const [key, fieldSchema] of Object.entries(shape)) {
    if (result[key] && typeof result[key] === 'string' && isDateSchema(fieldSchema)) {
      result[key] = new Date(result[key] as string)
    }
  }

  return result
}
