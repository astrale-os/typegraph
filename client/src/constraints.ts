/**
 * Edge Constraint Enforcement
 *
 * Validates edge constraints (unique, no_self, acyclic, cardinality)
 * before edge creation. Uses the adapter for database-level checks.
 */

import type { GraphAdapter } from './adapter'

// ─── Types ───────────────────────────────────────────────────

/**
 * Runtime schema metadata shape used for constraint enforcement.
 * Compatible with the `schema` const emitted by codegen.
 */
export interface ConstraintSchemaInfo {
  readonly edges: Record<string, ConstraintEdgeDef>
}

export interface ConstraintEdgeDef {
  readonly endpoints: Record<
    string,
    { types: readonly string[]; cardinality?: { min: number; max: number | null } }
  >
  readonly constraints?: Partial<{
    no_self: boolean
    acyclic: boolean
    unique: boolean
    symmetric: boolean
  }>
}

export interface ResolvedEndpoints {
  from: string
  to: string
  fromParam: string
  toParam: string
  mapping: Record<string, string>
}

export class ConstraintViolation extends Error {
  constructor(
    public readonly edgeType: string,
    public readonly constraint: string,
    message: string,
  ) {
    super(`Constraint violation on '${edgeType}' (${constraint}): ${message}`)
    this.name = 'ConstraintViolation'
  }
}

// ─── Resolve ─────────────────────────────────────────────────

/**
 * Resolve named endpoint params to from/to IDs.
 * Edge endpoints are ordered by KRL declaration order:
 * first endpoint = from side, second = to side.
 */
export function resolveEndpoints(
  edgeType: string,
  endpointValues: Record<string, string>,
  schemaInfo: ConstraintSchemaInfo,
): ResolvedEndpoints {
  const epDef = schemaInfo.edges[edgeType]?.endpoints
  if (!epDef) throw new Error(`Unknown edge type: '${edgeType}'`)

  const paramNames = Object.keys(epDef)
  for (const p of paramNames) {
    if (!endpointValues[p]) {
      throw new Error(`Missing endpoint '${p}' for edge '${edgeType}'`)
    }
  }

  const [fromParam, toParam] = paramNames
  return {
    from: endpointValues[fromParam],
    to: endpointValues[toParam],
    fromParam,
    toParam,
    mapping: endpointValues,
  }
}

// ─── Enforce ─────────────────────────────────────────────────

/**
 * Enforce all edge constraints before creating an edge.
 * Throws ConstraintViolation on first failure.
 *
 * Uses the adapter directly for database-level checks (edge existence, reachability, counts).
 */
export async function enforceConstraints(
  adapter: GraphAdapter,
  edgeType: string,
  endpoints: ResolvedEndpoints,
  schemaInfo: ConstraintSchemaInfo,
): Promise<void> {
  const c = schemaInfo.edges[edgeType]?.constraints

  if (c?.no_self && endpoints.from === endpoints.to) {
    throw new ConstraintViolation(edgeType, 'no_self', 'Cannot connect a node to itself')
  }

  if (c?.unique) {
    const [row] = await adapter.query<{ c: number }>(
      `MATCH (a {id: $from})-[:${edgeType}]->(b {id: $to}) RETURN count(*) AS c`,
      { from: endpoints.from, to: endpoints.to },
    )
    if ((row?.c ?? 0) > 0) {
      throw new ConstraintViolation(edgeType, 'unique', 'Edge already exists between these nodes')
    }
  }

  if (c?.acyclic) {
    const [row] = await adapter.query<{ c: number }>(
      `MATCH path = (a {id: $from})-[:${edgeType}*]->(b {id: $to}) RETURN count(path) AS c LIMIT 1`,
      { from: endpoints.to, to: endpoints.from },
    )
    if ((row?.c ?? 0) > 0) {
      throw new ConstraintViolation(edgeType, 'acyclic', 'Edge would create a cycle')
    }
  }

  // Cardinality enforcement per endpoint
  const epDef = schemaInfo.edges[edgeType].endpoints
  const paramNames = Object.keys(epDef)
  for (let i = 0; i < paramNames.length; i++) {
    const param = paramNames[i]
    const max = epDef[param].cardinality?.max
    if (max !== undefined && max !== null) {
      const nodeId = endpoints.mapping[param]
      const pattern =
        i === 0 ? `(n {id: $nodeId})-[:${edgeType}]->()` : `()-[:${edgeType}]->(n {id: $nodeId})`
      const [row] = await adapter.query<{ c: number }>(`MATCH ${pattern} RETURN count(*) AS c`, {
        nodeId,
      })
      if ((row?.c ?? 0) >= max) {
        throw new ConstraintViolation(
          edgeType,
          'cardinality',
          `Endpoint '${param}' exceeds max cardinality ${max}`,
        )
      }
    }
  }
}
