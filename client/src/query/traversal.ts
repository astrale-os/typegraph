/**
 * Shared Traversal Logic
 *
 * Pure functions that build traversal AST nodes.
 * Used by all node builders to avoid duplicating traversal logic.
 */

import type { SchemaShape } from '../schema'
import type { QueryAST } from './ast'

import { edgeFrom, edgeTo, edgeCardinality } from '../helpers'
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
  schema: SchemaShape,
  edge: string,
  options?: TraversalBuildOptions,
): TraversalResult {
  const toLabels = edgeTo(schema, edge)
  const cardinality = options?.optional ? 'optional' : edgeCardinality(schema, edge).outbound

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
  schema: SchemaShape,
  edge: string,
  options?: TraversalBuildOptions,
): TraversalResult {
  const fromLabels = edgeFrom(schema, edge)
  const cardinality = options?.optional ? 'optional' : edgeCardinality(schema, edge).inbound

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
  schema: SchemaShape,
  edge: string,
  options?: { where?: Record<string, unknown> },
): TraversalResult {
  const toLabels = edgeTo(schema, edge)
  const fromLabels = edgeFrom(schema, edge)
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
  schema: SchemaShape,
  edges: string[],
  direction: 'out' | 'in' | 'both',
  options?: { where?: Record<string, unknown> },
): TraversalResult {
  const allLabels: string[] = []

  for (const edge of edges) {
    if (direction === 'out' || direction === 'both') {
      allLabels.push(...edgeTo(schema, edge))
    }
    if (direction === 'in' || direction === 'both') {
      allLabels.push(...edgeFrom(schema, edge))
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
