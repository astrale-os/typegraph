/**
 * AUTH_V2 Grant Resolver
 *
 * Single source of truth for resolving UnresolvedIdentityExpr → IdentityExpr.
 * Handles JWT verification, scope intersection, and security constraints.
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
// RESOLVED TYPES
// =============================================================================

/**
 * Fully resolved grant with plain IDs and accumulated scopes.
 */
export interface ResolvedGrant {
  forType: IdentityExpr
  forResource: IdentityExpr
}

// =============================================================================
// GRANT RESOLVER
// =============================================================================

export class GrantResolver {
  constructor(
    private verifier: TokenVerifier,
    private registry: IdentityRegistry,
    private codec?: PayloadCodec,
  ) {}

  /**
   * Resolve an encoded identity expression to a fully resolved IdentityExpr.
   *
   * - JWTs are verified and resolved to plain IDs
   * - Kernel-issued tokens have their inner grants extracted
   * - Scopes are properly intersected (not concatenated)
   * - Expression structure is preserved
   */
  async resolve(expr: UnresolvedIdentityExpr): Promise<IdentityExpr> {
    return this.resolveExpr(expr)
  }

  /**
   * Resolve an encoded grant to a fully resolved grant.
   * Applies defaults (principal) for missing forType/forResource.
   */
  async resolveGrant(
    grant: UnresolvedGrant | undefined,
    principal: IdentityId,
  ): Promise<ResolvedGrant> {
    const defaultExpr: IdentityExpr = { kind: 'identity', id: principal }

    if (!grant) {
      return { forType: defaultExpr, forResource: defaultExpr }
    }

    if (grant.v !== 1) {
      throw new Error(`Unsupported grant version: ${grant.v}`)
    }

    const [forType, forResource] = await Promise.all([
      grant.forType ? this.resolve(this.decodeField(grant.forType)) : defaultExpr,
      grant.forResource ? this.resolve(this.decodeField(grant.forResource)) : defaultExpr,
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

  private async resolveExpr(expr: UnresolvedIdentityExpr): Promise<IdentityExpr> {
    switch (expr.kind) {
      case 'identity':
        return this.resolveIdentity(expr)

      case 'union':
      case 'intersect':
      case 'exclude': {
        const [left, right] = await Promise.all([
          this.resolveExpr(expr.left),
          this.resolveExpr(expr.right),
        ])
        return { kind: expr.kind, left, right }
      }
    }
  }

  private async resolveIdentity(
    expr:
      | { kind: 'identity'; jwt: string; scopes?: Scope[] }
      | { kind: 'identity'; id: IdentityId; scopes?: Scope[] },
  ): Promise<IdentityExpr> {
    if ('jwt' in expr) {
      return this.resolveJwtIdentity(expr.jwt, expr.scopes)
    }

    // Plain ID - return as-is
    return expr.scopes
      ? { kind: 'identity', id: expr.id, scopes: expr.scopes }
      : { kind: 'identity', id: expr.id }
  }

  private async resolveJwtIdentity(jwt: string, leafScopes?: Scope[]): Promise<IdentityExpr> {
    // Verify the JWT
    const { payload } = this.verifier.verify(jwt)
    const identityId = this.registry.resolveOrThrow(payload.iss, payload.sub)

    // If this is a kernel-issued token with a grant, extract and merge
    if (payload.iss === KERNEL_ISSUER && payload.grant?.forResource) {
      const inner = this.decodeField(payload.grant.forResource)

      // Recursively resolve the inner expression
      const resolvedInner = await this.resolveExpr(inner)

      // Apply leaf scopes via intersection (not concatenation)
      if (leafScopes && leafScopes.length > 0) {
        return applyTopLevelScopes(resolvedInner, leafScopes)
      }

      return resolvedInner
    }

    // Regular JWT - create identity from resolved ID
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
export function validateGrantSecurity(
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
