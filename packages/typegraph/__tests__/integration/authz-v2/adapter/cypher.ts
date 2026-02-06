/**
 * Cypher Generation
 *
 * Generates CALL-subquery-based Cypher fragments from pruned identity expressions.
 * Receives PrunedIdentityExpr (scopes already evaluated by the pruning phase).
 * Each identity leaf carries an optional nodeRestriction from ancestor scope nodes.
 *
 * Uses CALL {} blocks to check `perms` array containment (FalkorDB does not
 * support EXISTS {} or pattern-comprehension WHERE in WHERE clauses).
 *
 * Requires indexes on:
 * - (:Node).id   (or whatever vocab.node is)
 * - (:Identity).id
 * Without these, ancestor traversal and identity lookups degrade significantly.
 */

import { throwExhaustiveCheck } from '../expression/validation'
import type { PrunedIdentityExpr, Permission, NodeId } from '../types'
import { type GraphVocab } from './vocabulary'

export interface CypherOptions {
  maxDepth: number
  vocab: GraphVocab
}

/**
 * A composable Cypher fragment for permission checking.
 *
 * - calls: CALL {} blocks that compute boolean variables
 * - vars: variable names introduced by the calls
 * - condition: boolean expression over those variables
 */
export type CypherFragment = {
  calls: string[]
  vars: string[]
  condition: string
  params: Record<string, unknown>
}

type Counter = { value: number }

/**
 * Cache for leaf-level Cypher fragments.
 * Keyed by (identityId, permission, nodeRestriction) to deduplicate
 * identical CALL blocks when the same identity appears at multiple
 * positions in the expression tree.
 */
type LeafCache = Map<string, { condition: string }>

function leafCacheKey(id: string, perm: string, nodeRestriction: NodeId[] | undefined): string {
  const nodes = nodeRestriction ? [...nodeRestriction].sort().join(',') : ''
  return `${id}|${perm}|${nodes}`
}

/**
 * Assemble a CypherFragment into a full executable query.
 * Used by the adapter to construct the final MATCH ... RETURN query.
 */
export function assembleQuery(
  fragment: CypherFragment,
  vocab: GraphVocab,
  resourceIdParam: string,
): { query: string; params: Record<string, unknown> } {
  const allVars = ['target', ...fragment.vars].join(', ')
  const query = [
    `MATCH (target:${vocab.node} {id: $${resourceIdParam}})`,
    ...fragment.calls,
    `WITH ${allVars}`,
    `WHERE ${fragment.condition}`,
    'RETURN true AS found',
    'LIMIT 1',
  ].join('\n')
  return { query, params: fragment.params }
}

/**
 * Format a CALL block string with line breaks for readability.
 */
function formatCallBlock(call: string): string {
  return call
    .replace(/CALL \{ WITH/g, 'CALL {\n  WITH')
    .replace(/ OPTIONAL MATCH/g, '\n  OPTIONAL MATCH')
    .replace(/(?<!OPTIONAL) MATCH/g, '\n  MATCH')
    .replace(/ WHERE/g, '\n  WHERE')
    .replace(/ RETURN/g, '\n  RETURN')
    .replace(/ LIMIT/g, '\n  LIMIT')
    .replace(/ \}$/, '\n}')
}

/**
 * Convert a CypherFragment to a full display query for debugging/explanation.
 * Shows the complete query as sent to FalkorDB.
 */
export function fragmentToDisplayString(fragment: CypherFragment | null): string | null {
  if (fragment === null) return null
  const allVars = ['target', ...fragment.vars].join(', ')
  const parts: string[] = [
    'MATCH (target {id: $resourceId})',
    ...fragment.calls.map(formatCallBlock),
    `WITH ${allVars}`,
    `WHERE ${fragment.condition}`,
    'RETURN true AS found',
    'LIMIT 1',
  ]
  return parts.join('\n')
}

/**
 * Generate Cypher fragment for permission check.
 * Receives a PrunedIdentityExpr (scopes already evaluated, no principal needed).
 */
export function toCypher(
  expr: PrunedIdentityExpr,
  perm: Permission,
  options: CypherOptions,
): CypherFragment | null {
  const counter: Counter = { value: 0 }
  const cache: LeafCache = new Map()
  return toCypherInternal(expr, perm, options, counter, cache)
}

