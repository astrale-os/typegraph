/**
 * Shared Builder Implementation
 *
 * Contains shared logic that all builders delegate to.
 * This avoids code duplication while keeping types simple.
 */

import type { QueryAST } from '@astrale/typegraph-core'
import type { AnySchema, EdgeTypes } from '@astrale/typegraph-core'
import type { HierarchyTraversalOptions, ReachableOptions } from './traits'

// =============================================================================
// HIERARCHY HELPERS
// =============================================================================

export function resolveHierarchyEdge<S extends AnySchema>(schema: S, edge?: EdgeTypes<S>): string {
  if (edge) return edge as string
  const hierarchy = schema.hierarchy
  if (!hierarchy?.defaultEdge) {
    throw new Error('No hierarchy edge specified and schema has no default hierarchy configuration')
  }
  return hierarchy.defaultEdge
}

export function getHierarchyDirection<S extends AnySchema>(schema: S): 'up' | 'down' {
  const hierarchy = schema.hierarchy
  return hierarchy?.direction ?? 'up'
}

export function parseHierarchyArgs<S extends AnySchema>(
  edgeOrOptions?: EdgeTypes<S> | HierarchyTraversalOptions,
  options?: HierarchyTraversalOptions,
): [EdgeTypes<S> | undefined, HierarchyTraversalOptions | undefined] {
  if (typeof edgeOrOptions === 'string') {
    return [edgeOrOptions as EdgeTypes<S>, options]
  }
  return [undefined, edgeOrOptions as HierarchyTraversalOptions | undefined]
}

/**
 * Derive the target node label for a hierarchy operation.
 * This determines which node type to match at the end of the traversal.
 *
 * For 'up' direction (child → parent edges like hasParent):
 *   - ancestors/parent/root: follow outgoing edges, target is edge.to
 *   - descendants/children: follow incoming edges, target is edge.from
 *
 * For 'down' direction (parent → child edges like contains):
 *   - ancestors/parent/root: follow incoming edges, target is edge.from
 *   - descendants/children: follow outgoing edges, target is edge.to
 */
export function deriveHierarchyTargetLabel<S extends AnySchema>(
  schema: S,
  edgeName: string,
  operation: 'ancestors' | 'descendants' | 'siblings' | 'root' | 'parent' | 'children',
  direction: 'up' | 'down',
): string | undefined {
  const edgeDef = (schema.edges as Record<string, { from?: string | string[]; to?: string | string[] }>)[edgeName]
  if (!edgeDef) return undefined

  // Determine if we're following outgoing or incoming edges
  const followsOutgoing =
    direction === 'up'
      ? operation === 'ancestors' || operation === 'parent' || operation === 'root'
      : operation === 'descendants' || operation === 'children'

  // Get the appropriate endpoint
  const endpoint = followsOutgoing ? edgeDef.to : edgeDef.from

  // Handle array endpoints (return first, which is the primary type)
  return Array.isArray(endpoint) ? endpoint[0] : endpoint
}

// =============================================================================
// HIERARCHY OPERATIONS
// =============================================================================

export function addAncestors<S extends AnySchema>(
  ast: QueryAST,
  schema: S,
  edgeOrOptions?: EdgeTypes<S> | HierarchyTraversalOptions,
  options?: HierarchyTraversalOptions,
): QueryAST {
  const [edge, opts] = parseHierarchyArgs(edgeOrOptions, options)
  const resolvedEdge = resolveHierarchyEdge(schema, edge)
  const direction = getHierarchyDirection(schema)
  const targetLabel = deriveHierarchyTargetLabel(schema, resolvedEdge, 'ancestors', direction)

  return ast.addHierarchy({
    operation: 'ancestors',
    edge: resolvedEdge,
    hierarchyDirection: direction,
    minDepth: opts?.minDepth,
    maxDepth: opts?.maxDepth,
    includeDepth: opts?.includeDepth,
    depthAlias: opts?.depthAlias,
    untilKind: opts?.untilKind,
    targetLabel,
  })
}

export function addSelfAndAncestors<S extends AnySchema>(
  ast: QueryAST,
  schema: S,
  edgeOrOptions?: EdgeTypes<S> | HierarchyTraversalOptions,
  options?: HierarchyTraversalOptions,
): QueryAST {
  const [edge, opts] = parseHierarchyArgs(edgeOrOptions, options)
  const resolvedEdge = resolveHierarchyEdge(schema, edge)
  const direction = getHierarchyDirection(schema)
  const targetLabel = deriveHierarchyTargetLabel(schema, resolvedEdge, 'ancestors', direction)

  return ast.addHierarchy({
    operation: 'ancestors',
    edge: resolvedEdge,
    hierarchyDirection: direction,
    minDepth: opts?.minDepth ?? 0, // Start from 0 to include self
    maxDepth: opts?.maxDepth,
    includeDepth: true, // Always include depth for selfAndAncestors
    depthAlias: opts?.depthAlias ?? '_depth',
    includeSelf: true,
    untilKind: opts?.untilKind,
    targetLabel,
  })
}

