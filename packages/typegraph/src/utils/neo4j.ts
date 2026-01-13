/**
 * Neo4j Type Conversion Utilities
 *
 * Shared utilities for converting Neo4j driver types to plain JavaScript types.
 * Used by all query builders to transform query results.
 */

/**
 * Neo4j Integer type (has toNumber method)
 */
interface Neo4jInteger {
  toNumber(): number
}

/**
 * Neo4j DateTime type (has toStandardDate method)
 */
interface Neo4jDateTime {
  toStandardDate(): Date
}

/**
 * Neo4j Node type
 */
interface Neo4jNode {
  properties: Record<string, unknown>
  labels?: string[]
  identity?: Neo4jInteger
}

/**
 * Check if a value is a Neo4j Integer.
 */
function isNeo4jInteger(value: unknown): value is Neo4jInteger {
  return (
    typeof value === "object" &&
    value !== null &&
    "toNumber" in value &&
    typeof (value as Neo4jInteger).toNumber === "function"
  )
}

/**
 * Check if a value is a Neo4j DateTime.
 */
function isNeo4jDateTime(value: unknown): value is Neo4jDateTime {
  return (
    typeof value === "object" &&
    value !== null &&
    "toStandardDate" in value &&
    typeof (value as Neo4jDateTime).toStandardDate === "function"
  )
}

/**
 * Check if a value is a Neo4j Node.
 */
function isNeo4jNode(value: unknown): value is Neo4jNode {
  return (
    typeof value === "object" &&
    value !== null &&
    "properties" in value &&
    typeof (value as Neo4jNode).properties === "object"
  )
}

/**
 * Convert a single Neo4j value to its JavaScript equivalent.
 *
 * Handles:
 * - Neo4j Integer → number
 * - Neo4j DateTime → Date
 * - Arrays (recursive conversion)
 * - Null/undefined passthrough
 */
export function convertNeo4jValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  // Handle Neo4j Integer
  if (isNeo4jInteger(value)) {
    return value.toNumber()
  }

  // Handle Neo4j Date/DateTime
  if (isNeo4jDateTime(value)) {
    return value.toStandardDate()
  }

  // Handle arrays recursively
  if (Array.isArray(value)) {
    return value.map((v) => convertNeo4jValue(v))
  }

  return value
}

/**
 * Convert a record of Neo4j values to plain JavaScript types.
 */
export function convertNeo4jProperties(props: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(props)) {
    result[key] = convertNeo4jValue(value)
  }

  return result
}

/**
 * Extract and convert properties from a Neo4j Node, Relationship, or plain object.
 *
 * @param data - Neo4j Node, Relationship, or plain object
 * @returns Plain JavaScript object with converted properties
 */
export function extractProperties(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") {
    return {}
  }

  // Neo4j Node or Relationship has a properties field
  if (isNeo4jNode(data)) {
    return convertNeo4jProperties(data.properties)
  }

  // Already a plain object
  return convertNeo4jProperties(data as Record<string, unknown>)
}

/**
 * Extract a value from a multi-alias result, handling arrays and nulls.
 * Used by transformMultiAliasResults for .returning() queries with collect().
 *
 * @param data - Value from a query result (can be node, array, or null)
 * @returns Extracted value preserving nulls and arrays
 */
export function extractValue(data: unknown): unknown {
  // Preserve null for optional traversals
  if (data === null) {
    return null
  }

  if (!data || typeof data !== "object") {
    return {}
  }

  // Handle arrays (e.g., from collect() in fork patterns)
  if (Array.isArray(data)) {
    return data.map((item) => extractValue(item))
  }

  // Neo4j Node or Relationship has a properties field
  if (isNeo4jNode(data)) {
    return convertNeo4jProperties(data.properties)
  }

  // Already a plain object
  return convertNeo4jProperties(data as Record<string, unknown>)
}

/**
 * Extract node properties from a query result record.
 *
 * @param record - A single record from query results
 * @returns Extracted and converted node properties
 */
export function extractNodeFromRecord(record: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(record)
  if (keys.length === 0) return {}

  const nodeData = record[keys[0]!]
  return extractProperties(nodeData)
}

/**
 * Transform a full Neo4j result set to plain JavaScript objects.
 *
 * @param results - Array of query result records
 * @returns Array of extracted and converted node properties
 */
export function transformResults<T = Record<string, unknown>>(
  results: Record<string, unknown>[],
): T[] {
  return results.map((record) => extractNodeFromRecord(record) as T)
}

/**
 * Transform a multi-alias result set (from .returning() queries).
 *
 * @param results - Array of query result records
 * @param aliases - Array of alias names to extract
 * @returns Array of objects with properties for each alias
 */
export function transformMultiAliasResults<T = Record<string, unknown>>(
  results: Record<string, unknown>[],
  aliases: string[],
): T[] {
  return results.map((record) => {
    const result: Record<string, unknown> = {}

    for (const alias of aliases) {
      const data = record[alias]
      result[alias] = extractValue(data)
    }

    return result as T
  })
}
