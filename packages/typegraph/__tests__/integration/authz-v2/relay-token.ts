/**
 * AUTH_V2 RelayToken & Authentication
 *
 * Mock implementation for testing the complete delegation flow.
 * Uses the unified expression resolver and enforces security constraints.
 */

import type {
  Grant,
  IdentityExpr,
  IdentityId,
  RelayTokenRequest,
  RelayTokenResponse,
} from './types'
import {
  TokenVerifier,
  type IdentityRegistry,
  type IssuerKeyStore,
  KERNEL_ISSUER,
  type TokenPayload,
  type EncodedIdentityExpr,
} from './token-verifier'
import {
  ExpressionResolver,
  extractPrimaryIdentity,
  validateGrantSecurity,
} from './expression-resolver'
import { identityExprToUnresolved } from './grant-encoding'

// =============================================================================
// RE-EXPORTS
// =============================================================================

export { KERNEL_ISSUER } from './token-verifier'
export { extractPrimaryIdentity } from './expression-resolver'

// =============================================================================
// AUTH CONTEXT
// =============================================================================

export interface AuthContext {
  origin: 'backend' | 'shell' | 'system'
  principal: IdentityId
  grant: Grant
}

// =============================================================================
// KERNEL SERVICE
// =============================================================================

export interface KernelServiceConfig {
  defaultTtl: number
  maxTtl: number
}

const defaultConfig: KernelServiceConfig = {
  defaultTtl: 3600,
  maxTtl: 86400,
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
  private resolver: ExpressionResolver
  private config: KernelServiceConfig

  constructor(
    public readonly registry: IdentityRegistry,
    public readonly keyStore: IssuerKeyStore,
    config: Partial<KernelServiceConfig> = {},
  ) {
    this.config = { ...defaultConfig, ...config }
    this.verifier = new TokenVerifier(registry, keyStore, KERNEL_ISSUER)
    this.resolver = new ExpressionResolver(this.verifier)
  }

  // ===========================================================================
  // RELAY TOKEN
  // ===========================================================================

  /**
   * RelayToken endpoint: resolve expression, optionally apply scopes, return kernel-signed JWT.
   *
   * 1. Resolve expression: JWTs → plain IDs (preserve structure)
   * 2. Apply top-level scopes via intersection (if provided)
   * 3. Issue kernel-signed JWT for forwarding
   */
  async relayToken(request: RelayTokenRequest): Promise<RelayTokenResponse> {
    // 1. Resolve expression
    const resolved = await this.resolver.resolve(request.expression as EncodedIdentityExpr)

    // 2. Apply top-level scopes
    const withScopes = request.scopes
      ? this.resolver.applyScopes(resolved, request.scopes)
      : resolved

    // 3. Build kernel-signed token
    const now = Math.floor(Date.now() / 1000)
    const ttl = Math.min(request.ttl ?? this.config.defaultTtl, this.config.maxTtl)
    const exp = now + ttl

    const primaryIdentity = extractPrimaryIdentity(withScopes)

    const payload: TokenPayload = {
      iss: KERNEL_ISSUER,
      sub: primaryIdentity,
      aud: KERNEL_ISSUER,
      iat: now,
      exp,
      grant: {
        v: 1,
        forResource: identityExprToUnresolved(withScopes),
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
   *
   * 1. Verify the JWT signature and claims
   * 2. Resolve principal from (iss, sub)
   * 3. SECURITY CHECK: If external app, embedded tokens MUST be kernel-signed
   * 4. Resolve the grant (or use defaults)
   */
  async authenticate(token: string): Promise<AuthContext> {
    // 1. Verify JWT
    const { payload, identityId } = this.verifier.verify(token)

    // 2. Principal is the resolved identity
    const principal = identityId

    // 3. CRITICAL SECURITY CHECK
    // External apps can ONLY embed kernel-signed tokens
    if (payload.iss !== KERNEL_ISSUER && payload.grant) {
      validateGrantSecurity(payload.iss, payload.grant, this.verifier)
    }

    // 4. Determine origin
    const origin: AuthContext['origin'] = payload.iss === KERNEL_ISSUER ? 'system' : 'backend'

    // 5. Resolve grant
    const resolvedGrant = await this.resolver.resolveGrant(payload.grant, principal)
    const grant: Grant = {
      forType: resolvedGrant.forType,
      forResource: resolvedGrant.forResource,
    }

    return { origin, principal, grant }
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
      forType?: EncodedIdentityExpr
      forResource?: EncodedIdentityExpr
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
