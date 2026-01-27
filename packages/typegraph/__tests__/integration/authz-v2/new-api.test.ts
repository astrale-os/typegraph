/**
 * AUTH_V2 Integration Tests: New API (checkAccess / explainAccess)
 *
 * Tests the new hot path (checkAccess) and cold path (explainAccess) APIs.
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
import { IdentityEvaluator } from './identity-evaluator'
import {
  subject,
  subjectFromIds,
  identity,
  identities,
  union,
  expectGranted,
  expectDeniedByType,
  expectDeniedByTarget,
  principalScope,
  permScope,
} from './helpers'

describe('AUTH_V2: New API', () => {
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
  // checkAccess (Hot Path)
  // ===========================================================================

  describe('checkAccess (Hot Path)', () => {
    it('grants access when both type and target identities have permissions', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        subjectFromIds(['APP1'], ['USER1']),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)
    })

    it('denies access when type identity is missing', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        subjectFromIds([], ['USER1']),
        'M1',
        'read',
        'principal',
      )

      expectDeniedByType(result)
    })

    it('denies access when target identity is missing', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        subjectFromIds(['APP1'], []),
        'M1',
        'read',
        'principal',
      )

      expectDeniedByTarget(result)
    })

    it('denies access when type identity lacks use permission', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP_NO_USE' },
      })

      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        subjectFromIds(['APP_NO_USE'], ['USER1']),
        'M1',
        'read',
        'principal',
      )

      expectDeniedByType(result)
    })

    it('denies access when target identity lacks permission', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess(
        subjectFromIds(['APP1'], ['USER1']),
        'M1',
        'admin', // Permission USER1 doesn't have
        'principal',
      )

      expectDeniedByTarget(result)
    })

    it('grants access with multiple identities (OR semantics)', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP_NO_USE2' },
      })

      const checker = createAccessChecker(ctx.executor)

      // APP_NO_USE2 lacks 'use', but APP1 has it
      const result = await checker.checkAccess(
        subjectFromIds(['APP_NO_USE2', 'APP1'], ['USER1']),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)
    })

    it('skips type check for non-typed targets', async () => {
      const checker = createAccessChecker(ctx.executor)

      // workspace-1 has no type, so type check is skipped
      const result = await checker.checkAccess(
        subjectFromIds([], ['USER1']), // No type identities needed
        'workspace-1',
        'read',
        'principal',
      )

      expectGranted(result)

      // Verify via explainAccess that type check was actually skipped
      // When target has no type, typeCheck.cypher is 'true' (always passes)
      const explanation = await checker.explainAccess(
        subjectFromIds([], ['USER1']),
        'workspace-1',
        'read',
        'principal',
      )
      // Type check skipped because workspace-1 has no type
      expect(explanation.typeCheck.cypher).toBe('true')
      expect(explanation.typeCheck.leaves).toHaveLength(0)
    })
  })

  // ===========================================================================
  // explainAccess (Cold Path)
  // ===========================================================================

  describe('explainAccess (Cold Path)', () => {
    it('returns detailed explanation for granted access', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.explainAccess(
        subjectFromIds(['APP1'], ['USER1']),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)

      // Type check should have at least one granted leaf
      expect(result.typeCheck.leaves.some((l) => l.status === 'granted')).toBe(true)
      expect(result.typeCheck.cypher).not.toBe('false')

      // Target check should have at least one granted leaf with grantedAt
      const grantedLeaf = result.targetCheck.leaves.find((l) => l.status === 'granted')
      expect(grantedLeaf).toBeDefined()
      expect(grantedLeaf!.grantedAt).toBeDefined()
    })

    it('returns explanation with path indices for composite identities', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // USER1 has union with ROLE1, so the expression tree has branches
      const user1Expr = await evaluator.evalIdentity('USER1')

      const result = await checker.explainAccess(
        subject(identity('APP1'), user1Expr),
        'M3', // Module in workspace-2, where ROLE1 has edit
        'edit',
        'principal',
      )

      expectGranted(result)

      // Check that leaves have path information
      for (const leaf of result.targetCheck.leaves) {
        expect(Array.isArray(leaf.path)).toBe(true)
        expect(leaf.identityId).toBeDefined()
      }
    })

    it('returns explanation for denied access with missing leaves', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'USER_NO_PERM' },
      })

      const checker = createAccessChecker(ctx.executor)

      const result = await checker.explainAccess(
        subjectFromIds(['APP1'], ['USER_NO_PERM']),
        'M1',
        'read',
        'principal',
      )

      expectDeniedByTarget(result)

      // Target check should have missing leaf
      const missingLeaf = result.targetCheck.leaves.find((l) => l.status === 'missing')
      expect(missingLeaf).toBeDefined()
      expect(missingLeaf!.identityId).toBe('USER_NO_PERM')
    })

    it('returns explanation for filtered identity due to principal restriction', async () => {
      // Create identity with principal-restricted scope
      await ctx.connection.graph.query(`CREATE (i:Node:Identity {id: $id})`, {
        params: { id: 'SCOPED_IDENTITY' },
      })
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (r:Root {id: $rootId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(r)`,
        { params: { identityId: 'SCOPED_IDENTITY', rootId: 'root' } },
      )

      const checker = createAccessChecker(ctx.executor)

      // Test with a non-typed target (workspace) so type check is skipped
      // This isolates the principal filtering to target check only
      // Scope restricts to 'other-principal' but we pass 'some-principal'
      const result = await checker.explainAccess(
        subject(identities([]), identity('SCOPED_IDENTITY', [principalScope(['other-principal'])])),
        'workspace-1', // Non-typed target
        'read',
        'some-principal', // Different from the allowed principal
      )

      expectDeniedByTarget(result)

      // Check that leaf was filtered due to principal
      const filteredLeaf = result.targetCheck.leaves.find((l) => l.status === 'filtered')
      expect(filteredLeaf).toBeDefined()
      expect(filteredLeaf!.filterDetail).toBeDefined()
      expect(filteredLeaf!.filterDetail!.some((f) => f.failedCheck === 'principal')).toBe(true)
    })

    it('returns explanation for filtered identity due to perm restriction', async () => {
      const checker = createAccessChecker(ctx.executor)

      // Test with a non-typed target (workspace) so type check is skipped
      // This isolates the perm filtering to target check only
      const result = await checker.explainAccess(
        subject(
          identities([]),
          identity('USER1', [permScope(['admin'])]), // Only allow 'admin', not 'read'
        ),
        'workspace-1', // Non-typed target
        'read',
        'principal',
      )

      expectDeniedByTarget(result)

      // Check that leaf was filtered due to perm
      const filteredLeaf = result.targetCheck.leaves.find((l) => l.status === 'filtered')
      expect(filteredLeaf).toBeDefined()
      expect(filteredLeaf!.filterDetail).toBeDefined()
      expect(filteredLeaf!.filterDetail!.some((f) => f.failedCheck === 'perm')).toBe(true)
    })

    it('returns expression tree in phase explanation', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.explainAccess(
        subjectFromIds(['APP1'], ['USER1']),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)

      // Type check should have expression
      expect(result.typeCheck.expression).not.toBeNull()
      expect(result.typeCheck.expression!.kind).toBe('identity')

      // Target check should have expression (USER1 has union with ROLE1)
      expect(result.targetCheck.expression).not.toBeNull()
    })

    it('returns cypher in phase explanation', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.explainAccess(
        subjectFromIds(['APP1'], ['USER1']),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)

      // Both phases should have cypher
      expect(result.typeCheck.cypher).toBeDefined()
      expect(result.typeCheck.cypher).not.toBe('')
      expect(result.targetCheck.cypher).toBeDefined()
      expect(result.targetCheck.cypher).not.toBe('')
    })

    it('handles intersect composition with correct grantedAt', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B. A has read on M1, B has read on M1
      const xExpr = await evaluator.evalIdentity('X')

      const result = await checker.explainAccess(
        subject(identity('APP1'), xExpr),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)

      // Both A and B should be granted with grantedAt
      const grantedLeaves = result.targetCheck.leaves.filter((l) => l.status === 'granted')
      expect(grantedLeaves.length).toBeGreaterThanOrEqual(2)

      for (const leaf of grantedLeaves) {
        expect(leaf.grantedAt).toBe('M1')
      }
    })

    it('handles multiple target identities with correct path offsets', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // Build expressions
      const user1Expr = await evaluator.evalIdentity('USER1')
      const aExpr = await evaluator.evalIdentity('A')

      const result = await checker.explainAccess(
        subject(identity('APP1'), union(user1Expr, aExpr)),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)

      // With multiple identities, paths should have offsets
      // First identity tree at path [0, ...], second at [1, ...]
      const paths = result.targetCheck.leaves.map((l) => l.path)
      const firstIdentityPaths = paths.filter((p) => p[0] === 0)
      const secondIdentityPaths = paths.filter((p) => p[0] === 1)

      expect(firstIdentityPaths.length).toBeGreaterThan(0)
      expect(secondIdentityPaths.length).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // API Consistency
  // ===========================================================================

  describe('API Consistency', () => {
    it('checkAccess and explainAccess agree on granted', async () => {
      const checker = createAccessChecker(ctx.executor)

      const decision = await checker.checkAccess(
        subjectFromIds(['APP1'], ['USER1']),
        'M1',
        'read',
        'principal',
      )
      const explanation = await checker.explainAccess(
        subjectFromIds(['APP1'], ['USER1']),
        'M1',
        'read',
        'principal',
      )

      expect(decision.granted).toBe(explanation.granted)
      expect(decision.deniedBy).toBe(explanation.deniedBy)
    })

    it('checkAccess and explainAccess agree on denied by type', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP_NO_USE3' },
      })

      const checker = createAccessChecker(ctx.executor)

      const decision = await checker.checkAccess(
        subjectFromIds(['APP_NO_USE3'], ['USER1']),
        'M1',
        'read',
        'principal',
      )
      const explanation = await checker.explainAccess(
        subjectFromIds(['APP_NO_USE3'], ['USER1']),
        'M1',
        'read',
        'principal',
      )

      expect(decision.granted).toBe(explanation.granted)
      expect(decision.deniedBy).toBe(explanation.deniedBy)
      expect(decision.deniedBy).toBe('type')
    })

    it('checkAccess and explainAccess agree on denied by target', async () => {
      const checker = createAccessChecker(ctx.executor)

      const decision = await checker.checkAccess(
        subjectFromIds(['APP1'], ['USER1']),
        'M1',
        'admin',
        'principal',
      )
      const explanation = await checker.explainAccess(
        subjectFromIds(['APP1'], ['USER1']),
        'M1',
        'admin',
        'principal',
      )

      expect(decision.granted).toBe(explanation.granted)
      expect(decision.deniedBy).toBe(explanation.deniedBy)
      expect(decision.deniedBy).toBe('target')
    })
  })
})
