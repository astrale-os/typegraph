/**
 * AUTH_V2 Scope Utilities
 *
 * Proper scope intersection logic.
 * Scopes can only be made MORE restrictive, never less.
 */

import type { Scope, IdentityId, PermissionT, NodeId } from './types'

// =============================================================================
// SCOPE INTERSECTION
// =============================================================================

/**
 * Intersect two arrays, returning elements present in both.
 * undefined means "unrestricted" - the other array wins.
 * Empty array means "nothing allowed".
 */
function intersectArrays<T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined {
  // Both undefined = unrestricted
  if (a === undefined && b === undefined) {
    return undefined
  }

  // One undefined = use the other (more restrictive)
  if (a === undefined) return b
  if (b === undefined) return a

  // Both defined = intersection
  const setB = new Set(b)
  const result = a.filter((x) => setB.has(x))

  // Return undefined if result would be empty (means "nothing allowed" which is different from "unrestricted")
  // Actually, empty array means nothing is allowed, which is valid
  return result
}

/**
 * Intersect two individual scopes.
 * Returns the most restrictive combination of both.
 *
 * Each dimension (nodes, perms, principals) is intersected:
 * - undefined = unrestricted (anything passes)
 * - [] = nothing allowed
 * - [...values] = only these values allowed
 *
 * Returns null if the intersection is impossible (would allow nothing).
 */
export function intersectScope(a: Scope, b: Scope): Scope | null {
  const nodes = intersectArrays(a.nodes, b.nodes)
  const perms = intersectArrays(a.perms, b.perms)
  const principals = intersectArrays(a.principals, b.principals)

  // If any dimension is an empty array (not undefined), the scope allows nothing
  if (nodes?.length === 0 || perms?.length === 0 || principals?.length === 0) {
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

  // Compute pairwise intersections
  const results: Scope[] = []

  for (const scopeA of a) {
    for (const scopeB of b) {
      const intersection = intersectScope(scopeA, scopeB)
      if (intersection !== null) {
        results.push(intersection)
      }
    }
  }

  // Deduplicate identical scopes
  return deduplicateScopes(results)
}

/**
 * Remove duplicate scopes from an array.
 */
function deduplicateScopes(scopes: Scope[]): Scope[] {
  const seen = new Set<string>()
  const result: Scope[] = []

  for (const scope of scopes) {
    const key = scopeToKey(scope)
    if (!seen.has(key)) {
      seen.add(key)
      result.push(scope)
    }
  }

  return result
}

/**
 * Create a deterministic string key for a scope (for deduplication).
 */
function scopeToKey(scope: Scope): string {
  const nodes = scope.nodes ? [...scope.nodes].sort().join(',') : ''
  const perms = scope.perms ? [...scope.perms].sort().join(',') : ''
  const principals = scope.principals ? [...scope.principals].sort().join(',') : ''
  return `n:${nodes}|p:${perms}|pr:${principals}`
}

// =============================================================================
// SCOPE VALIDATION
// =============================================================================

/**
 * Check if a scope allows a specific permission.
 */
export function scopeAllowsPerm(scope: Scope, perm: PermissionT): boolean {
  if (scope.perms === undefined) return true // unrestricted
  return scope.perms.includes(perm)
}

/**
 * Check if a scope allows a specific node.
 */
export function scopeAllowsNode(scope: Scope, node: NodeId): boolean {
  if (scope.nodes === undefined) return true // unrestricted
  return scope.nodes.includes(node)
}

/**
 * Check if a scope allows a specific principal.
 */
export function scopeAllowsPrincipal(scope: Scope, principal: IdentityId): boolean {
  if (scope.principals === undefined) return true // unrestricted
  return scope.principals.includes(principal)
}

/**
 * Check if any scope in the array allows the given parameters.
 * Scopes are OR'd - any passing scope = allowed.
 *
 * IMPORTANT semantic distinction:
 * - undefined = unrestricted (no scope restrictions)
 * - [] (empty array) = no valid scopes = deny all
 */
export function scopesAllow(
  scopes: Scope[] | undefined,
  params: { node?: NodeId; perm?: PermissionT; principal?: IdentityId },
): boolean {
  // undefined = unrestricted
  if (scopes === undefined) {
    return true
  }

  // Empty array = no valid scopes = deny (not unrestricted!)
  // This happens after intersection produces no valid combinations
  if (scopes.length === 0) {
    return false
  }

  // Any scope passing = allowed
  return scopes.some((scope) => {
    if (params.node !== undefined && !scopeAllowsNode(scope, params.node)) return false
    if (params.perm !== undefined && !scopeAllowsPerm(scope, params.perm)) return false
    if (params.principal !== undefined && !scopeAllowsPrincipal(scope, params.principal))
      return false
    return true
  })
}
