/**
 * AUTH_V2 End-to-End Tests
 *
 * Tests the complete flow: Client SDK → JWT minting → Kernel verification → Authorization.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  KernelService,
  createAppJwt,
  createUserJwt,
  decodeMockJwt,
  KERNEL_ISSUER,
} from '../integration/authz-v2/authentication/relay-token'
import { TokenVerifier } from '../integration/authz-v2/authentication/token-verifier'
import { IdentityRegistry } from '../integration/authz-v2/authentication/identity-registry'
import { IssuerKeyStore } from '../integration/authz-v2/authentication/issuer-key-store'
import {
  unresolvedId,
  unresolvedJwt,
  unresolvedUnion,
} from '../integration/authz-v2/authentication/grant-encoding'
import { AccessChecker } from '../integration/authz-v2/adapter'
import {
  setupAuthzTest,
  teardownAuthzTest,
  type AuthzTestContext,
} from '../integration/authz-v2/testing/setup'
import { identity, union, grant } from '../integration/authz-v2/testing/helpers'
import type { UnresolvedIdentityExpr } from '../integration/authz-v2/types'

// =============================================================================
// TEST SETUP
// =============================================================================

describe('E2E: JWT Delegation Flow', () => {
  let registry: IdentityRegistry
  let keyStore: IssuerKeyStore
  let kernel: KernelService

  beforeEach(() => {
    // Fresh kernel for each test
    registry = new IdentityRegistry()
    keyStore = new IssuerKeyStore()

    // Register trusted issuers
    keyStore.registerIssuer(KERNEL_ISSUER, 'kernel-key')
    keyStore.registerIssuer('workos.test', 'workos-key')
    keyStore.registerIssuer('APP1', 'app1-key')

    // Register identities (iss, sub) → identityId
    registry.register('workos.test', 'user-1', 'USER1')
    registry.register('workos.test', 'user-2', 'USER2')
    registry.register('workos.test', 'role-1', 'ROLE1')
    registry.register('workos.test', 'blocked', 'BLOCKED')
    registry.register('APP1', 'APP1', 'APP1')

    kernel = new KernelService(registry, keyStore)
  })

  // ===========================================================================
  // BASIC JWT FLOW
  // ===========================================================================

  describe('Basic JWT Authentication', () => {
    it('authenticates app JWT without grant claim', async () => {
      const appJwt = createAppJwt('APP1')

      const authCtx = await kernel.authenticate(appJwt)

      expect(authCtx.principal).toBe('APP1')
      expect(authCtx.origin).toBe('backend')
      // Default grant uses principal for both
      expect(authCtx.grant.forType).toEqual({ kind: 'identity', id: 'APP1' })
      expect(authCtx.grant.forResource).toEqual({ kind: 'identity', id: 'APP1' })
    })

    it('authenticates kernel-issued JWT', async () => {
      // First, get a kernel-issued token via RelayToken
      const userJwt = createUserJwt('user-1')
      const restricted = await kernel.relayToken({
        expression: unresolvedJwt(userJwt),
      })

      const authCtx = await kernel.authenticate(restricted.token)

      expect(authCtx.principal).toBe('USER1')
      expect(authCtx.origin).toBe('system')
    })

    it('rejects untrusted issuer', async () => {
      const untrustedJwt = TokenVerifier.createMockToken({
        iss: 'untrusted.evil',
        sub: 'hacker',
        aud: KERNEL_ISSUER,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })

      await expect(kernel.authenticate(untrustedJwt)).rejects.toThrow('Untrusted issuer')
    })

    it('rejects wrong audience', async () => {
      keyStore.registerIssuer('other-app', 'key')
      registry.register('other-app', 'app', 'OTHER')

      const wrongAudJwt = TokenVerifier.createMockToken({
        iss: 'other-app',
        sub: 'app',
        aud: 'wrong-audience',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })

      await expect(kernel.authenticate(wrongAudJwt)).rejects.toThrow('Invalid audience')
    })
  })

  // ===========================================================================
  // RESTRICT TOKEN FLOW
  // ===========================================================================

  describe('RelayToken Endpoint', () => {
    it('relays single token with scopes', async () => {
      const userJwt = createUserJwt('user-1')

      const result = await kernel.relayToken({
        expression: unresolvedJwt(userJwt),
        scopes: [{ nodes: ['workspace-1'], perms: ['read'] }],
      })

      const decoded = decodeMockJwt(result.token)
      expect(decoded.payload.iss).toBe(KERNEL_ISSUER)
      expect(decoded.payload.sub).toBe('USER1')
      expect(decoded.payload.grant?.forResource).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['workspace-1'], perms: ['read'] }],
      })
    })

    it('relays union of tokens with scopes', async () => {
      const userJwt = createUserJwt('user-1')
      const roleJwt = createUserJwt('role-1')

      const result = await kernel.relayToken({
        expression: unresolvedUnion(unresolvedJwt(userJwt), unresolvedJwt(roleJwt)),
        scopes: [{ nodes: ['workspace-1'] }],
      })

      const decoded = decodeMockJwt(result.token)
      expect(decoded.payload.grant?.forResource?.kind).toBe('union')

      // Both leaves should have the scope
      const grant = decoded.payload.grant?.forResource as any
      expect(grant.left.scopes).toEqual([{ nodes: ['workspace-1'] }])
      expect(grant.right.scopes).toEqual([{ nodes: ['workspace-1'] }])
    })

    it('uses proper scope INTERSECTION (not concatenation)', async () => {
      const userJwt = createUserJwt('user-1')

      // First relay: workspace-1 and workspace-2, read and write
      const first = await kernel.relayToken({
        expression: unresolvedJwt(userJwt),
        scopes: [{ nodes: ['workspace-1', 'workspace-2'], perms: ['read', 'write'] }],
      })

      // Second relay: workspace-1 only, read only
      const second = await kernel.relayToken({
        expression: unresolvedJwt(first.token),
        scopes: [{ nodes: ['workspace-1'], perms: ['read'] }],
      })

      const decoded = decodeMockJwt(second.token)
      const scopes = (decoded.payload.grant?.forResource as any)?.scopes

      // INTERSECTION: nodes = [ws-1], perms = [read]
      expect(scopes).toEqual([{ nodes: ['workspace-1'], perms: ['read'] }])
    })

    it('handles complex expression with mixed scopes', async () => {
      const userJwt = createUserJwt('user-1')
      const roleJwt = createUserJwt('role-1')
      const blockedJwt = createUserJwt('blocked')

      // User union role (role limited to read), minus blocked
      const expr: UnresolvedIdentityExpr = {
        kind: 'exclude',
        base: {
          kind: 'union',
          operands: [
            { kind: 'identity', jwt: userJwt },
            { kind: 'scope', scopes: [{ perms: ['read'] }], expr: { kind: 'identity', jwt: roleJwt } },
          ],
        },
        excluded: [{ kind: 'identity', jwt: blockedJwt }],
      }

      const result = await kernel.relayToken({
        expression: expr,
        scopes: [{ nodes: ['workspace-1'] }],
      })

      const decoded = decodeMockJwt(result.token)
      const grantExpr = decoded.payload.grant?.forResource as any

      // Structure preserved
      expect(grantExpr.kind).toBe('exclude')
      expect(grantExpr.left.kind).toBe('union')

      // User: only top-level scope
      expect(grantExpr.left.left.scopes).toEqual([{ nodes: ['workspace-1'] }])

      // Role: per-leaf AND top-level INTERSECTED
      // { perms: ['read'] } ∩ { nodes: ['workspace-1'] } = { nodes: ['workspace-1'], perms: ['read'] }
      expect(grantExpr.left.right.scopes).toEqual([{ nodes: ['workspace-1'], perms: ['read'] }])

      // Blocked: only top-level scope
      expect(grantExpr.right.scopes).toEqual([{ nodes: ['workspace-1'] }])
    })
  })

  // ===========================================================================
  // MULTI-HOP DELEGATION
  // ===========================================================================

  describe('Multi-Hop Delegation', () => {
    it('User → App A → App B → Kernel with scope accumulation', async () => {
      const userJwt = createUserJwt('user-1')

      // App A relays with workspace-1 and workspace-2
      const afterAppA = await kernel.relayToken({
        expression: unresolvedJwt(userJwt),
        scopes: [{ nodes: ['workspace-1', 'workspace-2'], perms: ['read', 'write'] }],
      })

      // App B further restricts to workspace-1 only, read only
      const afterAppB = await kernel.relayToken({
        expression: unresolvedJwt(afterAppA.token),
        scopes: [{ nodes: ['workspace-1'], perms: ['read'] }],
      })

      const decoded = decodeMockJwt(afterAppB.token)
      const scopes = (decoded.payload.grant?.forResource as any)?.scopes

      // Properly intersected
      expect(scopes).toEqual([{ nodes: ['workspace-1'], perms: ['read'] }])
    })

    it('compose user + role permissions via union', async () => {
      const userJwt = createUserJwt('user-1')
      const roleJwt = createUserJwt('role-1')

      const combined = await kernel.relayToken({
        expression: unresolvedUnion(unresolvedJwt(userJwt), unresolvedJwt(roleJwt)),
        scopes: [{ nodes: ['workspace-1'] }],
      })

      const authCtx = await kernel.authenticate(combined.token)

      expect(authCtx.principal).toBe('USER1') // Primary identity
      expect(authCtx.grant.forResource.kind).toBe('union')
    })
  })

  // ===========================================================================
  // SECURITY CONSTRAINTS
  // ===========================================================================

  describe('Security Constraints', () => {
    it('rejects expired tokens', async () => {
      const expiredJwt = TokenVerifier.createMockToken({
        iss: 'APP1',
        sub: 'APP1',
        aud: KERNEL_ISSUER,
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired
      })

      await expect(kernel.authenticate(expiredJwt)).rejects.toThrow('Token expired')
    })

    it('CRITICAL: external apps cannot embed raw IdP tokens', async () => {
      // User token (IdP-issued, not kernel-issued)
      const userJwt = createUserJwt('user-1')

      // App tries to embed raw IdP token in grant (SHOULD FAIL)
      const maliciousAppJwt = TokenVerifier.createMockToken({
        iss: 'APP1',
        sub: 'APP1',
        aud: KERNEL_ISSUER,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        grant: {
          v: 1,
          forResource: { kind: 'identity', jwt: userJwt }, // RAW IdP token!
        },
      })

      // This should fail - external apps can only embed kernel-signed tokens
      await expect(kernel.authenticate(maliciousAppJwt)).rejects.toThrow(
        'Token must be kernel-issued',
      )
    })

    it('external apps CAN embed kernel-signed tokens', async () => {
      // First, get a proper kernel-issued token
      const userJwt = createUserJwt('user-1')
      const restricted = await kernel.relayToken({
        expression: unresolvedJwt(userJwt),
        scopes: [{ nodes: ['workspace-1'] }],
      })

      // App embeds the kernel-signed token (this is allowed)
      const appJwt = TokenVerifier.createMockToken({
        iss: 'APP1',
        sub: 'APP1',
        aud: KERNEL_ISSUER,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        grant: {
          v: 1,
          forResource: { kind: 'identity', jwt: restricted.token },
        },
      })

      // This should succeed
      const authCtx = await kernel.authenticate(appJwt)
      expect(authCtx.principal).toBe('APP1')
      expect(authCtx.grant.forResource).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['workspace-1'] }],
      })
    })

    it('TTL is bounded by max', async () => {
      const userJwt = createUserJwt('user-1')

      // Request very long TTL
      const result = await kernel.relayToken({
        expression: unresolvedJwt(userJwt),
        ttl: 999999,
      })

      const decoded = decodeMockJwt(result.token)
      const now = Math.floor(Date.now() / 1000)
      const actualTtl = decoded.payload.exp - now

      // Should be capped at maxTtl (86400 default)
      expect(actualTtl).toBeLessThanOrEqual(86400)
    })
  })

  // ===========================================================================
  // ERROR CASES
  // ===========================================================================

  describe('Error Cases', () => {
    it('fails to resolve unknown identity', async () => {
      const unknownUserJwt = createUserJwt('unknown-user')

      await expect(
        kernel.relayToken({ expression: unresolvedJwt(unknownUserJwt) }),
      ).rejects.toThrow('Unknown identity')
    })

    it('handles plain ID (kernel-issued only)', async () => {
      const result = await kernel.relayToken({
        expression: unresolvedId('USER1'),
      })

      const decoded = decodeMockJwt(result.token)
      expect(decoded.payload.grant?.forResource).toEqual({
        kind: 'identity',
        id: 'USER1',
      })
    })
  })
})

// =============================================================================
// INTEGRATION WITH ACCESS CHECKER
// =============================================================================

describe('E2E: Integration with AccessChecker', () => {
  let ctx: AuthzTestContext
  let checker: AccessChecker

  beforeEach(async () => {
    ctx = await setupAuthzTest()
    checker = new AccessChecker(ctx.executor)
  })

  afterEach(async () => {
    await teardownAuthzTest(ctx)
  })

  it('app with type permission + user with resource permission = granted', async () => {
    // Build grant: app for type, user for resource
    const authGrant = grant(identity(ctx.data.identities.app1), identity(ctx.data.identities.user1))

    // Check access on M1
    const result = await checker.checkAccess({
      principal: ctx.data.identities.app1,
      grant: authGrant,
      nodeId: ctx.data.modules.m1,
      perm: 'read',
    })

    expect(result.granted).toBe(true)
  })

  it('union of user + role grants combined access', async () => {
    // USER1 has edit on workspace-1
    // ROLE1 has edit on workspace-2
    const authGrant = grant(
      identity(ctx.data.identities.app1),
      union(identity(ctx.data.identities.user1), identity(ctx.data.identities.role1)),
    )

    // M1 is in workspace-1
    const m1Result = await checker.checkAccess({
      principal: ctx.data.identities.app1,
      grant: authGrant,
      nodeId: ctx.data.modules.m1,
      perm: 'edit',
    })
    expect(m1Result.granted).toBe(true)

    // M3 is in workspace-2
    const m3Result = await checker.checkAccess({
      principal: ctx.data.identities.app1,
      grant: authGrant,
      nodeId: ctx.data.modules.m3,
      perm: 'edit',
    })
    expect(m3Result.granted).toBe(true)
  })

  it('denied when app lacks type permission', async () => {
    const authGrant = grant(identity('UNKNOWN_APP'), identity(ctx.data.identities.user1))

    const result = await checker.checkAccess({
      principal: 'UNKNOWN_APP',
      grant: authGrant,
      nodeId: ctx.data.modules.m1,
      perm: 'read',
    })

    expect(result.granted).toBe(false)
    expect(result.deniedBy).toBe('type')
  })

  it('denied when user lacks resource permission', async () => {
    const authGrant = grant(identity(ctx.data.identities.app1), identity('UNKNOWN_USER'))

    const result = await checker.checkAccess({
      principal: ctx.data.identities.app1,
      grant: authGrant,
      nodeId: ctx.data.modules.m1,
      perm: 'read',
    })

    expect(result.granted).toBe(false)
    expect(result.deniedBy).toBe('resource')
  })
})
