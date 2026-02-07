/**
 * AUTH_V2 SDK RequestContext Tests
 *
 * Tests the request-context-driven SDK against a real KernelService + FalkorDB graph.
 * Organized around RequestContext as the primary API surface.
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'
import {
  setupAuthzTest,
  teardownAuthzTest,
  clearDatabase,
  seedAuthzTestData,
  type AuthzTestContext,
} from '../testing/setup'
import { FalkorDBIdentityAdapter } from '../adapter'
import { AppSDK, MockKernel, type RequestContext } from './client'
import { KernelService, createUserJwt } from '../authentication/relay-token'
import { IdentityRegistry } from '../authentication/identity-registry'
import { IssuerKeyStore } from '../authentication/issuer-key-store'
import { KERNEL_ISSUER } from '../authentication/token-verifier'
import { unresolvedJwt } from '../authentication/grant-encoding'
import { expectGranted, expectDeniedByResource, READ, EDIT, USE } from '../testing/helpers'

describe('AUTH_V2: SDK RequestContext', () => {
  let testCtx: AuthzTestContext
  let kernelService: KernelService
  let sdk: AppSDK

  const APP_ID = 'app.test'

  beforeAll(async () => {
    testCtx = await setupAuthzTest()
  }, 30000)

  afterAll(async () => {
    await teardownAuthzTest(testCtx)
  })

  beforeEach(async () => {
    await clearDatabase(testCtx.connection.graph)
    testCtx.data = await seedAuthzTestData(testCtx.connection.graph)

    const registry = new IdentityRegistry()
    const keyStore = new IssuerKeyStore()

    keyStore.registerIssuer(KERNEL_ISSUER, 'kernel-key')
    keyStore.registerIssuer(APP_ID, 'app-key')
    keyStore.registerIssuer('idp.test', 'idp-key')

    registry.register(APP_ID, APP_ID, 'APP1')
    registry.register('idp.test', 'user1', 'USER1')
    registry.register('idp.test', 'role1', 'ROLE1')
    registry.register(KERNEL_ISSUER, 'USER1', 'USER1')
    registry.register(KERNEL_ISSUER, 'ROLE1', 'ROLE1')

    kernelService = new KernelService(registry, keyStore)
    const accessChecker = new FalkorDBIdentityAdapter(testCtx.executor)
    const mockKernel = new MockKernel({ kernelService, accessChecker })
    sdk = new AppSDK({ appId: APP_ID, kernel: mockKernel })
  })

  // ===========================================================================
  // HELPER
  // ===========================================================================

  async function ctxForUser(sub: string): Promise<RequestContext> {
    const userJwt = createUserJwt(sub, 'idp.test')
    const relay = await kernelService.relayToken({ expression: unresolvedJwt(userJwt) })
    return sdk.fromRelay(relay.token)
  }

  // ===========================================================================
  // TRANSPARENT ACCESS CHECKS (99%)
  // ===========================================================================

  describe('Transparent access checks (99%)', () => {
    it('ctx.read grants access on inherited resource', async () => {
      const ctx = await ctxForUser('user1')
      // USER1 has read on root → inherited by M1
      expectGranted(await ctx.read('M1'))
    })

    it('ctx.read grants access across workspaces via root inheritance', async () => {
      const ctx = await ctxForUser('user1')
      // USER1 has read on root → inherited by M3 (ws2)
      expectGranted(await ctx.read('M3'))
    })

    it('ctx.edit grants access within workspace', async () => {
      const ctx = await ctxForUser('user1')
      // USER1 has edit on workspace-1 → M1 is in ws1
      expectGranted(await ctx.edit('M1'))
    })

    it('ctx.edit denies access outside workspace', async () => {
      const ctx = await ctxForUser('user1')
      // USER1 has edit on workspace-1 only, M3 is in workspace-2
      expectDeniedByResource(await ctx.edit('M3'))
    })

    it('ctx.check delegates to kernel', async () => {
      const ctx = await ctxForUser('user1')
      expectGranted(await ctx.check('M1', READ))
      expectDeniedByResource(await ctx.check('M3', EDIT))
    })
  })

  // ===========================================================================
  // COMPOSITION (1%)
  // ===========================================================================

  describe('Composition (1%)', () => {
    it('union grants access from either context', async () => {
      const ctx1 = await ctxForUser('user1')
      const ctx2 = await ctxForUser('role1')

      // USER1 ∪ ROLE1
      const composed = ctx1.compose(ctx2, 'union')

      // M3 edit: USER1 has edit on ws1 only, ROLE1 has edit on ws2 → union grants
      expectGranted(await composed.edit('M3'))
      // M1 edit: USER1 has edit on ws1 → union grants
      expectGranted(await composed.edit('M1'))
    })

    it('intersect requires both contexts to grant', async () => {
      const ctx1 = await ctxForUser('user1')
      const ctx2 = await ctxForUser('role1')

      // USER1 ∩ ROLE1
      const composed = ctx1.compose(ctx2, 'intersect')

      // M1 edit: USER1 has edit on ws1, ROLE1 does NOT → intersect denies
      expectDeniedByResource(await composed.edit('M1'))
    })

    it('exclude removes access from excluded context', async () => {
      const ctx1 = await ctxForUser('user1')
      const ctx2 = await ctxForUser('role1')

      // USER1 \ ROLE1
      const composed = ctx1.compose(ctx2, 'exclude')

      // M1 edit: USER1 has edit (ws1), ROLE1 does not → exclude keeps it
      expectGranted(await composed.edit('M1'))
    })

    it('compose accepts relay token strings', async () => {
      const ctx1 = await ctxForUser('user1')

      // Create a relay token string for ROLE1
      const role1Jwt = createUserJwt('role1', 'idp.test')
      const role1Relay = await kernelService.relayToken({ expression: unresolvedJwt(role1Jwt) })

      // compose with token string
      const composed = ctx1.compose(role1Relay.token, 'union')

      // ROLE1 has edit on ws2 → union grants edit on M3
      expectGranted(await composed.edit('M3'))
    })

    it('compose is immutable — original context unchanged', async () => {
      const ctx1 = await ctxForUser('user1')
      const ctx2 = await ctxForUser('role1')

      const composed = ctx1.compose(ctx2, 'union')

      // Original ctx1 does not gain ROLE1's permissions
      expectDeniedByResource(await ctx1.edit('M3'))
      // Composed context does
      expectGranted(await composed.edit('M3'))
    })
  })

  // ===========================================================================
  // SCOPE NARROWING (1%)
  // ===========================================================================

  describe('Scope narrowing (1%)', () => {
    it('withScope narrows access to workspace', async () => {
      const ctx = await ctxForUser('user1')
      const narrowed = ctx.withScope({ nodes: ['workspace-1'] })

      // M1 in ws1 → granted
      expectGranted(await narrowed.read('M1'))
      // M3 in ws2 → denied (scope restricts to ws1)
      expectDeniedByResource(await narrowed.read('M3'))
    })

    it('withScope is immutable — original context unchanged', async () => {
      const ctx = await ctxForUser('user1')
      const narrowed = ctx.withScope({ nodes: ['workspace-1'] })

      // Original can still read M3
      expectGranted(await ctx.read('M3'))
      // Narrowed cannot
      expectDeniedByResource(await narrowed.read('M3'))
    })

    it('stacking scopes is additive (OR)', async () => {
      const ctx = await ctxForUser('user1')
      const scoped1 = ctx.withScope({ nodes: ['workspace-1'] })
      const scoped2 = scoped1.withScope({ nodes: ['workspace-2'] })

      // scoped1: only ws1
      expectGranted(await scoped1.read('M1'))
      expectDeniedByResource(await scoped1.read('M3'))

      // scoped2: ws1 OR ws2 → both accessible
      expectGranted(await scoped2.read('M1'))
      expectGranted(await scoped2.read('M3'))
    })
  })

  // ===========================================================================
  // MINT RELAY
  // ===========================================================================

  describe('Mint relay', () => {
    it('mints a relay token from context', async () => {
      const ctx = await ctxForUser('user1')
      const relay = await ctx.mintRelay()

      expect(relay.token).toBeDefined()
      expect(relay.expires_at).toBeDefined()
    })

    it('mints relay with custom TTL', async () => {
      const ctx = await ctxForUser('user1')
      const relay = await ctx.mintRelay({ ttl: 60 })

      const now = Math.floor(Date.now() / 1000)
      expect(relay.expires_at).toBeLessThanOrEqual(now + 61)
      expect(relay.expires_at).toBeGreaterThanOrEqual(now + 59)
    })

    it('mints relay with scopes', async () => {
      const ctx = await ctxForUser('user1')
      const relay = await ctx.mintRelay({ scopes: [{ nodes: ['workspace-1'] }] })

      // Use the scoped relay token to create a new context and verify scope
      const scopedCtx = sdk.fromRelay(relay.token)
      expectGranted(await scopedCtx.read('M1'))
      expectDeniedByResource(await scopedCtx.read('M3'))
    })

    it('bare context throws on mintRelay', async () => {
      const bare = sdk.bare()
      await expect(bare.mintRelay()).rejects.toThrow('Cannot mint relay from a bare context')
    })
  })

  // ===========================================================================
  // BARE CONTEXT
  // ===========================================================================

  describe('Bare context', () => {
    it('app-only identity access check (type passes, resource denied)', async () => {
      const bare = sdk.bare()
      // APP1 has 'use' on T1 (type permission), but no resource permissions
      // Type check passes, resource check fails → denied by resource
      expectDeniedByResource(await bare.read('M1'))
    })
  })

  // ===========================================================================
  // ENCODING ROUND-TRIPS
  // ===========================================================================

  describe('Encoding round-trips', () => {
    // Encoding tests verify that the SDK correctly round-trips expressions
    // through compact/binary codecs via mintRelay → authenticate → checkAccess.
    // The SDK always produces JSON grants in app JWTs, while the kernel uses
    // its configured codec for relay tokens. We test by minting relay tokens
    // through the SDK and verifying them through the encoding kernel.

    function createEncodedSetup(
      encoding: 'compact' | 'binary',
      opts?: { dedup?: boolean },
    ): { kernelService: KernelService; sdk: AppSDK; accessChecker: FalkorDBIdentityAdapter } {
      const registry = new IdentityRegistry()
      const keyStore = new IssuerKeyStore()

      keyStore.registerIssuer(KERNEL_ISSUER, 'kernel-key')
      keyStore.registerIssuer(APP_ID, 'app-key')
      keyStore.registerIssuer('idp.test', 'idp-key')

      registry.register(APP_ID, APP_ID, 'APP1')
      registry.register('idp.test', 'user1', 'USER1')
      registry.register('idp.test', 'role1', 'ROLE1')
      registry.register(KERNEL_ISSUER, 'USER1', 'USER1')
      registry.register(KERNEL_ISSUER, 'ROLE1', 'ROLE1')

      const ks = new KernelService(registry, keyStore, { encoding, dedup: opts?.dedup })
      const accessChecker = new FalkorDBIdentityAdapter(testCtx.executor)
      const mk = new MockKernel({ kernelService: ks, accessChecker })
      const s = new AppSDK({ appId: APP_ID, kernel: mk })

      return { kernelService: ks, sdk: s, accessChecker }
    }

    async function ctxForUserWith(
      ks: KernelService,
      s: AppSDK,
      sub: string,
    ): Promise<RequestContext> {
      const userJwt = createUserJwt(sub, 'idp.test')
      const relay = await ks.relayToken({ expression: unresolvedJwt(userJwt) })
      return s.fromRelay(relay.token)
    }

    // Relay tokens default forType to the user's identity, but the SDK
    // wraps relay tokens in app JWTs where forType defaults to APP1.
    // Use APP1 for forType to match the SDK's checkAccess behavior.
    function appGrant(authCtx: { grant: { forResource: import('../types').IdentityExpr } }) {
      return {
        forType: { kind: 'identity' as const, id: 'APP1' },
        forResource: authCtx.grant.forResource,
      }
    }

    it('round-trips with compact encoding', async () => {
      const { kernelService: ks, sdk: s, accessChecker } = createEncodedSetup('compact')
      const ctx = await ctxForUserWith(ks, s, 'user1')

      const relay = await ctx.mintRelay()
      const authCtx = await ks.authenticate(relay.token)

      expectGranted(
        await accessChecker.checkAccess({
          principal: authCtx.principal,
          grant: appGrant(authCtx),
          nodeId: 'M1',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
    })

    it('round-trips with binary encoding', async () => {
      const { kernelService: ks, sdk: s, accessChecker } = createEncodedSetup('binary')
      const ctx = await ctxForUserWith(ks, s, 'user1')

      const relay = await ctx.mintRelay()
      const authCtx = await ks.authenticate(relay.token)

      expectGranted(
        await accessChecker.checkAccess({
          principal: authCtx.principal,
          grant: appGrant(authCtx),
          nodeId: 'M1',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
    })

    it('compact encoding handles scope restriction', async () => {
      const { kernelService: ks, sdk: s, accessChecker } = createEncodedSetup('compact')
      const ctx = await ctxForUserWith(ks, s, 'user1')

      const relay = await ctx.mintRelay({ scopes: [{ nodes: ['workspace-1'] }] })
      const authCtx = await ks.authenticate(relay.token)

      expectGranted(
        await accessChecker.checkAccess({
          principal: authCtx.principal,
          grant: appGrant(authCtx),
          nodeId: 'M1',
          nodePerm: READ,
          typePerm: USE,
        }),
      )

      expectDeniedByResource(
        await accessChecker.checkAccess({
          principal: authCtx.principal,
          grant: appGrant(authCtx),
          nodeId: 'M3',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
    })

    it('binary encoding handles union composition', async () => {
      const { kernelService: ks, sdk: s, accessChecker } = createEncodedSetup('binary')
      const ctx1 = await ctxForUserWith(ks, s, 'user1')
      const ctx2 = await ctxForUserWith(ks, s, 'role1')

      const composed = ctx1.compose(ctx2, 'union')
      const relay = await composed.mintRelay()
      const authCtx = await ks.authenticate(relay.token)

      // Union of USER1 + ROLE1 → edit on M3 (ROLE1 has edit on ws2)
      expectGranted(
        await accessChecker.checkAccess({
          principal: authCtx.principal,
          grant: appGrant(authCtx),
          nodeId: 'M3',
          nodePerm: EDIT,
          typePerm: USE,
        }),
      )
    })

    it('round-trips with dedup binary encoding', async () => {
      const {
        kernelService: ks,
        sdk: s,
        accessChecker,
      } = createEncodedSetup('binary', { dedup: true })
      const ctx1 = await ctxForUserWith(ks, s, 'user1')
      const ctx2 = await ctxForUserWith(ks, s, 'role1')

      const composed = ctx1.compose(ctx2, 'union')
      const relay = await composed.mintRelay()
      const authCtx = await ks.authenticate(relay.token)

      expectGranted(
        await accessChecker.checkAccess({
          principal: authCtx.principal,
          grant: appGrant(authCtx),
          nodeId: 'M1',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
    })
  })
})
