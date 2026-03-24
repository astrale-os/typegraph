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

import type { PayloadCodec } from '../expression/codec'
import type {
  IdentityExpr,
  IdentityId,
  Scope,
  UnresolvedIdentityExpr,
  UnresolvedGrant,
} from '../types'
import type { IdentityRegistry } from './identity-registry'

import { applyTopLevelScopes } from '../expression/scope'
import { type TokenVerifier, KERNEL_ISSUER } from './token-verifier'

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
   * - Scopes are preserved on scope nodes (not on identity leaves)
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
   * Apply top-level scopes to an expression.
   * Wraps the expression in a scope node.
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

      case 'scope': {
        const inner = await this.decodeExpr(expr.expr)
        return { kind: 'scope', scopes: expr.scopes, expr: inner }
      }

      case 'union': {
        const operands = await Promise.all(expr.operands.map((op) => this.decodeExpr(op)))
        return { kind: 'union', operands }
      }

      case 'intersect': {
        const operands = await Promise.all(expr.operands.map((op) => this.decodeExpr(op)))
        return { kind: 'intersect', operands }
      }

      case 'exclude': {
        const [base, ...excluded] = await Promise.all([
          this.decodeExpr(expr.base),
          ...expr.excluded.map((ex) => this.decodeExpr(ex)),
        ])
        return { kind: 'exclude', base: base!, excluded }
      }

      default:
        throw new Error(`Unknown expression kind: ${(expr as { kind: string }).kind}`)
    }
  }

  private async decodeIdentity(
    expr: { kind: 'identity'; jwt: string } | { kind: 'identity'; id: IdentityId },
  ): Promise<IdentityExpr> {
    if ('jwt' in expr) {
      return this.decodeJwtIdentity(expr.jwt)
    }

    // Plain ID - return as-is
    return { kind: 'identity', id: expr.id }
  }

  private async decodeJwtIdentity(jwt: string): Promise<IdentityExpr> {
    // Verify the JWT
    const { payload } = this.verifier.verifyToken(jwt)
    const identityId = this.registry.resolveIdentity(payload.iss, payload.sub)

    // If this is a kernel-issued token with a grant, extract and merge
    if (payload.iss === KERNEL_ISSUER && payload.grant?.forResource) {
      const inner = this.decodeField(payload.grant.forResource)

      // Recursively decode the inner expression
      return this.decodeExpr(inner)
    }

    // Regular JWT - create identity from decoded ID
    return { kind: 'identity', id: identityId }
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

    case 'scope':
      validateExpressionSecurity(expr.expr, verifier)
      break

    case 'union':
    case 'intersect':
      for (const op of expr.operands) {
        validateExpressionSecurity(op, verifier)
      }
      break

    case 'exclude':
      validateExpressionSecurity(expr.base, verifier)
      for (const ex of expr.excluded) {
        validateExpressionSecurity(ex, verifier)
      }
      break

    default:
      throw new Error(
        `Unknown expression kind in security validation: ${(expr as { kind: string }).kind}`,
      )
  }
}

/**
 * Extract the primary (leftmost/first) identity from an expression.
 * Used for the JWT 'sub' claim.
 */
export function extractPrimaryIdentity(expr: IdentityExpr): IdentityId {
  switch (expr.kind) {
    case 'identity':
      return expr.id
    case 'scope':
      return extractPrimaryIdentity(expr.expr)
    case 'union':
    case 'intersect':
      return extractPrimaryIdentity(expr.operands[0]!)
    case 'exclude':
      return extractPrimaryIdentity(expr.base)
    default:
      throw new Error(`Unknown expression kind: ${(expr as { kind: string }).kind}`)
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

  switch (e.kind) {
    case 'identity': {
      const hasJwt = 'jwt' in e && typeof e.jwt === 'string'
      const hasId = 'id' in e && typeof e.id === 'string'

      if (!hasJwt && !hasId) {
        throw new Error(`${path}: identity must have jwt or id`)
      }
      if (hasJwt && hasId) {
        throw new Error(`${path}: identity cannot have both jwt and id`)
      }
      break
    }

    case 'scope': {
      if (!Array.isArray(e.scopes) || e.scopes.length === 0) {
        throw new Error(`${path}: scope must have at least one scope`)
      }
      if (!('expr' in e)) {
        throw new Error(`${path}: scope must have expr`)
      }
      validateUnresolvedExpr(e.expr, `${path}.expr`)
      break
    }

    case 'union':
    case 'intersect': {
      if (!Array.isArray(e.operands) || e.operands.length < 2) {
        throw new Error(`${path}: ${e.kind} must have at least 2 operands`)
      }
      for (let i = 0; i < e.operands.length; i++) {
        validateUnresolvedExpr(e.operands[i], `${path}.operands[${i}]`)
      }
      break
    }

    case 'exclude': {
      if (!('base' in e)) {
        throw new Error(`${path}: exclude must have base`)
      }
      validateUnresolvedExpr(e.base, `${path}.base`)
      if (!Array.isArray(e.excluded) || e.excluded.length < 1) {
        throw new Error(`${path}: exclude must have at least 1 excluded operand`)
      }
      for (let i = 0; i < e.excluded.length; i++) {
        validateUnresolvedExpr(e.excluded[i], `${path}.excluded[${i}]`)
      }
      break
    }

    default:
      throw new Error(`${path}: invalid kind: ${e.kind}`)
  }
}
