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
// JWT VERIFICATION RESULT
// =============================================================================

/**
 * JWT verification result.
 */
export interface VerifiedJwt {
  sub: IdentityId
  iss: string
}

// =============================================================================
// UNRESOLVED EXPRESSION BUILDERS
// =============================================================================

/**
 * Create an unresolved identity leaf from a JWT token.
 */
export function unresolvedJwt(jwt: string): UnresolvedIdentityExpr {
  return { kind: 'identity', jwt }
}

/**
 * Create an unresolved identity leaf from a plain ID (kernel-issued only).
 */
export function unresolvedId(id: IdentityId): UnresolvedIdentityExpr {
  return { kind: 'identity', id }
}

/**
 * Create an unresolved scope wrapper.
 */
export function unresolvedScope(
  scopes: Scope[],
  expr: UnresolvedIdentityExpr,
): UnresolvedIdentityExpr {
  return { kind: 'scope', scopes, expr }
}

/**
 * Create an unresolved union expression.
 */
export function unresolvedUnion(
  ...operands: UnresolvedIdentityExpr[]
): UnresolvedIdentityExpr {
  return { kind: 'union', operands }
}

/**
 * Create an unresolved intersect expression.
 */
export function unresolvedIntersect(
  ...operands: UnresolvedIdentityExpr[]
): UnresolvedIdentityExpr {
  return { kind: 'intersect', operands }
}

/**
 * Create an unresolved exclude expression.
 */
export function unresolvedExclude(
  base: UnresolvedIdentityExpr,
  excl: UnresolvedIdentityExpr,
): UnresolvedIdentityExpr {
  return { kind: 'exclude', base, excluded: [excl] }
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
      return { kind: 'identity', id: expr.id }
    case 'scope':
      return { kind: 'scope', scopes: expr.scopes, expr: identityExprToUnresolved(expr.expr) }
    case 'union':
      return { kind: 'union', operands: expr.operands.map(identityExprToUnresolved) }
    case 'intersect':
      return { kind: 'intersect', operands: expr.operands.map(identityExprToUnresolved) }
    case 'exclude':
      return {
        kind: 'exclude',
        base: identityExprToUnresolved(expr.base),
        excluded: expr.excluded.map(identityExprToUnresolved),
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
