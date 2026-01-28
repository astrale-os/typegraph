/**
 * AUTH_V2 Scope Utilities
 *
 * Proper scope intersection logic.
 * Scopes can only be made MORE restrictive, never less.
 */

import type { IdentityExpr, Scope, IdentityId, PermissionT, NodeId, FilterDetail } from '../types'

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

  // Empty result = nothing allowed (distinct from undefined = unrestricted)
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
    p: scope.perms ? [...scope.perms].sort() : null,
    r: scope.principals ? [...scope.principals].sort() : null,
  })
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

// =============================================================================
// RICH SCOPE CHECKS (extracted from access-checker)
// =============================================================================

/**
 * Check if a single scope allows the given principal and perm.
 * Rich version that returns the failed check reason.
 */
export function scopePasses(
  scope: Scope,
  principal: IdentityId | undefined,
  perm: PermissionT,
): { passes: boolean; failedCheck?: 'principal' | 'perm' } {
  if (scope.principals?.length && (!principal || !scope.principals.includes(principal))) {
    return { passes: false, failedCheck: 'principal' }
  }
  if (scope.perms?.length && !scope.perms.includes(perm)) {
    return { passes: false, failedCheck: 'perm' }
  }
  return { passes: true }
}

/**
 * Check which scopes allow the given principal and perm.
 * Returns applicable scopes (those that pass principal/perm checks) for node restriction tracking.
 */
export function filterApplicableScopes(
  scopes: Scope[] | undefined,
  principal: IdentityId | undefined,
  perm: PermissionT,
): { allowed: boolean; applicableScopes: Scope[] } {
  if (!scopes?.length) {
    return { allowed: true, applicableScopes: [] }
  }

  const applicableScopes = scopes.filter((scope) => scopePasses(scope, principal, perm).passes)

  return {
    allowed: applicableScopes.length > 0,
    applicableScopes,
  }
}

/**
 * Check scope filter for cold path (returns FilterDetail[]).
 */
export function checkFilter(
  scopes: Scope[] | undefined,
  principal: IdentityId | undefined,
  perm: PermissionT,
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
 * Add a scope to all identity leaves in an expression tree.
 *
 * @param expr - The expression to walk
 * @param scope - The scope to append to each leaf
 *
 * @example
 * ```typescript
 * const expanded = await evaluator.evalExpr(identity("USER1"))
 * const scoped = applyScope(expanded, { nodes: ["workspace-1"] })
 * ```
 */
export function applyScope(expr: IdentityExpr, scope: Scope): IdentityExpr {
  switch (expr.kind) {
    case 'identity':
      return {
        ...expr,
        scopes: expr.scopes ? [...expr.scopes, scope] : [scope],
      }
    case 'union':
    case 'intersect':
    case 'exclude':
      return {
        kind: expr.kind,
        left: applyScope(expr.left, scope),
        right: applyScope(expr.right, scope),
      }
  }
}

/**
 * Apply top-level scopes to all leaves via proper intersection.
 * Used by the auth layer to narrow delegated expressions.
 *
 * @param expr - The expression to narrow
 * @param scopes - Scopes to intersect onto each leaf
 */
export function applyTopLevelScopes(expr: IdentityExpr, scopes: Scope[]): IdentityExpr {
  if (scopes.length === 0) return expr

  switch (expr.kind) {
    case 'identity': {
      const newScopes = expr.scopes ? intersectScopes(expr.scopes, scopes) : scopes
      // IMPORTANT: Keep empty array (means "no valid scopes" = deny).
      // Only use undefined for "unrestricted". Empty array after intersection = impossible.
      return {
        kind: 'identity',
        id: expr.id,
        scopes: newScopes,
      }
    }
    case 'union':
    case 'intersect':
    case 'exclude':
      return {
        kind: expr.kind,
        left: applyTopLevelScopes(expr.left, scopes),
        right: applyTopLevelScopes(expr.right, scopes),
      }
  }
}
