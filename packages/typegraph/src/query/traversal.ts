/**
 * Shared Traversal Logic
 *
 * Pure functions that build traversal AST nodes.
 * Used by all node builders to avoid duplicating traversal logic.
 */

import type { QueryAST } from '@astrale/typegraph-core'
import type { AnySchema } from '@astrale/typegraph-core'
import { buildEdgeWhere } from './traits'

// =============================================================================
// TYPES
// =============================================================================

export interface TraversalResult {
  ast: QueryAST
  cardinality: 'one' | 'optional' | 'many' | 'mixed'
}

export interface TraversalBuildOptions {
  where?: Record<string, unknown>
  edgeAs?: string
  depth?: { min: number; max: number }
  optional?: boolean
}

// =============================================================================
// SINGLE-EDGE TRAVERSAL
// =============================================================================

/**
 * Build an outgoing traversal (follow edge from→to).
 *
 * When `optional` is true, forces cardinality to 'optional' and marks the
 * traversal as OPTIONAL MATCH.
 */
export function buildOutTraversal(
  ast: QueryAST,
  schema: AnySchema,
  edge: string,
  options?: TraversalBuildOptions,
): TraversalResult {
  const edgeDef = schema.edges[edge]
  const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]
  const cardinality = options?.optional ? 'optional' : edgeDef.cardinality.outbound

  const newAst = ast.addTraversal({
    edges: [edge],
    direction: 'out',
    toLabels,
    optional: options?.optional ?? false,
    cardinality,
    edgeWhere: buildEdgeWhere(options?.where),
    edgeUserAlias: options?.edgeAs,
    variableLength: options?.depth
      ? { min: options.depth.min ?? 1, max: options.depth.max, uniqueness: 'nodes' as const }
      : undefined,
  })

  return { ast: newAst, cardinality: cardinality as TraversalResult['cardinality'] }
}

/**
 * Build an incoming traversal (follow edge to→from).
 */
export function buildInTraversal(
  ast: QueryAST,
  schema: AnySchema,
  edge: string,
  options?: TraversalBuildOptions,
): TraversalResult {
  const edgeDef = schema.edges[edge]
  const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
  const cardinality = options?.optional ? 'optional' : edgeDef.cardinality.inbound

  const newAst = ast.addTraversal({
    edges: [edge],
    direction: 'in',
    toLabels: fromLabels,
    optional: options?.optional ?? false,
    cardinality,
    edgeWhere: buildEdgeWhere(options?.where),
    edgeUserAlias: options?.edgeAs,
    variableLength: options?.depth
      ? { min: options.depth.min ?? 1, max: options.depth.max, uniqueness: 'nodes' as const }
      : undefined,
  })

  return { ast: newAst, cardinality: cardinality as TraversalResult['cardinality'] }
}

/**
 * Build a bidirectional traversal (follow edge in both directions).
 * Always returns cardinality 'many'.
 */
export function buildBiTraversal(
  ast: QueryAST,
  schema: AnySchema,
  edge: string,
  options?: { where?: Record<string, unknown> },
): TraversalResult {
  const edgeDef = schema.edges[edge]
  const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]
  const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
  const allLabels = [...new Set([...toLabels, ...fromLabels])]

  const newAst = ast.addTraversal({
    edges: [edge],
    direction: 'both',
    toLabels: allLabels,
    optional: false,
    cardinality: 'many',
    edgeWhere: buildEdgeWhere(options?.where),
  })

  return { ast: newAst, cardinality: 'many' }
}

// =============================================================================
// MULTI-EDGE TRAVERSAL
// =============================================================================

/**
 * Build a multi-edge traversal (follow any of the specified edges).
 * Always returns cardinality 'mixed'.
 */
export function buildMultiEdgeTraversal(
  ast: QueryAST,
  schema: AnySchema,
  edges: string[],
  direction: 'out' | 'in' | 'both',
  options?: { where?: Record<string, unknown> },
): TraversalResult {
  const allLabels: string[] = []

  for (const edge of edges) {
    const edgeDef = schema.edges[edge]
    if (direction === 'out' || direction === 'both') {
      const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]
      allLabels.push(...toLabels)
    }
    if (direction === 'in' || direction === 'both') {
      const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
      allLabels.push(...fromLabels)
    }
  }

  const newAst = ast.addTraversal({
    edges,
    direction,
    toLabels: [...new Set(allLabels)],
    optional: false,
    cardinality: 'mixed',
    edgeWhere: buildEdgeWhere(options?.where),
  })

  return { ast: newAst, cardinality: 'mixed' }
}