function toCypherInternal(
  expr: PrunedIdentityExpr,
  perm: Permission,
  options: CypherOptions,
  counter: Counter,
  cache: LeafCache,
): CypherFragment | null {
  switch (expr.kind) {
    case 'identity':
      return identityToCypher(expr, perm, options, counter, cache)

    case 'union': {
      const fragments: CypherFragment[] = []
      for (const op of expr.operands) {
        const f = toCypherInternal(op, perm, options, counter, cache)
        if (f !== null) fragments.push(f)
      }
      if (fragments.length === 0) return null
      if (fragments.length === 1) return fragments[0]!
      return {
        calls: fragments.flatMap((f) => f.calls),
        vars: fragments.flatMap((f) => f.vars),
        condition: `(${fragments.map((f) => f.condition).join(' OR ')})`,
        params: Object.assign({}, ...fragments.map((f) => f.params)),
      }
    }

    case 'intersect': {
      const fragments: CypherFragment[] = []
      for (const op of expr.operands) {
        const f = toCypherInternal(op, perm, options, counter, cache)
        if (f === null) return null // Any null → whole thing null
        fragments.push(f)
      }
      if (fragments.length === 0) return null
      if (fragments.length === 1) return fragments[0]!
      return {
        calls: fragments.flatMap((f) => f.calls),
        vars: fragments.flatMap((f) => f.vars),
        condition: `(${fragments.map((f) => f.condition).join(' AND ')})`,
        params: Object.assign({}, ...fragments.map((f) => f.params)),
      }
    }

    case 'exclude': {
      const baseFragment = toCypherInternal(expr.base, perm, options, counter, cache)
      if (baseFragment === null) return null

      const excludedFragments: CypherFragment[] = []
      for (const ex of expr.excluded) {
        const f = toCypherInternal(ex, perm, options, counter, cache)
        if (f !== null) excludedFragments.push(f)
      }

      // Nothing to exclude → just the base
      if (excludedFragments.length === 0) return baseFragment

      return {
        calls: [...baseFragment.calls, ...excludedFragments.flatMap((f) => f.calls)],
        vars: [...baseFragment.vars, ...excludedFragments.flatMap((f) => f.vars)],
        condition: `(${baseFragment.condition} AND NOT (${excludedFragments.map((f) => f.condition).join(' OR ')}))`,
        params: Object.assign(
          {},
          baseFragment.params,
          ...excludedFragments.map((f) => f.params),
        ),
      }
    }

    default:
      throwExhaustiveCheck(expr)
  }
}

/**
 * Generate Cypher fragment for a single identity leaf.
 * Reads nodeRestriction directly from the leaf (set by pruning phase).
 *
 * Two strategies depending on whether node restrictions apply:
 *
 * 1. No restriction (common path):
 *    OPTIONAL MATCH ... RETURN hp IS NOT NULL LIMIT 1
 *    → early termination: stops after first matching permission edge.
 *
 * 2. With node restriction:
 *    Single merged traversal — one MATCH for ancestors, OPTIONAL MATCH for
 *    permission edges, then aggregate both perm and scope in one RETURN.
 *    Avoids traversing the ancestor chain twice.
 */
function identityToCypher(
  expr: Extract<PrunedIdentityExpr, { kind: 'identity' }>,
  perm: Permission,
  options: CypherOptions,
  counter: Counter,
  cache: LeafCache,
): CypherFragment | null {
  const { maxDepth, vocab: v } = options
  const nodeRestriction = expr.nodeRestriction

  // ── Leaf dedup: check cache for identical (id, perm, nodeRestriction) ──
  const cacheKey = leafCacheKey(expr.id, perm, nodeRestriction)
  const cached = cache.get(cacheKey)
  if (cached) {
    return {
      calls: [],
      vars: [],
      condition: cached.condition,
      params: {},
    }
  }

  const idx = counter.value++
  const permVar = `_c${idx}`
  const idParam = `id_${idx}`
  const permParam = `perm_${idx}`

  // ── No node restriction → early-termination CALL ──
  if (!nodeRestriction || nodeRestriction.length === 0) {
    const call =
      `CALL { WITH target` +
      ` OPTIONAL MATCH (target)-[:${v.parent}*0..${maxDepth}]->(n:${v.node})<-[hp:${v.perm}]-(i:${v.identity} {id: $${idParam}})` +
      ` WHERE $${permParam} IN hp.perms` +
      ` RETURN hp IS NOT NULL AS ${permVar}` +
      ` LIMIT 1 }`

    const condition = permVar
    cache.set(cacheKey, { condition })
    return {
      calls: [call],
      vars: [permVar],
      condition,
      params: { [idParam]: expr.id, [permParam]: perm },
    }
  }

  // ── Node restriction → merged single-traversal CALL ──
  const scopeVar = `_s${idx}`
  const scopeParam = `scopeNodes_${idx}`
  const scopeNodeIds = [...new Set(nodeRestriction)].sort()
  const call =
    `CALL { WITH target` +
    ` MATCH (target)-[:${v.parent}*0..${maxDepth}]->(a:${v.node})` +
    ` OPTIONAL MATCH (a)<-[hp:${v.perm}]-(i:${v.identity} {id: $${idParam}})` +
    ` WHERE $${permParam} IN hp.perms` +
    ` RETURN count(hp) > 0 AS ${permVar},` +
    ` count(CASE WHEN a.id IN $${scopeParam} THEN 1 END) > 0 AS ${scopeVar} }`

  const condition = `(${permVar} AND ${scopeVar})`
  cache.set(cacheKey, { condition })
  return {
    calls: [call],
    vars: [permVar, scopeVar],
    condition,
    params: { [idParam]: expr.id, [permParam]: perm, [scopeParam]: scopeNodeIds },
  }
}
