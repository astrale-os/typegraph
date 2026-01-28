/**
 * AUTH_V2 Token Verification
 *
 * Mock implementation of JWT verification with issuer key lookup.
 * Single source of truth for token verification logic.
 */

import type { IdentityId, UnresolvedGrant, UnresolvedIdentityExpr } from '../types'

// =============================================================================
// TYPES
// =============================================================================

export interface TokenPayload {
  iss: string
  sub: string
  aud: string
  iat: number
  exp: number
  grant?: UnresolvedGrant
}

// Type aliases for backward compatibility
// Encoded* = Unresolved* (same concept: expression before kernel resolution)
export type EncodedGrant = UnresolvedGrant
export type EncodedIdentityExpr = UnresolvedIdentityExpr

// =============================================================================
// CONSTANTS
// =============================================================================

export const KERNEL_ISSUER = 'kernel.astrale.ai'

// =============================================================================
// IDENTITY REGISTRY (Mock Graph Lookup)
// =============================================================================

/**
 * Mock identity registry: (iss, sub) → IdentityId
 * In production, this would be a graph lookup.
 */
export class IdentityRegistry {
  private identities = new Map<string, IdentityId>()

  private makeKey(iss: string, sub: string): string {
    return `${iss}::${sub}`
  }

  register(iss: string, sub: string, identityId: IdentityId): void {
    this.identities.set(this.makeKey(iss, sub), identityId)
  }

  resolve(iss: string, sub: string): IdentityId | undefined {
    // Kernel-issued tokens: sub IS the identityId
    if (iss === KERNEL_ISSUER) {
      return sub
    }
    return this.identities.get(this.makeKey(iss, sub))
  }

  /**
   * Resolve or throw if not found.
   */
  resolveOrThrow(iss: string, sub: string): IdentityId {
    const id = this.resolve(iss, sub)
    if (!id) {
      throw new Error(`Unknown identity: ${iss}::${sub}`)
    }
    return id
  }
}

// =============================================================================
// ISSUER KEY STORE (Mock JWKS)
// =============================================================================

/**
 * Mock issuer key store: issuer URL → verification key
 * In production, this would fetch JWKS from issuer/.well-known/jwks.json
 */
export class IssuerKeyStore {
  private keys = new Map<string, string>()

  /**
   * Register a trusted issuer with its signing key.
   */
  registerIssuer(issuer: string, key: string): void {
    this.keys.set(issuer, key)
  }

  /**
   * Get the verification key for an issuer.
   * Returns undefined if issuer is not trusted.
   */
  getKey(issuer: string): string | undefined {
    return this.keys.get(issuer)
  }

  /**
   * Check if an issuer is trusted.
   */
  isTrusted(issuer: string): boolean {
    return this.keys.has(issuer)
  }
}

// =============================================================================
// TOKEN VERIFIER
// =============================================================================

export interface VerificationResult {
  payload: TokenPayload
  identityId: IdentityId
}

export class TokenVerifier {
  constructor(
    private registry: IdentityRegistry,
    private keyStore: IssuerKeyStore,
    private expectedAudience: string = KERNEL_ISSUER,
  ) {}

  /**
   * Verify a JWT token and resolve the identity.
   *
   * 1. Decode the token
   * 2. Verify the issuer is trusted
   * 3. Verify the signature (mocked)
   * 4. Check expiration
   * 5. Check audience
   * 6. Resolve identity from (iss, sub)
   */
  verify(token: string): VerificationResult {
    // 1. Decode
    const payload = this.decodeToken(token)

    // 2. Verify issuer is trusted
    if (!this.keyStore.isTrusted(payload.iss)) {
      throw new Error(`Untrusted issuer: ${payload.iss}`)
    }

    // 3. Verify signature (mocked - in production, use the key)
    // const key = this.keyStore.getKey(payload.iss)
    // In a real implementation, we'd verify the signature here

    // 4. Check expiration
    const now = Math.floor(Date.now() / 1000)
    if (payload.exp && payload.exp < now) {
      throw new Error('Token expired')
    }

    // 5. Check audience
    if (payload.aud !== this.expectedAudience) {
      throw new Error(`Invalid audience: expected ${this.expectedAudience}, got ${payload.aud}`)
    }

    // 6. Resolve identity
    const identityId = this.registry.resolveOrThrow(payload.iss, payload.sub)

    return { payload, identityId }
  }

  /**
   * Verify that a token is kernel-issued.
   */
  verifyKernelIssued(token: string): VerificationResult {
    const result = this.verify(token)
    if (result.payload.iss !== KERNEL_ISSUER) {
      throw new Error(`Token must be kernel-issued, got issuer: ${result.payload.iss}`)
    }
    return result
  }

  /**
   * Decode a token without verification (for inspection only).
   */
  decodeToken(token: string): TokenPayload {
    const parts = token.split('.')
    if (parts.length !== 3) {
      throw new Error('Invalid token format')
    }
    return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
  }

  /**
   * Create a mock token (for testing).
   */
  static createMockToken(payload: TokenPayload): string {
    const header = { alg: 'mock', typ: 'JWT' }
    const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url')
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
    const signature = 'mock-signature'
    return `${headerB64}.${payloadB64}.${signature}`
  }
}

// =============================================================================
// DEFAULT INSTANCES (for testing)
// =============================================================================

/**
 * Create a default test setup with kernel and common IdPs registered.
 */
export function createTestVerifier(): {
  registry: IdentityRegistry
  keyStore: IssuerKeyStore
  verifier: TokenVerifier
} {
  const registry = new IdentityRegistry()
  const keyStore = new IssuerKeyStore()

  // Register kernel as trusted issuer
  keyStore.registerIssuer(KERNEL_ISSUER, 'kernel-key')

  // Register common test IdPs
  keyStore.registerIssuer('idp.test', 'idp-key')
  keyStore.registerIssuer('google.com', 'google-key')

  const verifier = new TokenVerifier(registry, keyStore)

  return { registry, keyStore, verifier }
}
