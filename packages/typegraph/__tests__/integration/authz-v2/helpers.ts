/**
 * AUTH_V2 Test Helpers
 *
 * Assertion helpers and factory functions for testing.
 */

import { expect } from 'vitest'
import type { AccessDecision, AccessExplanation, Subject, Scope, IdentityExpr } from './types'

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

export function expectDeniedByTarget(result: AccessDecision | AccessExplanation): void {
  expect(result.granted).toBe(false)
  expect(result.deniedBy).toBe('target')
}

// =============================================================================
// EXPRESSION BUILDERS
// =============================================================================

/**
 * Create an identity expression leaf.
 */
export function identity(id: string, scopes?: Scope[]): IdentityExpr {
  return scopes ? { kind: 'identity', id, scopes } : { kind: 'identity', id }
}

/**
 * Create a union expression from multiple expressions.
 * Returns 'false' expression if no expressions provided.
 */
export function union(...exprs: IdentityExpr[]): IdentityExpr {
  if (exprs.length === 0) {
    // Empty union - will be filtered to 'false' in Cypher
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
 */
export function identities(ids: string[], scopes?: Scope[]): IdentityExpr {
  if (ids.length === 0) {
    return union() // Empty expression
  }
  return union(...ids.map((id) => identity(id, scopes)))
}

// =============================================================================
// SUBJECT FACTORY
// =============================================================================

/**
 * Create a Subject from expressions.
 */
export function subject(forType: IdentityExpr, forTarget: IdentityExpr): Subject {
  return { forType, forTarget }
}

/**
 * Convenience: Create a Subject from ID arrays.
 * Optional scopes are applied to target identities only (type check is unscoped).
 */
export function subjectFromIds(
  typeIds: string[],
  targetIds: string[],
  options?: { scopes?: Scope[] },
): Subject {
  return {
    forType: identities(typeIds),
    forTarget: identities(targetIds, options?.scopes),
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
