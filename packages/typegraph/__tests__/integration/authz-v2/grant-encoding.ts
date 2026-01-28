/**
 * AUTH_V2 Grant Encoding
 *
 * Functions for encoding/decoding grants for JWT payloads.
 * Uses plain JSON encoding for MVP (readable, debuggable).
 */

import type {
  Grant,
  IdentityExpr,
  IdentityId,
  Scope,
  UnresolvedGrant,
  UnresolvedIdentityExpr,
} from './types'

// =============================================================================
// JWT VERIFIER INTERFACE
// =============================================================================

/**
 * JWT verification result.
 */
export interface VerifiedJwt {
  sub: IdentityId
  iss: string
}

/**
 * JWT verifier interface.
 * Kernel implements this to verify tokens.
 */
export interface JwtVerifier {
  verify(jwt: string): Promise<VerifiedJwt>
}

// =============================================================================
// UNRESOLVED EXPRESSION BUILDERS
// =============================================================================

/**
 * Create an unresolved identity leaf from a JWT token.
 */
export function unresolvedJwt(jwt: string, scopes?: Scope[]): UnresolvedIdentityExpr {
  return scopes ? { kind: 'identity', jwt, scopes } : { kind: 'identity', jwt }
}

/**
 * Create an unresolved identity leaf from a plain ID (kernel-issued only).
 */
export function unresolvedId(id: IdentityId, scopes?: Scope[]): UnresolvedIdentityExpr {
  return scopes ? { kind: 'identity', id, scopes } : { kind: 'identity', id }
}

/**
 * Create an unresolved union expression.
 */
export function unresolvedUnion(
  left: UnresolvedIdentityExpr,
  right: UnresolvedIdentityExpr,
): UnresolvedIdentityExpr {
  return { kind: 'union', left, right }
}

/**
 * Create an unresolved intersect expression.
 */
export function unresolvedIntersect(
  left: UnresolvedIdentityExpr,
  right: UnresolvedIdentityExpr,
): UnresolvedIdentityExpr {
  return { kind: 'intersect', left, right }
}

/**
 * Create an unresolved exclude expression.
 */
export function unresolvedExclude(
  left: UnresolvedIdentityExpr,
  right: UnresolvedIdentityExpr,
): UnresolvedIdentityExpr {
  return { kind: 'exclude', left, right }
}

// =============================================================================
// ENCODING (GRANT → UNRESOLVED GRANT)
// =============================================================================

/**
 * Convert a resolved IdentityExpr to UnresolvedIdentityExpr.
 * This is used when re-encoding a resolved grant (all leaves have IDs).
 */
export function identityExprToUnresolved(expr: IdentityExpr): UnresolvedIdentityExpr {
  switch (expr.kind) {
    case 'identity':
      return expr.scopes
        ? { kind: 'identity', id: expr.id, scopes: expr.scopes }
        : { kind: 'identity', id: expr.id }

    case 'union':
    case 'intersect':
    case 'exclude':
      return {
        kind: expr.kind,
        left: identityExprToUnresolved(expr.left),
        right: identityExprToUnresolved(expr.right),
      }
  }
}

/**
 * Encode a Grant into an UnresolvedGrant for JWT payload.
 *
 * Note: This produces an UnresolvedGrant with plain IDs (not JWTs).
 * Suitable for kernel-issued tokens where IDs are trusted.
 */
export function encodeGrant(grant: Grant): UnresolvedGrant {
  return {
    v: 1,
    forType: identityExprToUnresolved(grant.forType),
    forResource: identityExprToUnresolved(grant.forResource),
  }
}

/**
 * Create an UnresolvedGrant from unresolved expressions.
 * Use this when building grants with JWT tokens.
 */
export function createUnresolvedGrant(
  forType?: UnresolvedIdentityExpr,
  forResource?: UnresolvedIdentityExpr,
): UnresolvedGrant {
  const grant: UnresolvedGrant = { v: 1 }
  if (forType) grant.forType = forType
  if (forResource) grant.forResource = forResource
  return grant
}

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

// Re-export utilities from canonical locations
export { intersectScopes } from './scope-utils'
export { applyTopLevelScopes, extractPrimaryIdentity } from './expression-resolver'

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
