/**
 * Expression Pruning — Scope Evaluation + Algebraic Simplification
 *
 * Transforms IdentityExpr → PrunedIdentityExpr | null by:
 * 1. Evaluating scope nodes: check principal + perm restrictions
 * 2. Propagating node restrictions to identity leaves via intersection
 * 3. Simplifying dead branches (algebraic rules)
 *
 * Pure function — no I/O. Runs before the adapter (Cypher generation).
 *
 * Algebraic simplification rules:
 * - A ∪ ∅ = A (filter null operands from union)
 * - A ∩ ∅ = ∅ (any null operand → whole intersect is null)
 * - ∅ \ A = ∅ (null base → null)
 * - A \ ∅ = A (null excluded → drop from excluded list)
 * - union/intersect with single remaining operand → unwrap
 * - exclude with empty excluded list → just base
 */

import type {
  IdentityExpr,
  PrunedIdentityExpr,
  IdentityId,
  Permission,
  NodeId,
  Scope,
} from '../types'
import { scopePasses } from './scope'

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Prune an expression tree by evaluating scope nodes and propagating
 * node restrictions to identity leaves.
 *
 * @param expr - The expression to prune
 * @param principal - The requesting principal (checked against scope.principals)
 * @param perm - The requested permission (checked against scope.perms)
 * @returns Pruned expression with nodeRestriction on leaves, or null if entirely filtered
 */
export function pruneExpression(
  expr: IdentityExpr,
  principal: IdentityId | undefined,
  perm: Permission,
): PrunedIdentityExpr | null {
  return pruneInternal(expr, principal, perm, undefined)
}

// =============================================================================
// INTERNAL
// =============================================================================

function pruneInternal(
  expr: IdentityExpr,
  principal: IdentityId | undefined,
  perm: Permission,
  parentNodeRestriction: NodeId[] | undefined,
): PrunedIdentityExpr | null {
  switch (expr.kind) {
    case 'identity':
      return parentNodeRestriction
        ? { kind: 'identity', id: expr.id, nodeRestriction: parentNodeRestriction }
        : { kind: 'identity', id: expr.id }

    case 'scope':
      return pruneScope(expr, principal, perm, parentNodeRestriction)

    case 'union':
      return pruneUnion(expr.operands, principal, perm, parentNodeRestriction)

    case 'intersect':
      return pruneIntersect(expr.operands, principal, perm, parentNodeRestriction)

    case 'exclude':
      return pruneExclude(expr.base, expr.excluded, principal, perm, parentNodeRestriction)
  }
}

/**
 * Evaluate a scope node:
 * - Check each scope against principal + perm (OR semantics: any scope passing = allowed)
 * - If all scopes fail → return null (dead branch)
 * - If some pass → collect their node restrictions, intersect with parent, propagate
 */
function pruneScope(
  expr: Extract<IdentityExpr, { kind: 'scope' }>,
  principal: IdentityId | undefined,
  perm: Permission,
  parentNodeRestriction: NodeId[] | undefined,
): PrunedIdentityExpr | null {
  const { scopes, expr: inner } = expr

  // Find scopes that pass principal + perm checks
  const applicableScopes = scopes.filter((scope) => scopePasses(scope, principal, perm).passes)

  if (applicableScopes.length === 0) {
    return null // All scopes rejected → dead branch
  }

  // Collect node restrictions from applicable scopes (OR'd together = union of nodes)
  const hasUnrestrictedScope = applicableScopes.some((s) => s.nodes === undefined)

  let scopeNodeRestriction: NodeId[] | undefined
  if (!hasUnrestrictedScope) {
    // All applicable scopes have node restrictions → union them (any scope's nodes are valid)
    scopeNodeRestriction = [...new Set(applicableScopes.flatMap((s) => s.nodes ?? []))]
  }
  // else: at least one scope has no node restriction → unrestricted

  // Intersect with parent node restriction
  const mergedRestriction = intersectNodeRestrictions(parentNodeRestriction, scopeNodeRestriction)

  // Empty intersection = impossible (no valid nodes) → dead branch
  if (mergedRestriction !== undefined && mergedRestriction.length === 0) {
    return null
  }

  return pruneInternal(inner, principal, perm, mergedRestriction)
}

function pruneUnion(
  operands: IdentityExpr[],
  principal: IdentityId | undefined,
  perm: Permission,
  parentNodeRestriction: NodeId[] | undefined,
): PrunedIdentityExpr | null {
  const pruned: PrunedIdentityExpr[] = []
  for (const op of operands) {
    const result = pruneInternal(op, principal, perm, parentNodeRestriction)
    if (result !== null) {
      pruned.push(result)
    }
  }

  if (pruned.length === 0) return null
  if (pruned.length === 1) return pruned[0]!
  return { kind: 'union', operands: pruned }
}

function pruneIntersect(
  operands: IdentityExpr[],
  principal: IdentityId | undefined,
  perm: Permission,
  parentNodeRestriction: NodeId[] | undefined,
): PrunedIdentityExpr | null {
  const pruned: PrunedIdentityExpr[] = []
  for (const op of operands) {
    const result = pruneInternal(op, principal, perm, parentNodeRestriction)
    if (result === null) return null // A ∩ ∅ = ∅
    pruned.push(result)
  }

  if (pruned.length === 1) return pruned[0]!
  return { kind: 'intersect', operands: pruned }
}

function pruneExclude(
  base: IdentityExpr,
  excluded: IdentityExpr[],
  principal: IdentityId | undefined,
  perm: Permission,
  parentNodeRestriction: NodeId[] | undefined,
): PrunedIdentityExpr | null {
  const prunedBase = pruneInternal(base, principal, perm, parentNodeRestriction)
  if (prunedBase === null) return null // ∅ \ A = ∅

  const prunedExcluded: PrunedIdentityExpr[] = []
  for (const ex of excluded) {
    const result = pruneInternal(ex, principal, perm, parentNodeRestriction)
    if (result !== null) {
      prunedExcluded.push(result)
    }
    // null excluded items are dropped: A \ ∅ = A
  }

  if (prunedExcluded.length === 0) return prunedBase // Nothing to exclude
  return { kind: 'exclude', base: prunedBase, excluded: prunedExcluded }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Intersect two node restrictions.
 *
 * undefined = unrestricted (all nodes allowed).
 * NodeId[] = only these nodes allowed.
 *
 * @returns Intersection of restrictions (undefined if both unrestricted)
 */
export function intersectNodeRestrictions(
  a: NodeId[] | undefined,
  b: NodeId[] | undefined,
): NodeId[] | undefined {
  if (a === undefined) return b
  if (b === undefined) return a

  const setA = new Set(a)
  return b.filter((id) => setA.has(id))
}
