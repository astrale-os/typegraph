/**
 * AUTH_V2 Grant Decoding
 *
 * Functions for decoding and validating grants from JWT payloads.
 * Used at authentication time to resolve incoming grants.
 */

import type {
  Grant,
  IdentityExpr,
  IdentityId,
  UnresolvedGrant,
  UnresolvedIdentityExpr,
} from '../types'
import type { JwtVerifier } from './grant-encoding'

// Re-export utilities from canonical locations
export { intersectScopes, applyTopLevelScopes } from '../expression/scope'
export { extractPrimaryIdentity } from './grant-resolver'

// =============================================================================
// DECODING (UNRESOLVED GRANT → GRANT)
// =============================================================================

/**
 * Resolve an UnresolvedIdentityExpr to IdentityExpr.
 * Verifies JWTs and extracts identity IDs, preserving structure.
 */
export async function resolveExpression(
  expr: UnresolvedIdentityExpr,
  verifier: JwtVerifier,
): Promise<IdentityExpr> {
  switch (expr.kind) {
    case 'identity':
      if ('jwt' in expr) {
        // Verify JWT and extract identity
        const verified = await verifier.verify(expr.jwt)
        return expr.scopes
          ? { kind: 'identity', id: verified.sub, scopes: expr.scopes }
          : { kind: 'identity', id: verified.sub }
      }
      // Already has plain ID (kernel-issued)
      return expr.scopes
        ? { kind: 'identity', id: expr.id, scopes: expr.scopes }
        : { kind: 'identity', id: expr.id }

    case 'union':
    case 'intersect':
    case 'exclude': {
      // Resolve both branches in parallel
      const [left, right] = await Promise.all([
        resolveExpression(expr.left, verifier),
        resolveExpression(expr.right, verifier),
      ])
      return { kind: expr.kind, left, right }
    }
  }
}

/**
 * Decode an UnresolvedGrant into a Grant.
 * Verifies JWTs and resolves identity IDs.
 *
 * @param encoded - The unresolved grant from JWT payload
 * @param verifier - JWT verifier implementation
 * @param principal - Identity to use as default for missing forType/forResource
 */
export async function decodeGrant(
  encoded: UnresolvedGrant,
  verifier: JwtVerifier,
  principal: IdentityId,
): Promise<Grant> {
  // Validate version
  if (encoded.v !== 1) {
    throw new Error(`Unsupported grant version: ${encoded.v}`)
  }

  // Default expressions use principal identity
  const defaultExpr: IdentityExpr = { kind: 'identity', id: principal }

  // Resolve forType (default to principal if undefined)
  const forType = encoded.forType ? await resolveExpression(encoded.forType, verifier) : defaultExpr

  // Resolve forResource (default to principal if undefined)
  const forResource = encoded.forResource
    ? await resolveExpression(encoded.forResource, verifier)
    : defaultExpr

  return { forType, forResource }
}

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate an UnresolvedGrant structure.
 * Throws if invalid.
 */
export function validateUnresolvedGrant(grant: unknown): asserts grant is UnresolvedGrant {
  if (typeof grant !== 'object' || grant === null) {
    throw new Error('Grant must be an object')
  }

  const g = grant as Record<string, unknown>

  if (g.v !== 1) {
    throw new Error(`Unsupported grant version: ${g.v}`)
  }

  if (g.forType !== undefined) {
    validateUnresolvedExpr(g.forType, 'forType')
  }

  if (g.forResource !== undefined) {
    validateUnresolvedExpr(g.forResource, 'forResource')
  }
}

/**
 * Validate an UnresolvedIdentityExpr structure.
 * Throws if invalid.
 */
export function validateUnresolvedExpr(
  expr: unknown,
  path: string,
): asserts expr is UnresolvedIdentityExpr {
  if (typeof expr !== 'object' || expr === null) {
    throw new Error(`${path}: expression must be an object`)
  }

  const e = expr as Record<string, unknown>

  if (e.kind === 'identity') {
    const hasJwt = 'jwt' in e && typeof e.jwt === 'string'
    const hasId = 'id' in e && typeof e.id === 'string'

    if (!hasJwt && !hasId) {
      throw new Error(`${path}: identity must have jwt or id`)
    }
    if (hasJwt && hasId) {
      throw new Error(`${path}: identity cannot have both jwt and id`)
    }

    if (e.scopes !== undefined) {
      if (!Array.isArray(e.scopes)) {
        throw new Error(`${path}.scopes: must be an array`)
      }
      // Could add more scope validation here
    }
  } else if (e.kind === 'union' || e.kind === 'intersect' || e.kind === 'exclude') {
    if (!('left' in e)) {
      throw new Error(`${path}: ${e.kind} must have left`)
    }
    if (!('right' in e)) {
      throw new Error(`${path}: ${e.kind} must have right`)
    }
    validateUnresolvedExpr(e.left, `${path}.left`)
    validateUnresolvedExpr(e.right, `${path}.right`)
  } else {
    throw new Error(`${path}: invalid kind: ${e.kind}`)
  }
}
