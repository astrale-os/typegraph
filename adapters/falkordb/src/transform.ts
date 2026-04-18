/**
 * Result transformation utilities for FalkorDB.
 *
 * FalkorDB only supports primitives and flat arrays of primitives as property
 * values. {@link serializeProperties} encodes complex values (objects, arrays
 * of objects) as sentinel-prefixed JSON strings before write, and
 * {@link convertValue} transparently reverses this on read.
 *
 * {@link encodeParamKeys} backtick-wraps map keys that contain characters
 * that the Cypher parser cannot accept as bare identifiers (e.g. `.`, `:`).
 * Applied once to the whole params object at the query boundary.
 */

import type { FalkorNode, FalkorRelationship } from './types'

// ─── Complex Property Serde ────────────────────────────────

const JSON_SENTINEL = '$$json::'

/**
 * Serialize complex property values for FalkorDB storage.
 *
 * FalkorDB cannot persist objects or arrays-of-objects as node/edge
 * properties. This encodes those values as sentinel-prefixed JSON strings
 * that {@link convertValue} reverses transparently on read.
 *
 * Flat arrays of primitives are left untouched (FalkorDB stores them natively).
 */
export function serializeProperties<T extends Record<string, unknown>>(props: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(props)) {
    out[k] = needsSerialization(v) ? `${JSON_SENTINEL}${JSON.stringify(v)}` : v
  }
  return out as T
}

// ─── Param Key Encoding ────────────────────────────────────

// Bare identifiers (letters, digits, underscore) don't need quoting; anything
// else — `.`, `:`, `-`, etc. — breaks Cypher's map-literal parser when
// emitted unquoted. The falkordb client does not backtick-quote map keys
// when serializing `CYPHER <params>` headers, so we encode here.
const BARE_IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Returns true when `k` must be backtick-quoted in a Cypher map literal. */
function needsBacktickQuoting(k: string): boolean {
  return !BARE_IDENT_RE.test(k)
}

/** Escape embedded backticks per Cypher grammar (double them). */
function backtickQuote(k: string): string {
  return `\`${k.replace(/`/g, '``')}\``
}

/**
 * Recursively walk a params value and rewrite object keys that aren't bare
 * identifiers into their backtick-quoted form. Primitives pass through.
 * Arrays are walked; objects are rebuilt with quoted keys where needed.
 *
 * Applied at the mutate/query boundary so every map literal that ends up in
 * the `CYPHER <params>` header is syntactically valid, regardless of which
 * property keys the caller supplies.
 *
 * Quoting only affects the wire syntax of the param literal; FalkorDB
 * stores the identifier unchanged (backticks are lexical quoting, not part
 * of the identifier).
 */
export function encodeParamKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(encodeParamKeys)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    const key = needsBacktickQuoting(k) ? backtickQuote(k) : k
    out[key] = encodeParamKeys(v)
  }
  return out
}

function needsSerialization(v: unknown): boolean {
  if (v === null || v === undefined || typeof v !== 'object') return false
  if (Array.isArray(v)) return v.some((el) => el !== null && typeof el === 'object')
  return true
}

function deserializeIfPrefixed(v: unknown): unknown {
  if (typeof v !== 'string' || !v.startsWith(JSON_SENTINEL)) return v
  return JSON.parse(v.slice(JSON_SENTINEL.length))
}

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
  return v !== null && typeof v === 'object' && 'relationshipType' in v && 'properties' in v
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
  if (typeof value !== 'object') return deserializeIfPrefixed(value)

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
  seen.set(value, result) // Register BEFORE recursion to handle circular references
  for (const [k, v] of Object.entries(value)) {
    result[k] = convertValue(v, seen)
  }
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
