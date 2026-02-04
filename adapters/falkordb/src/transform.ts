/**
 * Result transformation utilities for FalkorDB.
 */

import type { FalkorNode, FalkorRelationship } from './types'

/**
 * Type guard for FalkorDB nodes.
 * Nodes have id, labels array, and properties object.
 */
export function isFalkorNode(v: unknown): v is FalkorNode {
  return (
    v !== null &&
    typeof v === 'object' &&
    'labels' in v &&
    'properties' in v &&
    Array.isArray((v as FalkorNode).labels)
  )
}

/**
 * Type guard for FalkorDB relationships.
 * Relationships have id, relationshipType, and properties.
 */
export function isFalkorRelationship(v: unknown): v is FalkorRelationship {
  return (
    v !== null &&
    typeof v === 'object' &&
    'relationshipType' in v &&
    'properties' in v
  )
}

/**
 * Recursively convert FalkorDB native types to plain JavaScript objects.
 * Unwraps node/edge properties and preserves custom IDs.
 *
 * Performance: Uses WeakMap for cycle detection to handle circular references.
 */
export function convertValue(value: unknown, seen = new WeakMap()): unknown {
  // Primitives
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value

  // Prevent infinite recursion on circular references
  if (seen.has(value as object)) return seen.get(value as object)

  // FalkorDB nodes: unwrap properties, preserve ID
  if (isFalkorNode(value)) {
    const result = { id: value.properties.id ?? value.id, ...value.properties }
    seen.set(value, result)
    return result
  }

  // FalkorDB relationships: unwrap properties, preserve ID
  if (isFalkorRelationship(value)) {
    const result = { id: value.properties.id ?? value.id, ...value.properties }
    seen.set(value, result)
    return result
  }

  // Arrays: recursively convert elements
  if (Array.isArray(value)) {
    const result = value.map((v) => convertValue(v, seen))
    seen.set(value, result)
    return result
  }

  // Objects: recursively convert values
  const result: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    result[k] = convertValue(v, seen)
  }
  seen.set(value, result)
  return result
}

/**
 * Transform FalkorDB query results to plain objects.
 * Handles both array and object result formats.
 */
export function transformResults(data: unknown[] | undefined): Record<string, unknown>[] {
  if (!data?.length) return []
  return data.map((row) => {
    if (typeof row !== 'object' || row === null) return row as Record<string, unknown>
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      result[k] = convertValue(v)
    }
    return result
  })
}
