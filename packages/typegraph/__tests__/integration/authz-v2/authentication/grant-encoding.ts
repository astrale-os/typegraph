/**
 * AUTH_V2 Grant Encoding
 *
 * Kernel-only: used exclusively by the kernel when minting relay tokens.
 * Functions for encoding grants into JWT payloads.
 * Uses plain JSON encoding for MVP (readable, debuggable).
 */

import type {
  Grant,
  IdentityExpr,
  IdentityId,
  Scope,
  UnresolvedGrant,
  UnresolvedIdentityExpr,
} from '../types'

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
  verifyToken(jwt: string): Promise<VerifiedJwt>
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
