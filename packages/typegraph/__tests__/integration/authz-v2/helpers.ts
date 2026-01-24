/**
 * AUTH_V2 Test Helpers
 *
 * Common assertion helpers and test utilities.
 */

import { expect } from 'vitest'
import type { AccessResult, IdentityInput, Scope } from './types'

// =============================================================================
// ASSERTION HELPERS
// =============================================================================

export function expectGranted(result: AccessResult): void {
  expect(result.granted).toBe(true)
  expect(result.reason).toBeUndefined()
}

export function expectDeniedByType(result: AccessResult): void {
  expect(result.granted).toBe(false)
  expect(result.reason).toBe('type')
}

export function expectDeniedByTarget(result: AccessResult): void {
  expect(result.granted).toBe(false)
  expect(result.reason).toBe('target')
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

export function identity(identityId: string, scopes?: Scope[]): IdentityInput {
  return { identityId, scopes }
}

export function nodeScope(nodes: string[]): Scope {
  return { nodes }
}

export function permScope(perms: string[]): Scope {
  return { perms }
}

export function fullScope(nodes: string[], perms: string[]): Scope {
  return { nodes, perms }
}

// =============================================================================
// COMMON TEST SCENARIOS
// =============================================================================

/**
 * Create identity with node scope restriction.
 */
export function identityWithNodeScope(identityId: string, nodes: string[]): IdentityInput {
  return { identityId, scopes: [{ nodes }] }
}

/**
 * Create identity with permission scope restriction.
 */
export function identityWithPermScope(identityId: string, perms: string[]): IdentityInput {
  return { identityId, scopes: [{ perms }] }
}

/**
 * Create identity with multiple scopes (OR'd together).
 */
export function identityWithScopes(identityId: string, scopes: Scope[]): IdentityInput {
  return { identityId, scopes }
}
