/**
 * Transform Neo4j types to plain JavaScript values.
 */

type Neo4jInteger = { low: number; high: number; toNumber: () => number }
type Neo4jTemporal = { toString: () => string }
type Neo4jNode = { labels: string[]; properties: Record<string, unknown>; identity: unknown }
type Neo4jRelationship = {
  type: string
  properties: Record<string, unknown>
  start: unknown
  end: unknown
}

/**
 * Transform a record's values from Neo4j types to JS types.
 */
export function transformRecord(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    result[key] = transformValue(value)
  }
  return result
}

/**
 * Transform a single value from Neo4j type to JS type.
 */
export function transformValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value
  }

  // Check primitives first
  if (typeof value !== 'object') {
    return value
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(transformValue)
  }

  // Now value is definitely a non-null object
  const obj = value as Record<string, unknown>

  if (isNeo4jInteger(obj)) {
    return (obj as unknown as Neo4jInteger).toNumber()
  }

  if (isNeo4jTemporal(obj)) {
    return (obj as unknown as Neo4jTemporal).toString()
  }

  if (isNeo4jNode(obj)) {
    const node = obj as unknown as Neo4jNode
    return {
      ...transformRecord(node.properties),
      _labels: node.labels,
    }
  }

  if (isNeo4jRelationship(obj)) {
    const rel = obj as unknown as Neo4jRelationship
    return {
      ...transformRecord(rel.properties),
      _type: rel.type,
    }
  }

  // Plain object
  return transformRecord(obj)
}

// Type guards using Neo4j driver's actual object shapes

function isNeo4jInteger(value: unknown): value is Neo4jInteger {
  return (
    typeof value === 'object' &&
    value !== null &&
    'low' in value &&
    'high' in value &&
    typeof (value as Neo4jInteger).toNumber === 'function'
  )
}

function isNeo4jTemporal(value: unknown): value is Neo4jTemporal {
  if (typeof value !== 'object' || value === null) return false
  // Neo4j temporal types have specific fields like year/month/day or hour/minute/second
  // and a toString method for serialization
  const hasTemporalFields =
    'year' in value || 'month' in value || 'day' in value || 'hour' in value || 'minute' in value
  const hasToString = typeof (value as Neo4jTemporal).toString === 'function'
  // Exclude plain objects that happen to have toString (all objects do)
  // by checking for temporal-specific fields
  return hasTemporalFields && hasToString && !('low' in value)
}

function isNeo4jNode(value: unknown): value is Neo4jNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'labels' in value &&
    'properties' in value &&
    'identity' in value &&
    Array.isArray((value as Neo4jNode).labels)
  )
}

function isNeo4jRelationship(value: unknown): value is Neo4jRelationship {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'properties' in value &&
    'start' in value &&
    'end' in value &&
    typeof (value as Neo4jRelationship).type === 'string'
  )
}
