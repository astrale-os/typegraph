/**
 * Label Utilities
 *
 * Utilities for resolving and formatting node labels.
 * Supports transitive label inheritance via node.labels property.
 */

import type { AnySchema } from './types'

/**
 * Memoization cache for resolveNodeLabels.
 * WeakMap allows garbage collection when schema is no longer referenced.
 */
const labelCache = new WeakMap<AnySchema, Map<string, readonly string[]>>()

/**
 * Memoization cache for getNodesSatisfying.
 */
const satisfiesCache = new WeakMap<AnySchema, Map<string, readonly string[]>>()

/**
 * Resolve the full set of labels for a node type, including transitive inheritance.
 *
 * Labels are resolved in order:
 * 1. The node's own label (PascalCase)
 * 2. Labels from referenced node types transitively (depth-first)
 *
 * Results are memoized per schema. Returns a fresh copy to prevent mutation bugs.
 *
 * @param schema - The schema definition
 * @param nodeLabel - The node type label (e.g., 'user')
 * @returns Array of labels to apply to the node
 *
 * @example
 * ```typescript
 * // Simple node
 * resolveNodeLabels(schema, 'user')  // ['User']
 *
 * // With transitive labels: admin -> user -> entity
 * resolveNodeLabels(schema, 'admin') // ['Admin', 'User', 'Entity']
 * ```
 */
export function resolveNodeLabels<S extends AnySchema>(schema: S, nodeLabel: string): string[] {
  // Check cache
  let schemaCache = labelCache.get(schema)
  if (!schemaCache) {
    schemaCache = new Map()
    labelCache.set(schema, schemaCache)
  }
  const cached = schemaCache.get(nodeLabel)
  if (cached) return [...cached] // Return copy to prevent mutation

  const result: string[] = []
  const seen = new Set<string>() // Dedup + cycle protection

  function collect(label: string): void {
    if (seen.has(label)) return
    seen.add(label)
    result.push(toPascalCase(label))

    const nodeDef = schema.nodes[label]
    for (const ref of nodeDef?.labels ?? []) {
      collect(ref)
    }
  }

  // Collect node label and all transitive labels (depth-first)
  collect(nodeLabel)

  // Cache and return copy
  schemaCache.set(nodeLabel, result)
  return [...result]
}

/**
 * Format an array of labels into a Cypher label string.
 *
 * @param labels - Array of label strings
 * @returns Cypher label format (e.g., ':User:Entity')
 *
 * @example
 * ```typescript
 * formatLabels(['User'])                  // ':User'
 * formatLabels(['User', 'Entity'])        // ':User:Entity'
 * formatLabels(['Admin', 'User', 'Entity']) // ':Admin:User:Entity'
 * formatLabels([])                        // ''
 * ```
 */
export function formatLabels(labels: string[]): string {
  if (labels.length === 0) return ''
  return labels.map((l) => `:${l}`).join('')
}

/**
 * Get all node types that transitively satisfy a given edge endpoint requirement.
 *
 * A node satisfies an endpoint if:
 * 1. It matches the endpoint directly (same label), OR
 * 2. Any node in its transitive labels chain includes the endpoint
 *
 * This enables multi-label nodes (e.g., 'admin' with labels ['user'])
 * to be used as targets for edges that expect 'user'.
 *
 * Results are memoized per schema. Returns a fresh copy to prevent mutation bugs.
 *
 * @param schema - The schema definition
 * @param targetLabel - The node type label expected by an edge endpoint
 * @returns Array of node types that can satisfy this endpoint
 *
 * @example
 * ```typescript
 * // Given: admin -> user -> entity
 * getNodesSatisfying(schema, 'entity') // ['entity', 'user', 'admin']
 * ```
 */
export function getNodesSatisfying<S extends AnySchema>(schema: S, targetLabel: string): string[] {
  // Check cache
  let schemaCache = satisfiesCache.get(schema)
  if (!schemaCache) {
    schemaCache = new Map()
    satisfiesCache.set(schema, schemaCache)
  }
  const cached = schemaCache.get(targetLabel)
  if (cached) return [...cached] // Return copy to prevent mutation

  // Find all nodes that transitively satisfy target
  const result: string[] = [targetLabel]
  const targetPascal = toPascalCase(targetLabel)

  for (const nodeKey of Object.keys(schema.nodes)) {
    if (nodeKey === targetLabel) continue

    // Check if this node's resolved labels include the target
    const labels = resolveNodeLabels(schema, nodeKey)
    if (labels.includes(targetPascal)) {
      result.push(nodeKey)
    }
  }

  // Cache and return copy
  schemaCache.set(targetLabel, result)
  return [...result]
}

/**
 * Convert a string to PascalCase.
 * Used to standardize node labels in Cypher.
 *
 * @param str - Input string (e.g., 'user', 'userProfile', 'user_profile')
 * @returns PascalCase string (e.g., 'User', 'UserProfile', 'UserProfile')
 */
export function toPascalCase(str: string): string {
  // Handle snake_case
  if (str.includes('_')) {
    return str
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('')
  }

  // Handle camelCase or simple lowercase
  return str.charAt(0).toUpperCase() + str.slice(1)
}
