/**
 * Cypher Generation
 *
 * Generates CALL-subquery-based Cypher fragments from identity expressions.
 * Uses CALL {} blocks to check `perms` array containment (FalkorDB does not
 * support EXISTS {} or pattern-comprehension WHERE in WHERE clauses).
 *
 * Requires indexes on:
 * - (:Node).id   (or whatever vocab.node is)
 * - (:Identity).id
 * Without these, ancestor traversal and identity lookups degrade significantly.
 */

import { filterApplicableScopes } from '../expression/scope'
import { throwExhaustiveCheck } from '../expression/validation'
import type { IdentityExpr, PermissionT, IdentityId } from '../types'
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
 * Keyed by (identityId, permission, scopeNodeIds) to deduplicate
 * identical CALL blocks when the same identity appears at multiple
 * positions in the expression tree.
 */
type LeafCache = Map<string, { condition: string }>

function leafCacheKey(id: string, perm: string, scopeNodeIds: string[]): string {
  return `${id}|${perm}|${scopeNodeIds.join(',')}`
}

/**
 * Assemble a CypherFragment into a full executable query.
 * Used by the adapter to construct the final MATCH ... RETURN query.
 */
export function assembleQuery(
  fragment: CypherFragment,
  targetVar: string,
  vocab: GraphVocab,
  resourceIdParam: string,
): { query: string; params: Record<string, unknown> } {
  const allVars = [targetVar, ...fragment.vars].join(', ')
  const query = [
    `MATCH (${targetVar}:${vocab.node} {id: $${resourceIdParam}})`,
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
 */
export function toCypher(
  expr: IdentityExpr,
  targetVar: string,
  perm: PermissionT,
  principal: IdentityId | undefined,
  options: CypherOptions,
): CypherFragment | null {
  const counter: Counter = { value: 0 }
  const cache: LeafCache = new Map()
  return toCypherInternal(expr, targetVar, perm, principal, options, counter, cache)
}

function toCypherInternal(
  expr: IdentityExpr,
  targetVar: string,
  perm: PermissionT,
  principal: IdentityId | undefined,
  options: CypherOptions,
  counter: Counter,
  cache: LeafCache,
): CypherFragment | null {
  switch (expr.kind) {
    case 'identity':
      return identityToCypher(expr, targetVar, perm, principal, options, counter, cache)

    case 'union': {
      const left = toCypherInternal(expr.left, targetVar, perm, principal, options, counter, cache)
      const right = toCypherInternal(
        expr.right,
        targetVar,
        perm,
        principal,
        options,
        counter,
        cache,
      )
      if (left === null && right === null) return null
      if (left === null) return right
      if (right === null) return left
      return {
        calls: [...left.calls, ...right.calls],
        vars: [...left.vars, ...right.vars],
        condition: `(${left.condition} OR ${right.condition})`,
        params: { ...left.params, ...right.params },
      }
    }

    case 'intersect': {
      const left = toCypherInternal(expr.left, targetVar, perm, principal, options, counter, cache)
      const right = toCypherInternal(
        expr.right,
        targetVar,
        perm,
        principal,
        options,
        counter,
        cache,
      )
      if (left === null || right === null) return null
      return {
        calls: [...left.calls, ...right.calls],
        vars: [...left.vars, ...right.vars],
        condition: `(${left.condition} AND ${right.condition})`,
        params: { ...left.params, ...right.params },
      }
    }

    case 'exclude': {
      const left = toCypherInternal(expr.left, targetVar, perm, principal, options, counter, cache)
      const right = toCypherInternal(
        expr.right,
        targetVar,
        perm,
        principal,
        options,
        counter,
        cache,
      )
      if (left === null) return null
      if (right === null) return left
      return {
        calls: [...left.calls, ...right.calls],
        vars: [...left.vars, ...right.vars],
        condition: `(${left.condition} AND NOT (${right.condition}))`,
        params: { ...left.params, ...right.params },
      }
    }
    default:
      throwExhaustiveCheck(expr)
  }
}

/**
 * Generate Cypher fragment for a single identity with scope filtering.
 *
 * Two strategies depending on whether scope restrictions apply:
 *
 * 1. No scope (common path):
 *    OPTIONAL MATCH ... RETURN hp IS NOT NULL LIMIT 1
 *    → early termination: stops after first matching permission edge.
 *
 * 2. With scope restrictions:
 *    Single merged traversal — one MATCH for ancestors, OPTIONAL MATCH for
 *    permission edges, then aggregate both perm and scope in one RETURN.
 *    Avoids traversing the ancestor chain twice.
 */
function identityToCypher(
  expr: Extract<IdentityExpr, { kind: 'identity' }>,
  targetVar: string,
  perm: PermissionT,
  principal: IdentityId | undefined,
  options: CypherOptions,
  counter: Counter,
  cache: LeafCache,
): CypherFragment | null {
  const { maxDepth, vocab: v } = options

  // Check if allowed by scopes
  const { allowed, applicableScopes } = filterApplicableScopes(expr.scopes, principal, perm)
  if (!allowed) return null

  // Determine scope node restrictions (if any)
  const needsScope = applicableScopes.length > 0 && !applicableScopes.some((s) => !s.nodes?.length)
  const scopeNodeIds = needsScope
    ? [...new Set(applicableScopes.flatMap((s) => s.nodes ?? []))].sort()
    : []

  // ── Leaf dedup: check cache for identical (id, perm, scopeNodeIds) ──
  const cacheKey = leafCacheKey(expr.id, perm, scopeNodeIds)
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

  // ── No scope restrictions → early-termination CALL ──
  // OPTIONAL MATCH + hp IS NOT NULL + LIMIT 1 stops at first match.
  if (scopeNodeIds.length === 0) {
    const call =
      `CALL { WITH ${targetVar}` +
      ` OPTIONAL MATCH (${targetVar})-[:${v.parent}*0..${maxDepth}]->(n:${v.node})<-[hp:${v.perm}]-(i:${v.identity} {id: $${idParam}})` +
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

  // ── Scope restrictions → merged single-traversal CALL ──
  // One MATCH walks ancestors, OPTIONAL MATCH probes permission edges,
  // then a single RETURN aggregates both checks.
  const scopeVar = `_s${idx}`
  const scopeParam = `scopeNodes_${idx}`
  const call =
    `CALL { WITH ${targetVar}` +
    ` MATCH (${targetVar})-[:${v.parent}*0..${maxDepth}]->(a:${v.node})` +
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
