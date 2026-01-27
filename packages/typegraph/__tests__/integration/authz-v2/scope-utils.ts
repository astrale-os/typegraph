/**
 * Scope Utilities
 *
 * Pure functions for scope checking, extracted for testability.
 * Used by CypherGenerator to filter identity leaves by principal and permission.
 */

import type { Scope } from './types'

/**
 * Check if a single scope allows a given principal and permission.
 *
 * Rules:
 * - undefined or empty array = unrestricted (allows all)
 * - non-empty array = must include the value
 *
 * All dimensions (principals, perms) must pass for the scope to allow.
 */
export function scopeAllows(scope: Scope, principal: string | undefined, perm: string): boolean {
  // Check principals: empty/undefined = unrestricted
  const principalOk =
    !scope.principals?.length || (principal !== undefined && scope.principals.includes(principal))

  // Check perms: empty/undefined = unrestricted
  const permOk = !scope.perms?.length || scope.perms.includes(perm)

  return principalOk && permOk
}

/**
 * Check if any scope in the array allows principal+perm (OR semantics).
 * Returns both the boolean result and the list of applicable scopes.
 *
 * - No scopes or empty array = unrestricted (returns allowed:true, applicableScopes:[])
 * - Scopes present = returns allowed:true if ANY scope allows, with filtered list
 */
export function anyScopeAllows(
  scopes: Scope[] | undefined,
  principal: string | undefined,
  perm: string,
): { allowed: boolean; applicableScopes: Scope[] } {
  // No scopes = unrestricted
  if (!scopes?.length) {
    return { allowed: true, applicableScopes: [] }
  }

  // Filter to scopes that allow this principal+perm
  const applicableScopes = scopes.filter((s) => scopeAllows(s, principal, perm))

  return {
    allowed: applicableScopes.length > 0,
    applicableScopes,
  }
}
