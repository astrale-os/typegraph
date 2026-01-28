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
} from './setup'
import { createAccessChecker } from './access-checker'
import { IdentityEvaluator } from './identity-evaluator'
import {
  grant,
  identity,
  expectGranted,
  expectDeniedByTarget,
  nodeScope,
  permScope,
  fullScope,
} from './helpers'

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

      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [nodeScope(['workspace-1'])])),
        'M1', // M1 is in workspace-1
        'read',
        'principal',
      )

      expectGranted(result)
    })

    it('denies when target is outside node scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [nodeScope(['workspace-1'])])),
        'M3', // M3 is in workspace-2
        'read',
        'principal',
      )

      expectDeniedByTarget(result)
    })
  })

  // ===========================================================================
  // PERMISSION SCOPES
  // ===========================================================================

  describe('Permission Scopes', () => {
    it('grants when permission is within perm scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [permScope(['read'])])),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)
    })

    it('denies when permission is outside perm scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [permScope(['read'])])),
        'M1',
        'edit', // edit not in scope
        'principal',
      )

      expectDeniedByTarget(result)
    })
  })

  // ===========================================================================
  // MULTIPLE SCOPES (OR)
  // ===========================================================================

  describe('Multiple Scopes', () => {
    it('grants via multi-scope OR', async () => {
      const checker = createAccessChecker(ctx.executor)

      // Two scopes: ws1+read/edit OR ws2+read
      const result = await checker.checkAccess(
        grant(
          identity('APP1'),
          identity('USER1', [
            fullScope(['workspace-1'], ['read', 'edit']),
            fullScope(['workspace-2'], ['read']),
          ]),
        ),
        'M3', // M3 is in workspace-2
        'read',
        'principal',
      )

      expectGranted(result)
    })

    it('denies when no scope matches', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        grant(
          identity('APP1'),
          identity('USER1', [
            fullScope(['workspace-1'], ['read', 'edit']),
            fullScope(['workspace-2'], ['read']),
          ]),
        ),
        'M3', // M3 is in workspace-2
        'edit', // edit not allowed in workspace-2 scope
        'principal',
      )

      expectDeniedByTarget(result)
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Scope Edge Cases', () => {
    it('treats empty scopes array as unrestricted', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [])),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)
    })

    it('treats undefined scopes as unrestricted', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1')),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)
    })

    it('allows any perm when scope has empty perms array', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [{ nodes: ['workspace-1'] }])),
        'M1',
        'edit',
        'principal',
      )

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
      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [nodeScope(['workspace-1'])])),
        'M1', // M1 is in workspace-1
        'edit',
        'principal',
      )

      expectGranted(result)
    })

    it('denies when scope excludes target workspace', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 has edit on workspace-1
      // With scope restricted to workspace-2, USER1 cannot access M1
      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [nodeScope(['workspace-2'])])),
        'M1', // M1 is in workspace-1, but scope is workspace-2
        'edit',
        'principal',
      )

      expectDeniedByTarget(result)
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
      const result = await checker.checkAccess(
        grant(identity('APP1'), xExpr),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)
    })

    it('denies when intersection result lacks permission', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B
      // A has read on M2, B does not
      // X should NOT have read on M2
      const xExpr = await evaluator.evalIdentity('X')

      const result = await checker.checkAccess(
        grant(identity('APP1'), xExpr),
        'M2',
        'read',
        'principal',
      )

      expectDeniedByTarget(result)
    })
  })

  // ===========================================================================
  // COMPLEX SCOPE COMBINATIONS
  // ===========================================================================

  describe('Complex Scope Combinations', () => {
    it('applies both node and perm restrictions', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [fullScope(['workspace-1'], ['read'])])),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)
    })

    it('denies when perm is outside scope even if node is in scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [fullScope(['workspace-1'], ['read'])])),
        'M1',
        'edit', // edit not in perm scope
        'principal',
      )

      expectDeniedByTarget(result)
    })

    it('denies when node is outside scope even if perm is in scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        grant(identity('APP1'), identity('USER1', [fullScope(['workspace-1'], ['read'])])),
        'M3', // M3 is in workspace-2
        'read',
        'principal',
      )

      expectDeniedByTarget(result)
    })
  })
})
