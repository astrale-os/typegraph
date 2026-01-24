/**
 * AUTH_V2 Integration Tests: Access Check
 *
 * Tests the hasAccess() function against a real FalkorDB instance.
 * Based on the test matrix in AUTH_V2.md
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  setupAuthzTest,
  teardownAuthzTest,
  clearDatabase,
  seedAuthzTestData,
  type AuthzTestContext,
} from './setup'
import { createAccessChecker } from './access-checker'
import { expectGranted, expectDeniedByType, expectDeniedByTarget, identity } from './helpers'

describe('AUTH_V2: Access Check', () => {
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
  // BASIC TWO-KEY ACCESS
  // ===========================================================================

  describe('Basic Two-Key Access', () => {
    it('Test #1: grants access when both type and target identities have permissions', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess([identity('APP1')], [identity('USER1')], 'M1', 'read')

      expectGranted(result)
    })

    it('Test #2: denies access when type identity is missing', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [], // No type identities
        [identity('USER1')],
        'M1',
        'read',
      )

      expectDeniedByType(result)
    })

    it('Test #3: denies access when target identity is missing', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP1')],
        [], // No target identities
        'M1',
        'read',
      )

      expectDeniedByTarget(result)
    })

    it('denies access when target identity lacks the permission', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 has read and edit permissions, but not 'admin'
      // This tests that the target check fails for non-existent permissions
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identity('USER1')],
        'M1',
        'admin', // Permission that USER1 doesn't have
      )

      expectDeniedByTarget(result)
    })

    it('denies access when type identity lacks use permission', async () => {
      // Create an identity without use permission on any type
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP_NO_USE' },
      })

      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP_NO_USE')], // Has no 'use' permission on T1
        [identity('USER1')],
        'M1',
        'read',
      )

      expectDeniedByType(result)
    })
  })

  // ===========================================================================
  // SINGLE-KEY ACCESS (Non-Module Targets)
  // ===========================================================================

  describe('Single-Key Access', () => {
    it('Test #11: grants read access to Identity target without type check', async () => {
      const checker = createAccessChecker(ctx.executor)

      // Single-key access test: Identity targets don't require type check (empty typeIdentities)
      // Identity nodes don't have hasParent edges, so they can't inherit permissions from root.
      // For Identity targets, direct permission on the identity itself is required.
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(i)`,
        { params: { identityId: 'USER1' } },
      )

      const result = await checker.hasAccess(
        [], // No type identities needed for non-Module targets
        [identity('USER1')],
        'USER1', // Target is the Identity itself
        'read',
      )

      expectGranted(result)
    })

    it('Test #12: grants read access to Space target without type check', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [], // No type identities needed
        [identity('USER1')],
        'workspace-1',
        'read',
      )

      // USER1 has read on root, workspace-1 inherits from root
      expectGranted(result)
    })
  })

  // ===========================================================================
  // PERMISSION INHERITANCE
  // ===========================================================================

  describe('Permission Inheritance', () => {
    it('inherits read permission from root to module', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 has read on root, should have read on M1 (via inheritance)
      const result = await checker.hasAccess([identity('APP1')], [identity('USER1')], 'M1', 'read')

      expectGranted(result)
    })

    it('inherits edit permission from workspace to module', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 has edit on workspace-1, should have edit on M1
      const result = await checker.hasAccess([identity('APP1')], [identity('USER1')], 'M1', 'edit')

      expectGranted(result)
    })
  })

  // ===========================================================================
  // MULTIPLE IDENTITIES (OR SEMANTICS)
  // ===========================================================================

  describe('Multiple Identities (OR Semantics)', () => {
    it('grants when ANY type identity has use permission', async () => {
      // Create APP_NO_USE without use permission
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP_NO_USE2' },
      })

      const checker = createAccessChecker(ctx.executor)

      // APP_NO_USE2 lacks 'use', but APP1 has it - should grant via OR
      const result = await checker.hasAccess(
        [identity('APP_NO_USE2'), identity('APP1')], // First lacks, second has
        [identity('USER1')],
        'M1',
        'read',
      )

      expectGranted(result)
    })

    it('denies when ALL type identities lack use permission', async () => {
      // Create two identities without use permission
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP_NO_USE_A' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP_NO_USE_B' },
      })

      const checker = createAccessChecker(ctx.executor)

      // Both lack 'use' - should deny
      const result = await checker.hasAccess(
        [identity('APP_NO_USE_A'), identity('APP_NO_USE_B')],
        [identity('USER1')],
        'M1',
        'read',
      )

      expectDeniedByType(result)
    })

    it('grants when ANY target identity has permission', async () => {
      // Create USER_NO_PERM without any permissions
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'USER_NO_PERM' },
      })

      const checker = createAccessChecker(ctx.executor)

      // USER_NO_PERM lacks read, but USER1 has it - should grant via OR
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identity('USER_NO_PERM'), identity('USER1')], // First lacks, second has
        'M1',
        'read',
      )

      expectGranted(result)
    })

    it('denies when ALL target identities lack permission', async () => {
      // Create two identities without any permissions
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'USER_NO_PERM_A' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'USER_NO_PERM_B' },
      })

      const checker = createAccessChecker(ctx.executor)

      // Both lack any permissions - should deny
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identity('USER_NO_PERM_A'), identity('USER_NO_PERM_B')],
        'M1',
        'read',
      )

      expectDeniedByTarget(result)
    })
  })

  // ===========================================================================
  // NON-EXISTENT NODE HANDLING
  // ===========================================================================

  describe('Non-Existent Node Handling', () => {
    it('denies access to non-existent module (target not found)', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP1')],
        [identity('USER1')],
        'NONEXISTENT_MODULE',
        'read',
      )

      // Non-existent target returns denied by target (no permissions found)
      expectDeniedByTarget(result)
    })

    it('throws IdentityNotFoundError when type identity does not exist', async () => {
      const checker = createAccessChecker(ctx.executor)

      // Non-existent identities throw IdentityNotFoundError
      await expect(
        checker.hasAccess([identity('NONEXISTENT_APP')], [identity('USER1')], 'M1', 'read'),
      ).rejects.toThrow('Identity not found: NONEXISTENT_APP')
    })

    it('throws IdentityNotFoundError when target identity does not exist', async () => {
      const checker = createAccessChecker(ctx.executor)

      // Non-existent identities throw IdentityNotFoundError
      await expect(
        checker.hasAccess([identity('APP1')], [identity('NONEXISTENT_USER')], 'M1', 'read'),
      ).rejects.toThrow('Identity not found: NONEXISTENT_USER')
    })
  })
})
