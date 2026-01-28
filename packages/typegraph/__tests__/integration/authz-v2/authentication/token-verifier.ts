/**
 * AUTH_V2 Token Verification
 *
 * Mock implementation of JWT verification with issuer key lookup.
 * Pure crypto/format verification — no identity resolution.
 */

import type { UnresolvedGrant } from '../types'
import { IssuerKeyStore } from './issuer-key-store'
import { IdentityRegistry } from './identity-registry'

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

// =============================================================================
// CONSTANTS
// =============================================================================

export const KERNEL_ISSUER = 'kernel.astrale.ai'

// =============================================================================
// TOKEN VERIFIER
// =============================================================================

export interface VerificationResult {
  payload: TokenPayload
}

export class TokenVerifier {
  constructor(
    private keyStore: IssuerKeyStore,
    private expectedAudience: string = KERNEL_ISSUER,
  ) {}

  /**
   * Verify a JWT token.
   *
   * 1. Decode the token
   * 2. Verify the issuer is trusted
   * 3. Verify the signature (mocked)
   * 4. Check expiration
   * 5. Check audience
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

    return { payload }
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

  const verifier = new TokenVerifier(keyStore)

  return { registry, keyStore, verifier }
}
