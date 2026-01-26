/**
 * Label Utilities
 *
 * Utilities for resolving and formatting node labels.
 * Enables universal :Node label for O(1) lookups via index.
 */

import type { AnySchema, NodeDefinition } from './types'

/**
 * Default base labels applied to ALL nodes.
 * Enables universal lookups: MATCH (n:Node {id: $id})
 */
export const DEFAULT_BASE_LABELS = ['Node'] as const

/**
 * Resolve the full set of labels for a node type.
 *
 * Labels are resolved in order:
 * 1. Base labels (default: ['Node']) - unless includeBaseLabels is false
 * 2. The node's own label (PascalCase)
 * 3. Labels from referenced node types in `labels` array (PascalCase)
 *
 * @param schema - The schema definition
 * @param nodeLabel - The node type label (e.g., 'user')
 * @returns Array of labels to apply to the node
 *
 * @example
 * ```typescript
 * // Default schema
 * resolveNodeLabels(schema, 'user')  // ['Node', 'User']
 *
 * // With labels referencing other node types
 * resolveNodeLabels(schema, 'agent') // ['Node', 'Agent', 'Module', 'Identity']
 *
 * // With custom base labels
 * resolveNodeLabels(schemaWithCustomLabels, 'user') // ['Entity', 'Auditable', 'User']
 * ```
 */
export function resolveNodeLabels<S extends AnySchema>(schema: S, nodeLabel: string): string[] {
  const config = schema.labels ?? {}
  const nodeDef = schema.nodes[nodeLabel]
  const labels: string[] = []

  // Add base labels (default: ['Node'])
  if (config.includeBaseLabels !== false) {
    labels.push(...(config.baseLabels ?? DEFAULT_BASE_LABELS))
  }

  // Add the node's own label (PascalCase)
  labels.push(toPascalCase(nodeLabel))

  // Add labels from referenced node types (IS-A relationships)
  if (nodeDef?.labels) {
    for (const ref of nodeDef.labels) {
      labels.push(toPascalCase(ref))
    }
  }

  return labels
}

/**
 * Format an array of labels into a Cypher label string.
 *
 * @param labels - Array of label strings
 * @returns Cypher label format (e.g., ':Node:User:Privileged')
 *
 * @example
 * ```typescript
 * formatLabels(['Node', 'User'])           // ':Node:User'
 * formatLabels(['Entity', 'User', 'Admin']) // ':Entity:User:Admin'
 * formatLabels([])                          // ''
 * ```
 */
export function formatLabels(labels: string[]): string {
  if (labels.length === 0) return ''
  return labels.map((l) => `:${l}`).join('')
}

/**
 * Get all node types that satisfy a given edge endpoint requirement.
 *
 * A node satisfies an endpoint if:
 * 1. It matches the endpoint directly (same label), OR
 * 2. It has the endpoint in its `labels` array
 *
 * This enables multi-label nodes (e.g., 'agent') to be used as targets
 * for edges that expect 'module' or 'identity'.
 *
 * @param schema - The schema definition
 * @param targetLabel - The node type label expected by an edge endpoint
 * @returns Array of node types that can satisfy this endpoint
 */
export function getNodesSatisfying<S extends AnySchema>(schema: S, targetLabel: string): string[] {
  const satisfyingNodes: string[] = [targetLabel] // Always includes self

  for (const [nodeKey, nodeDef] of Object.entries(schema.nodes) as [string, NodeDefinition][]) {
    // Skip if it's the target itself (already added)
    if (nodeKey === targetLabel) continue

    // Check if this node's labels include the target (IS-A relationship)
    if (nodeDef?.labels?.includes(targetLabel)) {
      satisfyingNodes.push(nodeKey)
    }
  }

  return satisfyingNodes
}

/**
 * Get the base label for ID lookups (e.g., ':Node').
 *
 * Returns the formatted base label string if base labels are enabled,
 * otherwise returns an empty string.
 *
 * This is used by the query compiler to optimize ID lookups:
 * - With base labels: `MATCH (n:Node {id: $id})` → O(1) index lookup
 * - Without base labels: `MATCH (n {id: $id})` → full scan
 *
 * @param schema - The schema definition (optional)
 * @returns Formatted base label string (e.g., ':Node') or empty string
 */
export function getBaseLabelForIdLookup<S extends AnySchema>(schema: S | undefined): string {
  if (!schema) return ''

  const config = schema.labels ?? {}

  // If base labels are disabled, return empty string
  if (config.includeBaseLabels === false) return ''

  // Get the first base label (typically 'Node')
  const baseLabels = config.baseLabels ?? DEFAULT_BASE_LABELS
  if (baseLabels.length === 0) return ''

  return `:${baseLabels[0]}`
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
