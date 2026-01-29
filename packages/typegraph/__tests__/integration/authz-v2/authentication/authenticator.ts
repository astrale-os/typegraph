/**
 * AUTH_V2 Authenticator
 *
 * Standalone authentication function: JWT → AuthContext.
 * Verifies tokens, resolves identity, enforces security constraints,
 * and resolves grants.
 */

import type { Grant, IdentityId } from '../types'
import { type TokenVerifier, KERNEL_ISSUER } from './token-verifier'
import type { IdentityRegistry } from './identity-registry'
import { type GrantResolver, validateGrant } from './grant-resolver'

// =============================================================================
// AUTH CONTEXT
// =============================================================================

export interface AuthContext {
  origin: 'backend' | 'shell' | 'system'
  principal: IdentityId
  grant: Grant
}

// =============================================================================
// AUTHENTICATE
// =============================================================================

/**
 * Authenticate a JWT and return the AuthContext.
 *
 * 1. Verify the JWT signature and claims
 * 2. Resolve principal from (iss, sub)
 * 3. SECURITY CHECK: If external app, embedded tokens MUST be kernel-signed
 * 4. Determine origin
 * 5. Resolve the grant (or use defaults)
 */
export async function authenticate(
  token: string,
  verifier: TokenVerifier,
  registry: IdentityRegistry,
  resolver: GrantResolver,
): Promise<AuthContext> {
  // 1. Verify JWT
  const { payload } = verifier.verifyToken(token)

  // 2. Resolve principal from (iss, sub)
  const principal = registry.resolveIdentity(payload.iss, payload.sub)

  // 3. SECURITY SHORT-CIRCUIT
  // TODO: review if truly needed to short-circuit (it's already verified downstream)
  // External apps can ONLY embed kernel-signed tokens
  if (payload.iss !== KERNEL_ISSUER && payload.grant) {
    validateGrant(payload.iss, payload.grant, verifier)
  }

  // 4. Determine originyeah y
  const origin: AuthContext['origin'] = payload.iss === KERNEL_ISSUER ? 'system' : 'backend'

  // 5. Resolve grant
  const resolvedGrant = await resolver.resolveGrant(payload.grant, principal)
  const grant: Grant = {
    forType: resolvedGrant.forType,
    forResource: resolvedGrant.forResource,
  }

  return { origin, principal, grant }
}
