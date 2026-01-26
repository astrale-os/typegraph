/**
 * Label Utilities
 *
 * Utilities for resolving and formatting node labels.
 * Enables universal :Node label for O(1) lookups via index.
 */

import type { AnySchema } from './types'

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
 * 3. Any additional labels defined on the node
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
 * // With additionalLabels on node
 * resolveNodeLabels(schema, 'admin') // ['Node', 'Admin', 'Privileged']
 *
 * // With custom base labels
 * resolveNodeLabels(schemaWithCustomLabels, 'user') // ['Entity', 'Auditable', 'User']
 *
 * // With includeBaseLabels: false
 * resolveNodeLabels(schemaWithoutBase, 'user') // ['User']
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

  // Add any additional labels from the node definition
  if (nodeDef?.additionalLabels) {
    labels.push(...nodeDef.additionalLabels)
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
 * Convert a string to PascalCase.
 * Used to standardize node labels in Cypher.
 *
 * @param str - Input string (e.g., 'user', 'userProfile', 'user_profile')
 * @returns PascalCase string (e.g., 'User', 'UserProfile', 'UserProfile')
 */
function toPascalCase(str: string): string {
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
