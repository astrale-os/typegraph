/**
 * AUTH_V2 Grant Decoder
 *
 * Single source of truth for decoding UnresolvedIdentityExpr → IdentityExpr.
 * Handles JWT verification, scope intersection, and security constraints.
 *
 * Semantic distinction:
 * - "decode" = Parse/verify JWT, extract plain IDs (no DB access)
 * - "resolve" = Full identity composition expansion via DB queries (what evalExpr does)
 */

import type {
  IdentityExpr,
  IdentityId,
  Scope,
  UnresolvedIdentityExpr,
  UnresolvedGrant,
} from '../types'
import { type TokenVerifier, KERNEL_ISSUER } from './token-verifier'
import type { IdentityRegistry } from './identity-registry'
import { applyTopLevelScopes } from '../expression/scope'
import type { PayloadCodec } from '../expression/codec'

// =============================================================================
// DECODED TYPES
// =============================================================================

/**
 * Fully decoded grant with plain IDs and accumulated scopes.
 * "Decoded" means JWTs have been verified and extracted to plain IDs,
 * but identity compositions have NOT been expanded from the DB.
 */
export interface DecodedGrant {
  forType: IdentityExpr
  forResource: IdentityExpr
}

// =============================================================================
// GRANT DECODER
// =============================================================================

export class GrantDecoder {
  constructor(
    private verifier: TokenVerifier,
    private registry: IdentityRegistry,
    private codec?: PayloadCodec,
  ) {}

  /**
   * Decode an encoded identity expression to an IdentityExpr with plain IDs.
   *
   * - JWTs are verified and decoded to plain IDs
   * - Kernel-issued tokens have their inner grants extracted
   * - Scopes are properly intersected (not concatenated)
   * - Expression structure is preserved
   *
   * Note: This does NOT expand identity compositions from the DB.
   * For full resolution including DB composition expansion, use evalExpr().
   */
  async decode(expr: UnresolvedIdentityExpr): Promise<IdentityExpr> {
    return this.decodeExpr(expr)
  }

  /**
   * Decode an encoded grant to a grant with plain IDs.
   * Validates structure, then applies defaults for missing forType/forResource.
   */
  async decodeGrant(
    grant: UnresolvedGrant | undefined,
    principal: IdentityId,
  ): Promise<DecodedGrant> {
    const defaultExpr: IdentityExpr = { kind: 'identity', id: principal }

    if (!grant) {
      return { forType: defaultExpr, forResource: defaultExpr }
    }

    // Validate structure at the boundary
    validateUnresolvedGrant(grant)

    const [forType, forResource] = await Promise.all([
      grant.forType ? this.decode(this.decodeField(grant.forType)) : defaultExpr,
      grant.forResource ? this.decode(this.decodeField(grant.forResource)) : defaultExpr,
    ])

    return { forType, forResource }
  }

  /**
   * Apply top-level scopes to all leaves in an expression.
   * Uses proper intersection, not concatenation.
   */
  applyScopes(expr: IdentityExpr, scopes: Scope[]): IdentityExpr {
    return applyTopLevelScopes(expr, scopes)
  }

  // ===========================================================================
  // PRIVATE METHODS
  // ===========================================================================

  /**
   * Decode a grant field through the codec if present.
   * When encoding is 'compact' or 'binary', the field is encoded;
   * codec decodes it back to a resolved IdentityExpr which is
   * structurally compatible with UnresolvedIdentityExpr (plain IDs).
   */
  private decodeField(raw: unknown): UnresolvedIdentityExpr {
    if (this.codec) {
      return this.codec.decodeExpr(raw) as UnresolvedIdentityExpr
    }
    return raw as UnresolvedIdentityExpr
  }

  private async decodeExpr(expr: UnresolvedIdentityExpr): Promise<IdentityExpr> {
    switch (expr.kind) {
      case 'identity':
        return this.decodeIdentity(expr)

      case 'union':
      case 'intersect':
      case 'exclude': {
        const [left, right] = await Promise.all([
          this.decodeExpr(expr.left),
          this.decodeExpr(expr.right),
        ])
        return { kind: expr.kind, left, right }
      }
    }
  }

  private async decodeIdentity(
    expr:
      | { kind: 'identity'; jwt: string; scopes?: Scope[] }
      | { kind: 'identity'; id: IdentityId; scopes?: Scope[] },
  ): Promise<IdentityExpr> {
    if ('jwt' in expr) {
      return this.decodeJwtIdentity(expr.jwt, expr.scopes)
    }

    // Plain ID - return as-is
    return expr.scopes
      ? { kind: 'identity', id: expr.id, scopes: expr.scopes }
      : { kind: 'identity', id: expr.id }
  }

  private async decodeJwtIdentity(jwt: string, leafScopes?: Scope[]): Promise<IdentityExpr> {
    // Verify the JWT
    const { payload } = this.verifier.verifyToken(jwt)
    const identityId = this.registry.resolveIdentity(payload.iss, payload.sub)

    // If this is a kernel-issued token with a grant, extract and merge
    if (payload.iss === KERNEL_ISSUER && payload.grant?.forResource) {
      const inner = this.decodeField(payload.grant.forResource)

      // Recursively decode the inner expression
      const decodedInner = await this.decodeExpr(inner)

      // Apply leaf scopes via intersection (not concatenation)
      if (leafScopes && leafScopes.length > 0) {
        return applyTopLevelScopes(decodedInner, leafScopes)
      }

      return decodedInner
    }

    // Regular JWT - create identity from decoded ID
    return leafScopes
      ? { kind: 'identity', id: identityId, scopes: leafScopes }
      : { kind: 'identity', id: identityId }
  }
}

// =============================================================================
// SECURITY VALIDATION
// =============================================================================

/**
 * Validate that external apps only embed kernel-signed tokens.
 *
 * CRITICAL SECURITY CHECK:
 * If the JWT issuer is NOT the kernel, any embedded JWTs in the grant
 * MUST be kernel-signed. External apps cannot embed raw IdP tokens.
 */
export function validateGrant(
  issuer: string,
  grant: UnresolvedGrant | undefined,
  verifier: TokenVerifier,
): void {
  // Kernel-issued tokens can embed anything (they're already trusted)
  if (issuer === KERNEL_ISSUER) {
    return
  }

  // External app - validate embedded tokens
  if (grant?.forType) {
    validateExpressionSecurity(grant.forType, verifier)
  }
  if (grant?.forResource) {
    validateExpressionSecurity(grant.forResource, verifier)
  }
}

/**
 * Recursively validate that all embedded JWTs are kernel-signed.
 */
function validateExpressionSecurity(expr: UnresolvedIdentityExpr, verifier: TokenVerifier): void {
  switch (expr.kind) {
    case 'identity':
      if ('jwt' in expr) {
        // This JWT MUST be kernel-signed
        verifier.verifyKernelIssued(expr.jwt)
      }
      break

    case 'union':
    case 'intersect':
    case 'exclude':
      validateExpressionSecurity(expr.left, verifier)
      validateExpressionSecurity(expr.right, verifier)
      break
  }
}

/**
 * Extract the primary (leftmost) identity from an expression.
 * Used for the JWT 'sub' claim.
 */
export function extractPrimaryIdentity(expr: IdentityExpr): IdentityId {
  switch (expr.kind) {
    case 'identity':
      return expr.id
    case 'union':
    case 'intersect':
    case 'exclude':
      return extractPrimaryIdentity(expr.left)
  }
}

// =============================================================================
// STRUCTURAL VALIDATION
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
