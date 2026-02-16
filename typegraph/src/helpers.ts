/**
 * Runtime Helpers
 *
 * Inlined from @astrale/typegraph-core to remove the dependency.
 * These operate on the codegen schema shape at runtime.
 */

import type { SchemaShape, Cardinality } from './schema'

// ─── Label Resolution ────────────────────────────────────────

const labelCache = new WeakMap<SchemaShape, Map<string, string[]>>()

/**
 * Resolve all labels for a node type, including inherited labels.
 * Memoized per-schema for performance.
 *
 * @example
 * resolveNodeLabels(schema, 'Customer') // ['Customer', 'Timestamped']
 */
export function resolveNodeLabels(schema: SchemaShape, nodeType: string): string[] {
  let cache = labelCache.get(schema)
  if (!cache) {
    cache = new Map()
    labelCache.set(schema, cache)
  }

  const cached = cache.get(nodeType)
  if (cached) return [...cached]

  const seen = new Set<string>()
  const labels: string[] = []

  function collect(name: string): void {
    if (seen.has(name)) return
    seen.add(name)
    labels.push(toPascalCase(name))
    const def = schema.nodes[name]
    if (def?.implements) {
      for (const parent of def.implements) collect(parent)
    }
  }

  collect(nodeType)
  cache.set(nodeType, labels)
  return [...labels]
}

/**
 * Format labels array for Cypher: ['User', 'Entity'] → ':User:Entity'
 */
export function formatLabels(labels: string[]): string {
  return labels.map((l) => `:${l}`).join('')
}

/**
 * Convert string to PascalCase: 'has_parent' → 'HasParent'
 */
export function toPascalCase(str: string): string {
  return str
    .split(/[_\s-]+/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join('')
}

/**
 * Get all concrete node types that satisfy a given type constraint.
 * For a concrete type, returns itself. For an abstract type, returns
 * all concrete types that implement it (directly or transitively).
 */
export function getNodesSatisfying(schema: SchemaShape, label: string): string[] {
  const result: string[] = []
  for (const [name, def] of Object.entries(schema.nodes)) {
    if (def.abstract) continue
    const labels = resolveNodeLabels(schema, name)
    if (labels.includes(label)) {
      result.push(name)
    }
  }
  return result
}

// ─── Edge Navigation ─────────────────────────────────────────

/**
 * Resolve the from/to param names for an edge type.
 */
export function resolveEdgeParams(
  schema: SchemaShape,
  edgeType: string,
): { fromParam: string; toParam: string } {
  const ep = schema.edges[edgeType]?.endpoints
  if (!ep) throw new Error(`Unknown edge type: '${edgeType}'`)
  const params = Object.keys(ep)
  return { fromParam: params[0], toParam: params[1] }
}

/**
 * Get the target node types for an edge traversal from a given node type.
 */
export function getEdgeTargets(schema: SchemaShape, edgeType: string): string[] {
  const ep = schema.edges[edgeType]?.endpoints
  if (!ep) return []
  const params = Object.keys(ep)
  return [...ep[params[1]].types]
}

/**
 * Get the source node types for an edge.
 */
export function getEdgeSources(schema: SchemaShape, edgeType: string): string[] {
  const ep = schema.edges[edgeType]?.endpoints
  if (!ep) return []
  const params = Object.keys(ep)
  return [...ep[params[0]].types]
}

/**
 * Check if a node type can traverse an edge in a given direction.
 * Accounts for inheritance: if the edge's endpoint accepts 'Timestamped'
 * and the node implements 'Timestamped', the traversal is valid.
 */
export function canTraverseEdge(
  schema: SchemaShape,
  nodeType: string,
  edgeType: string,
  direction: 'out' | 'in',
): boolean {
  const ep = schema.edges[edgeType]?.endpoints
  if (!ep) return false
  const params = Object.keys(ep)
  const endpointTypes = direction === 'out' ? ep[params[0]].types : ep[params[1]].types

  // Wildcard '*' accepts any node
  if (endpointTypes.includes('*')) return true

  const nodeLabels = resolveNodeLabels(schema, nodeType)
  return endpointTypes.some((t) => nodeLabels.includes(t))
}

// ─── Edge Access Helpers ─────────────────────────────────────
// Bridge old schema access patterns (edge.from, edge.to, edge.cardinality)
// to the new endpoint-based schema.

/**
 * Get the "from" node types for an edge (first endpoint's types).
 * Normalizes to an array whether the endpoint accepts one or many types.
 */
export function edgeFrom(schema: SchemaShape, edgeType: string): string[] {
  const ep = schema.edges[edgeType]?.endpoints
  if (!ep) return []
  const params = Object.keys(ep)
  const types = ep[params[0]]?.types
  if (!types) return []
  return [...types]
}

/**
 * Get the "to" node types for an edge (second endpoint's types).
 */
export function edgeTo(schema: SchemaShape, edgeType: string): string[] {
  const ep = schema.edges[edgeType]?.endpoints
  if (!ep) return []
  const params = Object.keys(ep)
  const types = ep[params[1]]?.types
  if (!types) return []
  return [...types]
}

/**
 * Get the outbound/inbound cardinality for an edge.
 * Maps from endpoint cardinalities to the old { outbound, inbound } format.
 */
export function edgeCardinality(
  schema: SchemaShape,
  edgeType: string,
): { outbound: Cardinality; inbound: Cardinality } {
  const ep = schema.edges[edgeType]?.endpoints
  if (!ep) return { outbound: 'many', inbound: 'many' }
  const params = Object.keys(ep)

  const fromCard = ep[params[0]]?.cardinality
  const toCard = ep[params[1]]?.cardinality

  return {
    outbound: cardinalityFromMinMax(toCard),
    inbound: cardinalityFromMinMax(fromCard),
  }
}

function cardinalityFromMinMax(c?: { min: number; max: number | null }): Cardinality {
  if (!c) return 'many'
  if (c.min >= 1 && c.max === 1) return 'one'
  if (c.max === 1) return 'optional'
  return 'many'
}

// ─── Reification ──────────────────────────────────────────────

/** Resolve whether an edge is reified. Per-edge wins, then global, then false. */
export function isReified(schema: SchemaShape, edgeType: string): boolean {
  const edgeDef = schema.edges[edgeType]
  if (edgeDef?.reified !== undefined) return edgeDef.reified
  return schema.reifyEdges ?? false
}
