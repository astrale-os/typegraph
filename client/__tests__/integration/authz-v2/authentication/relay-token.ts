/**
 * AUTH_V2 RelayToken & Authentication
 *
 * Mock implementation for testing the complete delegation flow.
 * Uses the unified expression resolver and enforces security constraints.
 */

import type {
  IdentityId,
  RelayTokenRequest,
  RelayTokenResponse,
  UnresolvedIdentityExpr,
} from '../types'
import type { IdentityRegistry } from './identity-registry'
import type { IssuerKeyStore } from './issuer-key-store'

import {
  type ExpressionEncoding,
  type PayloadCodec,
  getCodec,
  jsonCodec as _jsonCodec,
} from '../expression/codec'
import { authenticate as authenticateImpl, type AuthContext } from './authenticator'
import { GrantDecoder, extractPrimaryIdentity } from './grant-decoder'
import { TokenVerifier, KERNEL_ISSUER, type TokenPayload } from './token-verifier'

// =============================================================================
// RE-EXPORTS
// =============================================================================

export { KERNEL_ISSUER } from './token-verifier'
export { extractPrimaryIdentity } from './grant-decoder'

// =============================================================================
// RE-EXPORT AUTH CONTEXT
// =============================================================================

export type { AuthContext } from './authenticator'

// =============================================================================
// KERNEL SERVICE
// =============================================================================

export interface KernelServiceConfig {
  defaultTtl: number
  maxTtl: number
  encoding: ExpressionEncoding
  /** Enable structural deduplication (only effective with 'binary' encoding). */
  dedup: boolean
}

const defaultConfig: KernelServiceConfig = {
  defaultTtl: 3600,
  maxTtl: 86400,
  encoding: 'json',
  dedup: false,
}

/**
 * Mock kernel service that provides RelayToken and Authentication.
 *
 * This is the central authority that:
 * - Issues kernel-signed tokens via RelayToken
 * - Authenticates incoming JWTs
 * - Enforces security constraints
 */
export class KernelService {
  private verifier: TokenVerifier
  private decoder: GrantDecoder
  private config: KernelServiceConfig

  private get codec(): PayloadCodec {
    return getCodec(this.config.encoding, { dedup: this.config.dedup })
  }

  constructor(
    public readonly registry: IdentityRegistry,
    public readonly keyStore: IssuerKeyStore,
    config: Partial<KernelServiceConfig> = {},
  ) {
    this.config = { ...defaultConfig, ...config }
    this.verifier = new TokenVerifier(keyStore, KERNEL_ISSUER)
    const codecOpts = { dedup: this.config.dedup }
    const codec =
      this.config.encoding !== 'json' ? getCodec(this.config.encoding, codecOpts) : undefined
    this.decoder = new GrantDecoder(this.verifier, registry, codec)
  }

  // ===========================================================================
  // RELAY TOKEN
  // ===========================================================================

  /**
   * RelayToken endpoint: decode expression, optionally apply scopes, return kernel-signed JWT.
   *
   * 1. Decode expression: JWTs → plain IDs (preserve structure)
   * 2. Apply top-level scopes via intersection (if provided)
   * 3. Issue kernel-signed JWT for forwarding
   */
  async relayToken(request: RelayTokenRequest): Promise<RelayTokenResponse> {
    // 1. Decode expression
    const decoded = await this.decoder.decode(request.expression as UnresolvedIdentityExpr)

    // 2. Apply top-level scopes
    const withScopes = request.scopes ? this.decoder.applyScopes(decoded, request.scopes) : decoded

    // 3. Build kernel-signed token
    const now = Math.floor(Date.now() / 1000)
    const ttl = Math.min(request.ttl ?? this.config.defaultTtl, this.config.maxTtl)
    const exp = now + ttl

    const primaryIdentity = extractPrimaryIdentity(withScopes)

    // NOTE: Relay tokens only embed forResource, not forType.
    // This is intentional: relay tokens are for resource-scoped delegation.
    // When authenticated, the missing forType defaults to the principal's own
    // identity via decodeGrant(), meaning the type check uses the principal
    // (caller) identity rather than the delegated expression.
    const payload: TokenPayload = {
      iss: KERNEL_ISSUER,
      sub: primaryIdentity,
      aud: KERNEL_ISSUER,
      iat: now,
      exp,
      grant: {
        v: 1,
        forResource: this.codec.encodeExpr(withScopes) as UnresolvedIdentityExpr,
      },
    }

    const token = TokenVerifier.createMockToken(payload)

    return { token, expires_at: exp }
  }

  // ===========================================================================
  // AUTHENTICATION
  // ===========================================================================

  /**
   * Authenticate a JWT and return the AuthContext.
   */
  async authenticate(token: string): Promise<AuthContext> {
    return authenticateImpl(token, this.verifier, this.registry, this.decoder)
  }

  // ===========================================================================
  // HELPERS FOR TESTS
  // ===========================================================================

  /**
   * Register an identity in the registry.
   */
  registerIdentity(iss: string, sub: string, identityId: IdentityId): void {
    this.registry.register(iss, sub, identityId)
  }

  /**
   * Register a trusted issuer.
   */
  registerIssuer(issuer: string, key: string = 'mock-key'): void {
    this.keyStore.registerIssuer(issuer, key)
  }

  /**
   * Create a mock token (for testing).
   */
  createToken(payload: TokenPayload): string {
    return TokenVerifier.createMockToken(payload)
  }
}

// =============================================================================
// SDK HELPERS
// =============================================================================

/**
 * Create an app JWT (self-minted by calling app).
 */
export function createAppJwt(
  appId: string,
  options?: {
    grant?: {
      forType?: UnresolvedIdentityExpr
      forResource?: UnresolvedIdentityExpr
    }
    ttl?: number
  },
): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: TokenPayload = {
    iss: appId,
    sub: appId,
    aud: KERNEL_ISSUER,
    iat: now,
    exp: now + (options?.ttl ?? 3600),
    grant: options?.grant ? { v: 1, ...options.grant } : undefined,
  }
  return TokenVerifier.createMockToken(payload)
}

/**
 * Create a user JWT (simulating IdP-issued token).
 */
export function createUserJwt(userId: string, issuer: string = 'workos.test'): string {
  const now = Math.floor(Date.now() / 1000)
  const payload: TokenPayload = {
    iss: issuer,
    sub: userId,
    aud: KERNEL_ISSUER,
    iat: now,
    exp: now + 3600,
  }
  return TokenVerifier.createMockToken(payload)
}

// =============================================================================
// TOKEN UTILITIES
// =============================================================================

/**
 * Decode a mock JWT token (for testing).
 */
export function decodeMockJwt(token: string): { header: unknown; payload: TokenPayload } {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid token format')
  }
  const header = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString())
  const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString())
  return { header, payload }
}