export function addDescendants<S extends AnySchema>(
  ast: QueryAST,
  schema: S,
  edgeOrOptions?: EdgeTypes<S> | HierarchyTraversalOptions,
  options?: HierarchyTraversalOptions,
): QueryAST {
  const [edge, opts] = parseHierarchyArgs(edgeOrOptions, options)
  const resolvedEdge = resolveHierarchyEdge(schema, edge)
  const direction = getHierarchyDirection(schema)
  const targetLabel = deriveHierarchyTargetLabel(schema, resolvedEdge, 'descendants', direction)

  // Pass the actual schema direction - the compiler handles the traversal logic
  return ast.addHierarchy({
    operation: 'descendants',
    edge: resolvedEdge,
    hierarchyDirection: direction,
    minDepth: opts?.minDepth,
    maxDepth: opts?.maxDepth,
    includeDepth: opts?.includeDepth,
    depthAlias: opts?.depthAlias,
    targetLabel,
  })
}

export function addSiblings<S extends AnySchema>(
  ast: QueryAST,
  schema: S,
  edge?: EdgeTypes<S>,
): QueryAST {
  const resolvedEdge = resolveHierarchyEdge(schema, edge)
  const direction = getHierarchyDirection(schema)
  const targetLabel = deriveHierarchyTargetLabel(schema, resolvedEdge, 'siblings', direction)

  return ast.addHierarchy({
    operation: 'siblings',
    edge: resolvedEdge,
    hierarchyDirection: direction,
    targetLabel,
  })
}

export function addChildren<S extends AnySchema>(
  ast: QueryAST,
  schema: S,
  edge?: EdgeTypes<S>,
): QueryAST {
  const resolvedEdge = resolveHierarchyEdge(schema, edge)
  const direction = getHierarchyDirection(schema)
  const targetLabel = deriveHierarchyTargetLabel(schema, resolvedEdge, 'children', direction)

  // Pass the actual schema direction - the compiler handles the traversal logic
  return ast.addHierarchy({
    operation: 'children',
    edge: resolvedEdge,
    hierarchyDirection: direction,
    targetLabel,
  })
}

export function addRoot<S extends AnySchema>(
  ast: QueryAST,
  schema: S,
  edge?: EdgeTypes<S>,
): QueryAST {
  const resolvedEdge = resolveHierarchyEdge(schema, edge)
  const direction = getHierarchyDirection(schema)
  const targetLabel = deriveHierarchyTargetLabel(schema, resolvedEdge, 'root', direction)

  return ast.addHierarchy({
    operation: 'root',
    edge: resolvedEdge,
    hierarchyDirection: direction,
    targetLabel,
  })
}

export function addParent<S extends AnySchema>(
  ast: QueryAST,
  schema: S,
  edge?: EdgeTypes<S>,
): { ast: QueryAST; cardinality: 'one' | 'optional' | 'many' } {
  const resolvedEdge = resolveHierarchyEdge(schema, edge)
  const direction = getHierarchyDirection(schema)
  const targetLabel = deriveHierarchyTargetLabel(schema, resolvedEdge, 'parent', direction)

  const newAst = ast.addHierarchy({
    operation: 'parent',
    edge: resolvedEdge,
    hierarchyDirection: direction,
    targetLabel,
  })

  const edgeDef = (
    schema.edges as Record<string, { cardinality?: { outbound?: string; inbound?: string } }>
  )[resolvedEdge]
  const cardinality =
    direction === 'up' ? edgeDef?.cardinality?.outbound : edgeDef?.cardinality?.inbound

  return { ast: newAst, cardinality: (cardinality ?? 'optional') as 'one' | 'many' | 'optional' }
}

// =============================================================================
// REACHABLE OPERATION
// =============================================================================

export function addReachable<S extends AnySchema>(
  ast: QueryAST,
  edges: EdgeTypes<S> | readonly EdgeTypes<S>[],
  options?: ReachableOptions,
): QueryAST {
  const edgeArray = Array.isArray(edges) ? edges : [edges]

  return ast.addReachable({
    edges: edgeArray as string[],
    direction: options?.direction ?? 'out',
    minDepth: options?.minDepth,
    maxDepth: options?.maxDepth,
    includeDepth: options?.includeDepth,
    depthAlias: options?.depthAlias,
    uniqueness: options?.uniqueness,
  })
}

export function addSelfAndReachable<S extends AnySchema>(
  ast: QueryAST,
  edges: EdgeTypes<S> | readonly EdgeTypes<S>[],
  options?: ReachableOptions,
): QueryAST {
  const edgeArray = Array.isArray(edges) ? edges : [edges]

  return ast.addReachable({
    edges: edgeArray as string[],
    direction: options?.direction ?? 'out',
    minDepth: 0, // Start from 0 to include self
    maxDepth: options?.maxDepth,
    includeDepth: true, // Always include depth for selfAndReachable
    depthAlias: options?.depthAlias ?? '_depth',
    uniqueness: options?.uniqueness ?? 'nodes',
    includeSelf: true,
  })
}
