/**
 * AUTH_V2 Integration Tests: Scope Filtering
 *
 * Tests scope restrictions (nodes, perms, principals) on permission checks.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  setupAuthzTest,
  teardownAuthzTest,
  clearDatabase,
  seedAuthzTestData,
  type AuthzTestContext,
} from './testing/setup'
import { createAccessChecker } from './adapter'
import { IdentityEvaluator } from './adapter/identity-evaluator'
import {
  grant,
  identity,
  expectGranted,
  expectDeniedByResource,
  nodeScope,
  permScope,
  principalScope,
  fullScope,
} from './testing/helpers'

describe('AUTH_V2: Scope Filtering', () => {
  let ctx: AuthzTestContext

  beforeAll(async () => {
    ctx = await setupAuthzTest()
  }, 30000)

  afterAll(async () => {
    await teardownAuthzTest(ctx)
  })

  beforeEach(async () => {
    await clearDatabase(ctx.connection.graph)
    ctx.data = await seedAuthzTestData(ctx.connection.graph)
  })

  // ===========================================================================
  // NODE SCOPES
  // ===========================================================================

  describe('Node Scopes', () => {
    it('grants when target is within node scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [nodeScope(['workspace-1'])])),
        nodeId: 'M1', // M1 is in workspace-1
        perm: 'read',
      })

      expectGranted(result)
    })

    it('denies when target is outside node scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [nodeScope(['workspace-1'])])),
        nodeId: 'M3', // M3 is in workspace-2
        perm: 'read',
      })

      expectDeniedByResource(result)
    })
  })

  // ===========================================================================
  // PERMISSION SCOPES
  // ===========================================================================

  describe('Permission Scopes', () => {
    it('grants when permission is within perm scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [permScope(['read'])])),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })

    it('denies when permission is outside perm scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [permScope(['read'])])),
        nodeId: 'M1',
        perm: 'edit', // edit not in scope
      })

      expectDeniedByResource(result)
    })
  })

  // ===========================================================================
  // PRINCIPAL SCOPES
  // ===========================================================================

  describe('Principal Scopes', () => {
    it('grants when principal matches scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [principalScope(['principal'])])),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })

    it('denies when principal does not match scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'other-principal',
        grant: grant(identity('APP1'), identity('USER1', [principalScope(['principal'])])),
        nodeId: 'M1',
        perm: 'read',
      })

      expectDeniedByResource(result)
    })

    it('grants when principal matches any scope in OR', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'admin',
        grant: grant(
          identity('APP1'),
          identity('USER1', [principalScope(['user1']), principalScope(['admin'])]),
        ),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })

    it('denies when principal matches no scope in OR', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'intruder',
        grant: grant(
          identity('APP1'),
          identity('USER1', [principalScope(['user1']), principalScope(['admin'])]),
        ),
        nodeId: 'M1',
        perm: 'read',
      })

      expectDeniedByResource(result)
    })
  })

  // ===========================================================================
  // MULTIPLE SCOPES (OR)
  // ===========================================================================

  describe('Multiple Scopes', () => {
    it('grants via multi-scope OR', async () => {
      const checker = createAccessChecker(ctx.executor)

      // Two scopes: ws1+read/edit OR ws2+read
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(
          identity('APP1'),
          identity('USER1', [
            fullScope(['workspace-1'], ['read', 'edit']),
            fullScope(['workspace-2'], ['read']),
          ]),
        ),
        nodeId: 'M3', // M3 is in workspace-2
        perm: 'read',
      })

      expectGranted(result)
    })

    it('denies when no scope matches', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(
          identity('APP1'),
          identity('USER1', [
            fullScope(['workspace-1'], ['read', 'edit']),
            fullScope(['workspace-2'], ['read']),
          ]),
        ),
        nodeId: 'M3', // M3 is in workspace-2
        perm: 'edit', // edit not allowed in workspace-2 scope
      })

      expectDeniedByResource(result)
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Scope Edge Cases', () => {
    it('treats empty scopes array as unrestricted', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [])),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })

    it('treats undefined scopes as unrestricted', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1')),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })

    it('allows any perm when scope has empty perms array', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [{ nodes: ['workspace-1'] }])),
        nodeId: 'M1',
        perm: 'edit',
      })

      expectGranted(result)
    })
  })

  // ===========================================================================
  // SCOPE + COMPOSITION
  // ===========================================================================

  describe('Scope with Identity Composition', () => {
    it('applies scope to union composition', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 has edit on workspace-1 directly
      // With scope restricted to workspace-1, USER1's ws1 perms apply
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [nodeScope(['workspace-1'])])),
        nodeId: 'M1', // M1 is in workspace-1
        perm: 'edit',
      })

      expectGranted(result)
    })

    it('denies when scope excludes target workspace', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 has edit on workspace-1
      // With scope restricted to workspace-2, USER1 cannot access M1
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [nodeScope(['workspace-2'])])),
        nodeId: 'M1', // M1 is in workspace-1, but scope is workspace-2
        perm: 'edit',
      })

      expectDeniedByResource(result)
    })

    it('applies scope to evaluated expression leaves', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B (evaluated from graph)
      // A has read on M1 and M2
      // B has read on M1 only
      // X should have read on M1
      const xExpr = await evaluator.evalIdentity('X')

      // Use evaluated expression (scopes on leaves come from evalIdentity)
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), xExpr),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })

    it('denies when intersection result lacks permission', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B
      // A has read on M2, B does not
      // X should NOT have read on M2
      const xExpr = await evaluator.evalIdentity('X')

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), xExpr),
        nodeId: 'M2',
        perm: 'read',
      })

      expectDeniedByResource(result)
    })
  })

  // ===========================================================================
  // COMPLEX SCOPE COMBINATIONS
  // ===========================================================================

  describe('Complex Scope Combinations', () => {
    it('applies both node and perm restrictions', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [fullScope(['workspace-1'], ['read'])])),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })

    it('denies when perm is outside scope even if node is in scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [fullScope(['workspace-1'], ['read'])])),
        nodeId: 'M1',
        perm: 'edit', // edit not in perm scope
      })

      expectDeniedByResource(result)
    })

    it('denies when node is outside scope even if perm is in scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), identity('USER1', [fullScope(['workspace-1'], ['read'])])),
        nodeId: 'M3', // M3 is in workspace-2
        perm: 'read',
      })

      expectDeniedByResource(result)
    })
  })
})
