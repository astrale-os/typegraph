/**
 * AUTH_V2 Test Helpers
 *
 * Assertion helpers and factory functions for testing.
 */

import { expect } from 'vitest'
import type { AccessDecision, AccessExplanation, Grant, Scope, IdentityExpr } from '../types'

// =============================================================================
// ASSERTION HELPERS
// =============================================================================

export function expectGranted(result: AccessDecision | AccessExplanation): void {
  expect(result.granted).toBe(true)
  expect(result.deniedBy).toBeUndefined()
}

export function expectDeniedByType(result: AccessDecision | AccessExplanation): void {
  expect(result.granted).toBe(false)
  expect(result.deniedBy).toBe('type')
}

export function expectDeniedByResource(result: AccessDecision | AccessExplanation): void {
  expect(result.granted).toBe(false)
  expect(result.deniedBy).toBe('resource')
}

// =============================================================================
// EXPRESSION BUILDERS
// =============================================================================

/**
 * Create an identity expression leaf.
 * @param id - Identity ID
 * @param scopes - Optional scope(s). Can be a single Scope or array of Scopes.
 *                Empty array is treated as undefined (unrestricted).
 */
export function identity(id: string, scopes?: Scope | Scope[]): IdentityExpr {
  // Empty array or undefined = unrestricted (no scopes)
  if (!scopes || (Array.isArray(scopes) && scopes.length === 0)) {
    return { kind: 'identity', id }
  }
  const scopeArray = Array.isArray(scopes) ? scopes : [scopes]
  return { kind: 'identity', id, scopes: scopeArray }
}

/**
 * Create a union expression from multiple expressions.
 * Returns null query expression if no expressions provided.
 */
export function union(...exprs: IdentityExpr[]): IdentityExpr {
  if (exprs.length === 0) {
    // Empty union - will be filtered to null in Cypher
    return { kind: 'identity', id: '__EMPTY__', scopes: [{ principals: ['__NEVER_MATCH__'] }] }
  }
  if (exprs.length === 1) {
    return exprs[0]!
  }
  return exprs.reduce((acc, expr) => ({ kind: 'union', left: acc, right: expr }))
}

/**
 * Create an intersect expression from multiple expressions.
 */
export function intersect(...exprs: IdentityExpr[]): IdentityExpr {
  if (exprs.length === 0) {
    throw new Error('intersect requires at least one expression')
  }
  if (exprs.length === 1) {
    return exprs[0]!
  }
  return exprs.reduce((acc, expr) => ({ kind: 'intersect', left: acc, right: expr }))
}

/**
 * Create an exclude expression (base \ excluded).
 */
export function exclude(base: IdentityExpr, excluded: IdentityExpr): IdentityExpr {
  return { kind: 'exclude', left: base, right: excluded }
}

/**
 * Convenience: Create a union of identity leaves from IDs.
 * Applies same scopes to all identities.
 * @param ids - Array of identity IDs
 * @param scopes - Optional scope(s). Can be a single Scope or array of Scopes.
 */
export function identities(ids: string[], scopes?: Scope | Scope[]): IdentityExpr {
  if (ids.length === 0) {
    return union() // Empty expression
  }
  return union(...ids.map((id) => identity(id, scopes)))
}

// =============================================================================
// GRANT FACTORY
// =============================================================================

/**
 * Create a Grant from expressions.
 */
export function grant(forType: IdentityExpr, forResource: IdentityExpr): Grant {
  return { forType, forResource }
}

/**
 * Convenience: Create a Grant from ID arrays.
 * Optional scopes are applied to resource identities only (type check is unscoped).
 */
export function grantFromIds(
  typeIds: string[],
  resourceIds: string[],
  options?: { scopes?: Scope[] },
): Grant {
  return {
    forType: identities(typeIds),
    forResource: identities(resourceIds, options?.scopes),
  }
}

// =============================================================================
// SCOPE HELPERS
// =============================================================================

export function nodeScope(nodes: string[]): Scope {
  return { nodes }
}

export function permScope(perms: string[]): Scope {
  return { perms }
}

export function principalScope(principals: string[]): Scope {
  return { principals }
}

export function fullScope(nodes?: string[], perms?: string[], principals?: string[]): Scope {
  return { nodes, perms, principals }
}
