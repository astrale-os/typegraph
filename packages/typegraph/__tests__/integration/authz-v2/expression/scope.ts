/**
 * AUTH_V2 Scope Utilities
 *
 * Proper scope intersection logic.
 * Scopes can only be made MORE restrictive, never less.
 */

import type { IdentityExpr, Scope, IdentityId, Permission, PermissionMask, FilterDetail } from '../types'

// =============================================================================
// SCOPE INTERSECTION
// =============================================================================

/**
 * Intersect two arrays, returning elements present in both.
 * undefined means "unrestricted" - the other array wins.
 * Empty array means "nothing allowed".
 */
function intersectArrays<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  if (a === undefined && b === undefined) return undefined
  if (a === undefined) return b
  if (b === undefined) return a

  const setB = new Set(b)
  return a.filter((x) => setB.has(x))
}

/**
 * Intersect two permission masks.
 * undefined means "unrestricted" — the other mask wins.
 * 0 means "nothing allowed".
 */
function intersectPermsMask(
  a: PermissionMask | undefined,
  b: PermissionMask | undefined,
): PermissionMask | undefined {
  if (a === undefined && b === undefined) return undefined
  if (a === undefined) return b
  if (b === undefined) return a
  return (a & b) as PermissionMask
}

/**
 * Intersect two individual scopes.
 * Returns the most restrictive combination of both.
 *
 * Each dimension (nodes, perms, principals) is intersected:
 * - nodes/principals: undefined = unrestricted, [] = nothing allowed
 * - perms: undefined = unrestricted, 0 = nothing allowed, positive = these bits
 *
 * Returns null if the intersection is impossible (would allow nothing).
 */
export function intersectScope(a: Scope, b: Scope): Scope | null {
  const nodes = intersectArrays(a.nodes, b.nodes)
  const perms = intersectPermsMask(a.perms, b.perms)
  const principals = intersectArrays(a.principals, b.principals)

  // If any dimension allows nothing, the scope is impossible
  if (nodes?.length === 0 || perms === 0 || principals?.length === 0) {
    return null
  }

  // Build result, omitting undefined dimensions
  const result: Scope = {}
  if (nodes !== undefined) result.nodes = nodes
  if (perms !== undefined) result.perms = perms
  if (principals !== undefined) result.principals = principals

  return result
}

/**
 * Intersect two scope arrays.
 *
 * Multiple scopes are OR'd (any scope passing = access granted).
 * Intersection of two scope arrays = for each pair, compute intersection,
 * keep only valid (non-null) results.
 *
 * This makes the result MORE restrictive than either input.
 *
 * @param a First scope array (OR'd together)
 * @param b Second scope array (OR'd together)
 * @returns Intersection of scopes (also OR'd together)
 */
export function intersectScopes(a: Scope[], b: Scope[]): Scope[] {
  // Empty array = no restrictions (unrestricted)
  if (a.length === 0) return b
  if (b.length === 0) return a

  const seen = new Set<string>()
  const results: Scope[] = []

  for (const scopeA of a) {
    for (const scopeB of b) {
      const intersection = intersectScope(scopeA, scopeB)
      if (intersection !== null) {
        const key = scopeToKey(intersection)
        if (!seen.has(key)) {
          seen.add(key)
          results.push(intersection)
        }
      }
    }
  }

  return results
}

/**
 * Create a deterministic string key for a scope (for deduplication).
 * Uses JSON.stringify to avoid collisions from delimiter characters in IDs.
 */
function scopeToKey(scope: Scope): string {
  return JSON.stringify({
    n: scope.nodes ? [...scope.nodes].sort() : null,
    p: scope.perms ?? null,
    r: scope.principals ? [...scope.principals].sort() : null,
  })
}

// =============================================================================
// RICH SCOPE CHECKS (used by pruning phase)
// =============================================================================

/**
 * Check if a single scope allows the given principal and perm.
 * Rich version that returns the failed check reason.
 */
export function scopePasses(
  scope: Scope,
  principal: IdentityId | undefined,
  perm: Permission,
): { passes: boolean; failedCheck?: 'principal' | 'perm' } {
  if (scope.principals !== undefined && (scope.principals.length === 0 || !principal || !scope.principals.includes(principal))) {
    return { passes: false, failedCheck: 'principal' }
  }
  if (scope.perms !== undefined && ((scope.perms & perm) === 0)) {
    return { passes: false, failedCheck: 'perm' }
  }
  return { passes: true }
}

/**
 * Check scope filter for cold path (returns FilterDetail[]).
 */
export function checkFilter(
  scopes: Scope[] | undefined,
  principal: IdentityId | undefined,
  perm: Permission,
): { allowed: boolean; details?: FilterDetail[]; applicableScopes?: Scope[] } {
  if (!scopes?.length) {
    return { allowed: true, applicableScopes: [] }
  }

  const details: FilterDetail[] = []
  const applicableScopes: Scope[] = []

  for (let i = 0; i < scopes.length; i++) {
    const result = scopePasses(scopes[i]!, principal, perm)
    if (result.passes) {
      applicableScopes.push(scopes[i]!)
    } else {
      details.push({ scopeIndex: i, failedCheck: result.failedCheck! })
    }
  }

  if (applicableScopes.length > 0) {
    return { allowed: true, applicableScopes }
  }

  return { allowed: false, details }
}

// =============================================================================
// EXPRESSION TREE SCOPE OPERATIONS
// =============================================================================

/**
 * Wrap an expression in a scope node.
 *
 * @param expr - The expression to wrap
 * @param scope - The scope to apply
 */
export function applyScope(expr: IdentityExpr, scope: Scope): IdentityExpr {
  return { kind: 'scope', scopes: [scope], expr }
}

/**
 * Wrap an expression in a scope node with multiple scopes.
 * Used by the auth layer to narrow delegated expressions.
 *
 * @param expr - The expression to narrow
 * @param scopes - Scopes to apply (OR'd together)
 */
export function applyTopLevelScopes(expr: IdentityExpr, scopes: Scope[]): IdentityExpr {
  if (scopes.length === 0) return expr
  return { kind: 'scope', scopes, expr }
}
