/**
 * AUTH_V2 Integration Tests: Scope Filtering
 *
 * Tests scope restrictions (nodes and perms) on permission checks.
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
import {
  expectGranted,
  expectDeniedByTarget,
  identity,
  identityWithNodeScope,
  identityWithPermScope,
  identityWithScopes,
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
    it('Test #4: grants access when target is within node scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithNodeScope('USER1', ['workspace-1'])],
        'M1', // M1 is in workspace-1
        'read',
      )

      expectGranted(result)
    })

    it('Test #5: denies access when target is outside node scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithNodeScope('USER1', ['workspace-1'])],
        'M3', // M3 is in workspace-2, outside scope
        'read',
      )

      expectDeniedByTarget(result)
    })
  })

  // ===========================================================================
  // PERMISSION SCOPES
  // ===========================================================================

  describe('Permission Scopes', () => {
    it('Test #6: grants access when permission is within perm scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithPermScope('USER1', ['read'])],
        'M1',
        'read',
      )

      expectGranted(result)
    })

    it('Test #7: denies access when permission is outside perm scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithPermScope('USER1', ['read'])],
        'M1',
        'edit', // edit not in scope
      )

      expectDeniedByTarget(result)
    })
  })

  // ===========================================================================
  // MULTIPLE SCOPES
  // ===========================================================================

  describe('Multiple Scopes', () => {
    it('Test #8: grants access via multi-scope OR (read in ws2)', async () => {
      const checker = createAccessChecker(ctx.executor)

      // scopes: [
      //   { nodes: ['workspace-1'], perms: ['read', 'edit'] },
      //   { nodes: ['workspace-2'], perms: ['read'] }
      // ]
      const result = await checker.hasAccess(
        [identity('APP1')],
        [
          identityWithScopes('USER1', [
            fullScope(['workspace-1'], ['read', 'edit']),
            fullScope(['workspace-2'], ['read']),
          ]),
        ],
        'M3', // M3 is in workspace-2
        'read',
      )

      expectGranted(result)
    })

    it('Test #9: denies access when no scope matches (edit in ws2)', async () => {
      const checker = createAccessChecker(ctx.executor)

      // scopes: [
      //   { nodes: ['workspace-1'], perms: ['read', 'edit'] },
      //   { nodes: ['workspace-2'], perms: ['read'] }
      // ]
      const result = await checker.hasAccess(
        [identity('APP1')],
        [
          identityWithScopes('USER1', [
            fullScope(['workspace-1'], ['read', 'edit']),
            fullScope(['workspace-2'], ['read']),
          ]),
        ],
        'M3', // M3 is in workspace-2
        'edit', // edit not allowed in workspace-2 scope
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

      const result = await checker.hasAccess(
        [identity('APP1')],
        [{ identityId: 'USER1', scopes: [] }], // Empty scopes = unrestricted
        'M1',
        'read',
      )

      expectGranted(result)
    })

    it('treats undefined scopes as unrestricted', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP1')],
        [identity('USER1')], // No scopes = unrestricted
        'M1',
        'read',
      )

      expectGranted(result)
    })

    it('allows any perm when scope has empty perms array', async () => {
      const checker = createAccessChecker(ctx.executor)

      // Scope with only node restriction
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithScopes('USER1', [{ nodes: ['workspace-1'] }])],
        'M1',
        'edit',
      )

      expectGranted(result)
    })
  })

  // ===========================================================================
  // SCOPE + COMPOSITION
  // ===========================================================================

  describe('Scope with Identity Composition', () => {
    it('applies scope to identity with union composition', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 unionWith ROLE1
      // Applying node scope to USER1 should restrict both USER1 and ROLE1's contributions
      // USER1 has edit on workspace-1
      // ROLE1 has edit on workspace-2
      // With scope restricted to workspace-1, only USER1's permissions apply
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithNodeScope('USER1', ['workspace-1'])],
        'M3', // M3 is in workspace-2
        'edit',
      )

      // Even though ROLE1 (via union) has edit on M3,
      // the scope restricts to workspace-1, so M3 is outside scope
      expectDeniedByTarget(result)
    })

    it('grants access via union when scope includes target workspace', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 unionWith ROLE1
      // Scope includes workspace-2, so ROLE1's permissions can apply
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithNodeScope('USER1', ['workspace-2'])],
        'M3', // M3 is in workspace-2
        'edit',
      )

      // ROLE1 has edit on workspace-2, and scope includes workspace-2
      expectGranted(result)
    })

    it('applies scope to identity with intersection composition', async () => {
      // X = A ∩ B
      // A has read on M1, M2 (both in workspace-1)
      // B has read on M1 only
      // X should have read on M1 (both A and B have it)
      // With scope restricted to workspace-1, X can access M1
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithNodeScope('X', ['workspace-1'])],
        'M1',
        'read',
      )

      expectGranted(result)
    })

    it('denies when scope excludes intersection result', async () => {
      // X = A ∩ B has read on M1 (in workspace-1)
      // With scope restricted to workspace-2, M1 is outside scope
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithNodeScope('X', ['workspace-2'])],
        'M1', // M1 is in workspace-1, outside scope
        'read',
      )

      expectDeniedByTarget(result)
    })

    it('applies perm scope to intersection composition', async () => {
      // X = A ∩ B has read on M1
      // With perm scope restricted to 'read', should grant
      const checker = createAccessChecker(ctx.executor)

      const resultRead = await checker.hasAccess(
        [identity('APP1')],
        [identityWithPermScope('X', ['read'])],
        'M1',
        'read',
      )
      expectGranted(resultRead)

      // With perm scope restricted to 'edit', should deny (X doesn't have edit)
      const resultEdit = await checker.hasAccess(
        [identity('APP1')],
        [identityWithPermScope('X', ['edit'])],
        'M1',
        'edit',
      )
      expectDeniedByTarget(resultEdit)
    })
  })

  // ===========================================================================
  // COMPLEX NODE + PERM SCOPE COMBINATIONS
  // ===========================================================================

  describe('Complex Scope Combinations', () => {
    it('applies both node and perm restrictions simultaneously', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 has read on root, edit on workspace-1
      // Scope: nodes=[workspace-1], perms=[read]
      // This restricts to workspace-1 AND only read permission
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithScopes('USER1', [fullScope(['workspace-1'], ['read'])])],
        'M1',
        'read',
      )

      expectGranted(result)
    })

    it('denies when perm is outside scope even if node is in scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 has edit on workspace-1
      // Scope: nodes=[workspace-1], perms=[read]
      // M1 is in scope (workspace-1), but edit is not in perm scope
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithScopes('USER1', [fullScope(['workspace-1'], ['read'])])],
        'M1',
        'edit', // edit not in perm scope
      )

      expectDeniedByTarget(result)
    })

    it('denies when node is outside scope even if perm is in scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 has read on root (inherited to all)
      // Scope: nodes=[workspace-1], perms=[read]
      // M3 is in workspace-2 (outside node scope), even though read is in perm scope
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identityWithScopes('USER1', [fullScope(['workspace-1'], ['read'])])],
        'M3', // M3 is in workspace-2, outside node scope
        'read',
      )

      expectDeniedByTarget(result)
    })
  })
})
