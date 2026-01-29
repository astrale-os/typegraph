/**
 * AUTH_V2 Grant Encoding/Decoding Barrel Export
 *
 * Re-exports encoding/decoding utilities from their canonical locations.
 * This file exists for backward compatibility with tests.
 */

// From authentication/grant-encoding.ts
export {
  type VerifiedJwt,
  unresolvedJwt,
  unresolvedId,
  unresolvedUnion,
  unresolvedIntersect,
  unresolvedExclude,
  identityExprToUnresolved,
  encodeGrant,
  createUnresolvedGrant,
} from './authentication/grant-encoding'
import type { VerifiedJwt } from './authentication/grant-encoding'

/**
 * JWT verifier interface for tests.
 * Uses `verify` method name for backward compatibility with existing tests.
 */
export interface JwtVerifier {
  verify(jwt: string): Promise<VerifiedJwt>
}

// From authentication/grant-decoder.ts
export {
  extractPrimaryIdentity,
  validateUnresolvedGrant,
  validateUnresolvedExpr,
} from './authentication/grant-decoder'

// From expression/scope.ts
export { intersectScopes, applyTopLevelScopes } from './expression/scope'

// =============================================================================
// DECODING FUNCTIONS (re-implemented for test compatibility)
// =============================================================================

import type {
  Grant,
  IdentityExpr,
  IdentityId,
  UnresolvedGrant,
  UnresolvedIdentityExpr,
} from './types'

/**
 * Decode an UnresolvedIdentityExpr to IdentityExpr.
 * Verifies JWTs and extracts identity IDs, preserving structure.
 *
 * @deprecated Use GrantDecoder.decode() for production code.
 * This function is kept for test compatibility.
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
 * @deprecated Use GrantDecoder.decodeGrant() for production code.
 * This function is kept for test compatibility.
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
