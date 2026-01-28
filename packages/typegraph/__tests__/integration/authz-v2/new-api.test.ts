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
} from './testing/setup'
import { createAccessChecker } from './adapter'
import { IdentityEvaluator } from './adapter/identity-evaluator'
import {
  grant,
  grantFromIds,
  identity,
  identities,
  union,
  expectGranted,
  expectDeniedByType,
  expectDeniedByResource,
  principalScope,
  permScope,
} from './testing/helpers'

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

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })

    it('denies access when type identity is missing', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds([], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectDeniedByType(result)
    })

    it('denies access when target identity is missing', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], []),
        nodeId: 'M1',
        perm: 'read',
      })

      expectDeniedByResource(result)
    })

    it('denies access when type identity lacks use permission', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP_NO_USE' },
      })

      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP_NO_USE'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectDeniedByType(result)
    })

    it('denies access when target identity lacks permission', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'admin', // Permission USER1 doesn't have
      })

      expectDeniedByResource(result)
    })

    it('grants access with multiple identities (OR semantics)', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP_NO_USE2' },
      })

      const checker = createAccessChecker(ctx.executor)

      // APP_NO_USE2 lacks 'use', but APP1 has it
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP_NO_USE2', 'APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })

    it('skips type check for non-typed targets', async () => {
      const checker = createAccessChecker(ctx.executor)

      // workspace-1 has no type, so type check is skipped
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds([], ['USER1']), // No type identities needed
        nodeId: 'workspace-1',
        perm: 'read',
      })

      expectGranted(result)

      // Verify via explainAccess that type check was actually skipped
      // When target has no type, typeCheck.query is 'true' (always passes)
      const explanation = await checker.explainAccess({
        principal: 'principal',
        grant: grantFromIds([], ['USER1']),
        nodeId: 'workspace-1',
        perm: 'read',
      })
      // Type check skipped because workspace-1 has no type
      expect(explanation.typeCheck.query).toBe('true')
      expect(explanation.typeCheck.leaves).toHaveLength(0)
    })
  })

  // ===========================================================================
  // explainAccess (Cold Path)
  // ===========================================================================

  describe('explainAccess (Cold Path)', () => {
    it('returns detailed explanation for granted access', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.explainAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)

      // Type check should have at least one granted leaf
      expect(result.typeCheck.leaves.some((l) => l.status === 'granted')).toBe(true)
      expect(result.typeCheck.query).not.toBeNull()

      // Target check should have at least one granted leaf with grantedAt
      const grantedLeaf = result.resourceCheck.leaves.find((l) => l.status === 'granted')
      expect(grantedLeaf).toBeDefined()
      expect(grantedLeaf!.grantedAt).toBeDefined()
    })

    it('returns explanation with path indices for composite identities', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // USER1 has union with ROLE1, so the expression tree has branches
      const user1Expr = await evaluator.evalIdentity('USER1')

      const result = await checker.explainAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), user1Expr),
        nodeId: 'M3', // Module in workspace-2, where ROLE1 has edit
        perm: 'edit',
      })

      expectGranted(result)

      // Check that leaves have path information
      for (const leaf of result.resourceCheck.leaves) {
        expect(Array.isArray(leaf.path)).toBe(true)
        expect(leaf.identityId).toBeDefined()
      }
    })

    it('returns explanation for denied access with missing leaves', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'USER_NO_PERM' },
      })

      const checker = createAccessChecker(ctx.executor)

      const result = await checker.explainAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER_NO_PERM']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectDeniedByResource(result)

      // Target check should have missing leaf
      const missingLeaf = result.resourceCheck.leaves.find((l) => l.status === 'missing')
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
         CREATE (i)-[:hasPerm {perms: ['read']}]->(r)`,
        { params: { identityId: 'SCOPED_IDENTITY', rootId: 'root' } },
      )

      const checker = createAccessChecker(ctx.executor)

      // Test with a non-typed target (workspace) so type check is skipped
      // This isolates the principal filtering to target check only
      // Scope restricts to 'other-principal' but we pass 'some-principal'
      const result = await checker.explainAccess({
        principal: 'some-principal', // Different from the allowed principal
        grant: grant(
          identities([]),
          identity('SCOPED_IDENTITY', [principalScope(['other-principal'])]),
        ),
        nodeId: 'workspace-1', // Non-typed target
        perm: 'read',
      })

      expectDeniedByResource(result)

      // Check that leaf was filtered due to principal
      const filteredLeaf = result.resourceCheck.leaves.find((l) => l.status === 'filtered')
      expect(filteredLeaf).toBeDefined()
      expect(filteredLeaf!.filterDetail).toBeDefined()
      expect(filteredLeaf!.filterDetail!.some((f) => f.failedCheck === 'principal')).toBe(true)
    })

    it('returns explanation for filtered identity due to perm restriction', async () => {
      const checker = createAccessChecker(ctx.executor)

      // Test with a non-typed target (workspace) so type check is skipped
      // This isolates the perm filtering to target check only
      const result = await checker.explainAccess({
        principal: 'principal',
        grant: grant(
          identities([]),
          identity('USER1', [permScope(['admin'])]), // Only allow 'admin', not 'read'
        ),
        nodeId: 'workspace-1', // Non-typed target
        perm: 'read',
      })

      expectDeniedByResource(result)

      // Check that leaf was filtered due to perm
      const filteredLeaf = result.resourceCheck.leaves.find((l) => l.status === 'filtered')
      expect(filteredLeaf).toBeDefined()
      expect(filteredLeaf!.filterDetail).toBeDefined()
      expect(filteredLeaf!.filterDetail!.some((f) => f.failedCheck === 'perm')).toBe(true)
    })

    it('returns expression tree in phase explanation', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.explainAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)

      // Type check should have expression
      expect(result.typeCheck.expression).not.toBeNull()
      expect(result.typeCheck.expression!.kind).toBe('identity')

      // Target check should have expression (USER1 has union with ROLE1)
      expect(result.resourceCheck.expression).not.toBeNull()
    })

    it('returns cypher in phase explanation', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.explainAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)

      // Both phases should have query
      expect(result.typeCheck.query).not.toBeNull()
      expect(typeof result.typeCheck.query).toBe('string')
      expect(result.resourceCheck.query).not.toBeNull()
      expect(typeof result.resourceCheck.query).toBe('string')
    })

    it('handles intersect composition with correct grantedAt', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B. A has read on M1, B has read on M1
      const xExpr = await evaluator.evalIdentity('X')

      const result = await checker.explainAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), xExpr),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)

      // Both A and B should be granted with grantedAt
      const grantedLeaves = result.resourceCheck.leaves.filter((l) => l.status === 'granted')
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

      const result = await checker.explainAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), union(user1Expr, aExpr)),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)

      // With multiple identities, paths should have offsets
      // First identity tree at path [0, ...], second at [1, ...]
      const paths = result.resourceCheck.leaves.map((l) => l.path)
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

      const decision = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })
      const explanation = await checker.explainAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expect(decision.granted).toBe(explanation.granted)
      expect(decision.deniedBy).toBe(explanation.deniedBy)
    })

    it('checkAccess and explainAccess agree on denied by type', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP_NO_USE3' },
      })

      const checker = createAccessChecker(ctx.executor)

      const decision = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP_NO_USE3'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })
      const explanation = await checker.explainAccess({
        principal: 'principal',
        grant: grantFromIds(['APP_NO_USE3'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expect(decision.granted).toBe(explanation.granted)
      expect(decision.deniedBy).toBe(explanation.deniedBy)
      expect(decision.deniedBy).toBe('type')
    })

    it('checkAccess and explainAccess agree on denied by target', async () => {
      const checker = createAccessChecker(ctx.executor)

      const decision = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'admin',
      })
      const explanation = await checker.explainAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'admin',
      })

      expect(decision.granted).toBe(explanation.granted)
      expect(decision.deniedBy).toBe(explanation.deniedBy)
      expect(decision.deniedBy).toBe('resource')
    })

    it('checkAccess and explainAccess agree on intersect denial', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B
      // A has read on M2, B does NOT have read on M2
      // So X should be denied on M2
      const xExpr = await evaluator.evalIdentity('X')

      const decision = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), xExpr),
        nodeId: 'M2',
        perm: 'read',
      })
      const explanation = await checker.explainAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), xExpr),
        nodeId: 'M2',
        perm: 'read',
      })

      // Both must agree: intersect requires ALL leaves to have permission
      expect(decision.granted).toBe(explanation.granted)
      expect(decision.deniedBy).toBe(explanation.deniedBy)
      expect(decision.deniedBy).toBe('resource')
    })

    it('checkAccess and explainAccess agree on exclude denial', async () => {
      // Create E = A \ C where both A and C have read on M1
      // So E should be denied on M1 (A has perm but C also has, so excluded)
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_TEST_E' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_TEST_C' },
      })

      // C has read on M1
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'EXCLUDE_TEST_C'}), (m:Module {id: 'M1'})
         CREATE (i)-[:hasPerm {perms: ['read']}]->(m)`,
      )

      // E = A \ C
      await ctx.connection.graph.query(
        `MATCH (e:Identity {id: 'EXCLUDE_TEST_E'}), (a:Identity {id: 'A'})
         CREATE (e)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (e:Identity {id: 'EXCLUDE_TEST_E'}), (c:Identity {id: 'EXCLUDE_TEST_C'})
         CREATE (e)-[:excludeWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      const eExpr = await evaluator.evalIdentity('EXCLUDE_TEST_E')

      const decision = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), eExpr),
        nodeId: 'M1',
        perm: 'read',
      })
      const explanation = await checker.explainAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), eExpr),
        nodeId: 'M1',
        perm: 'read',
      })

      // Both must agree: exclude means left granted AND right NOT granted
      // A has read on M1, C has read on M1, so A \ C = denied
      expect(decision.granted).toBe(explanation.granted)
      expect(decision.deniedBy).toBe(explanation.deniedBy)
      expect(decision.deniedBy).toBe('resource')
    })

    it('checkAccess and explainAccess agree on node scope restrictions', async () => {
      // Regression test: cold path must respect node scope restrictions
      // USER1 has read on root, but identity is scoped to workspace-2 nodes only
      // Should be denied because target M1 is under workspace-1, not workspace-2

      const checker = createAccessChecker(ctx.executor)

      // Create scoped identity that only allows access within workspace-2
      const scopedExpr = identity('USER1', { nodes: ['workspace-2'] })

      const decision = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), scopedExpr),
        nodeId: 'M1', // M1 is under workspace-1, not workspace-2
        perm: 'read',
      })
      const explanation = await checker.explainAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), scopedExpr),
        nodeId: 'M1',
        perm: 'read',
      })

      // Both must agree: node scope restriction should deny access
      expect(decision.granted).toBe(explanation.granted)
      expect(decision.deniedBy).toBe(explanation.deniedBy)
      expect(decision.granted).toBe(false)
      expect(decision.deniedBy).toBe('resource')
    })

    it('checkAccess and explainAccess agree on matching node scope', async () => {
      // USER1 has read on root, identity scoped to workspace-1 nodes - should be granted
      // M1 is under workspace-1, so scope is satisfied
      const checker = createAccessChecker(ctx.executor)

      const scopedExpr = identity('USER1', { nodes: ['workspace-1'] })

      const decision = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), scopedExpr),
        nodeId: 'M1', // M1 is under workspace-1
        perm: 'read',
      })
      const explanation = await checker.explainAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), scopedExpr),
        nodeId: 'M1',
        perm: 'read',
      })

      // Both must agree: node scope matches, should be granted
      expect(decision.granted).toBe(explanation.granted)
      expect(decision.deniedBy).toBe(explanation.deniedBy)
      expect(decision.granted).toBe(true)
    })
  })

  // ===========================================================================
  // Input Validation (Security)
  // ===========================================================================

  describe('Input Validation', () => {
    it('rejects malformed resourceId', async () => {
      const checker = createAccessChecker(ctx.executor)

      await expect(
        checker.checkAccess({
          principal: 'principal',
          grant: grantFromIds(['APP1'], ['USER1']),
          nodeId: "M1' OR 1=1 --", // Cypher injection attempt
          perm: 'read',
        }),
      ).rejects.toThrow('Invalid resourceId')
    })

    it('rejects malformed perm', async () => {
      const checker = createAccessChecker(ctx.executor)

      await expect(
        checker.checkAccess({
          principal: 'principal',
          grant: grantFromIds(['APP1'], ['USER1']),
          nodeId: 'M1',
          perm: "read'}]-() RETURN 1 --", // Cypher injection attempt
        }),
      ).rejects.toThrow('Invalid perm')
    })

    it('rejects malformed identity ID in expression', async () => {
      const checker = createAccessChecker(ctx.executor)

      await expect(
        checker.checkAccess({
          principal: 'principal',
          grant: grant(identity('APP1'), identity("USER1'}]-()")), // Injection in expr
          nodeId: 'M1',
          perm: 'read',
        }),
      ).rejects.toThrow('Invalid identity ID')
    })

    it('rejects malformed node ID in scope', async () => {
      const checker = createAccessChecker(ctx.executor)

      await expect(
        checker.checkAccess({
          principal: 'principal',
          grant: grant(identity('APP1'), identity('USER1', { nodes: ["WS1'}]-()"] })),
          nodeId: 'M1',
          perm: 'read',
        }),
      ).rejects.toThrow('Invalid scope node ID')
    })

    it('accepts valid IDs with hyphens and colons', async () => {
      const checker = createAccessChecker(ctx.executor)

      // These should not throw - valid ID formats
      await expect(
        checker.checkAccess({
          principal: 'some-principal-id:v1',
          grant: grantFromIds(['APP1'], ['USER1']),
          nodeId: 'M1',
          perm: 'read',
        }),
      ).resolves.toBeDefined()
    })
  })
})
