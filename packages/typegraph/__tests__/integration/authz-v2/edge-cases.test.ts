/**
 * AUTH_V2 Integration Tests: Edge Cases
 *
 * Tests error handling, cycles, deep hierarchy, and other edge cases.
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
import {
  IdentityEvaluator,
  CycleDetectedError,
  InvalidIdentityError,
} from './adapter/identity-evaluator'
import {
  expectGranted,
  expectDeniedByResource,
  expectDeniedByType,
  grantFromIds,
  identity,
  grant,
} from './testing/helpers'

describe('AUTH_V2: Edge Cases', () => {
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
  // CYCLE DETECTION
  // ===========================================================================

  describe('Cycle Detection', () => {
    it('detects direct cycle (A -> A)', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'CYCLE_SELF' },
      })
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $id}) CREATE (i)-[:unionWith]->(i)`,
        { params: { id: 'CYCLE_SELF' } },
      )

      const evaluator = new IdentityEvaluator(ctx.executor)
      await expect(evaluator.evalIdentity('CYCLE_SELF')).rejects.toThrow(CycleDetectedError)
    })

    it('detects indirect cycle (A -> B -> A)', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'CYCLE_A' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'CYCLE_B' },
      })

      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'CYCLE_A'}), (b:Identity {id: 'CYCLE_B'}) CREATE (a)-[:unionWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'CYCLE_A'}), (b:Identity {id: 'CYCLE_B'}) CREATE (b)-[:unionWith]->(a)`,
      )

      const evaluator = new IdentityEvaluator(ctx.executor)
      await expect(evaluator.evalIdentity('CYCLE_A')).rejects.toThrow(CycleDetectedError)
    })

    it('allows diamond pattern (A -> B, A -> C, B -> D, C -> D)', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'DIAMOND_A' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'DIAMOND_B' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'DIAMOND_C' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'DIAMOND_D' },
      })

      // D has perms
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'DIAMOND_D'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perms: ['read']}]->(m)`,
      )

      // A -> B, A -> C
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'DIAMOND_A'}), (b:Identity {id: 'DIAMOND_B'}) CREATE (a)-[:unionWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'DIAMOND_A'}), (c:Identity {id: 'DIAMOND_C'}) CREATE (a)-[:unionWith]->(c)`,
      )

      // B -> D, C -> D
      await ctx.connection.graph.query(
        `MATCH (b:Identity {id: 'DIAMOND_B'}), (d:Identity {id: 'DIAMOND_D'}) CREATE (b)-[:unionWith]->(d)`,
      )
      await ctx.connection.graph.query(
        `MATCH (c:Identity {id: 'DIAMOND_C'}), (d:Identity {id: 'DIAMOND_D'}) CREATE (c)-[:unionWith]->(d)`,
      )

      const evaluator = new IdentityEvaluator(ctx.executor)
      const expr = await evaluator.evalIdentity('DIAMOND_A')
      expect(expr).toBeDefined()

      // Verify diamond resolution actually works: DIAMOND_D has read on M1,
      // accessible via both B and C branches of the diamond
      const checker = createAccessChecker(ctx.executor)
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), expr),
        nodeId: 'M1',
        perm: 'read',
      })
      expectGranted(result)
    })

    it('returns base expression for leaf identity', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'ISOLATED' },
      })

      const evaluator = new IdentityEvaluator(ctx.executor)
      const expr = await evaluator.evalIdentity('ISOLATED')
      expect(expr).toEqual({ kind: 'identity', id: 'ISOLATED' })
    })

    it('denies access for identity without permissions', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'NO_PERMS' },
      })

      const checker = createAccessChecker(ctx.executor)
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['NO_PERMS']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectDeniedByResource(result)
    })
  })

  // ===========================================================================
  // EXCLUDE EDGE CASES
  // ===========================================================================

  describe('Exclude Edge Cases', () => {
    it('detects direct exclude cycle', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_CYCLE_SELF' },
      })
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'EXCLUDE_CYCLE_SELF'}) CREATE (i)-[:excludeWith]->(i)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'EXCLUDE_CYCLE_SELF'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perms: ['read']}]->(m)`,
      )

      const evaluator = new IdentityEvaluator(ctx.executor)
      await expect(evaluator.evalIdentity('EXCLUDE_CYCLE_SELF')).rejects.toThrow(CycleDetectedError)
    })

    it('rejects exclude-only identity', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_ONLY' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_TARGET' },
      })

      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'EXCLUDE_TARGET'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perms: ['read']}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'EXCLUDE_ONLY'}), (b:Identity {id: 'EXCLUDE_TARGET'}) CREATE (a)-[:excludeWith]->(b)`,
      )

      const evaluator = new IdentityEvaluator(ctx.executor)
      await expect(evaluator.evalIdentity('EXCLUDE_ONLY')).rejects.toThrow(InvalidIdentityError)
    })
  })

  // ===========================================================================
  // DEEP HIERARCHY
  // ===========================================================================

  describe('Deep Hierarchy', () => {
    it('handles 15-level deep hierarchy', async () => {
      let parentId = 'workspace-1'

      for (let i = 1; i <= 15; i++) {
        const nodeId = `DEEP_${i}`
        await ctx.connection.graph.query('CREATE (m:Node:Module {id: $id, name: $name})', {
          params: { id: nodeId, name: `Deep ${i}` },
        })
        await ctx.connection.graph.query(
          `MATCH (child:Module {id: $childId}), (parent:Node {id: $parentId}) CREATE (child)-[:hasParent]->(parent)`,
          { params: { childId: nodeId, parentId } },
        )
        await ctx.connection.graph.query(
          `MATCH (m:Module {id: $moduleId}), (t:Type {id: 'T1'}) CREATE (m)-[:ofType]->(t)`,
          { params: { moduleId: nodeId } },
        )
        parentId = nodeId
      }

      const checker = createAccessChecker(ctx.executor)
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'DEEP_15',
        perm: 'edit',
      })

      expectGranted(result)
    })
  })

  // ===========================================================================
  // IDENTITY WITHOUT DIRECT PERMS
  // ===========================================================================

  describe('Identity Without Direct Perms', () => {
    it('handles identity with only union composition', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'UNION_ONLY' },
      })
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'UNION_ONLY'}), (r:Identity {id: 'ROLE1'}) CREATE (u)-[:unionWith]->(r)`,
      )

      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // Build expression for UNION_ONLY (which unions with ROLE1)
      const unionOnlyExpr = await evaluator.evalIdentity('UNION_ONLY')

      // UNION_ONLY inherits from ROLE1 which has edit on workspace-2
      const grantedResult = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), unionOnlyExpr),
        nodeId: 'M3',
        perm: 'edit',
      })
      expectGranted(grantedResult)

      // UNION_ONLY should NOT have access to M1 (ROLE1 has no perms on workspace-1)
      const deniedResult = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), unionOnlyExpr),
        nodeId: 'M1',
        perm: 'edit',
      })
      expectDeniedByResource(deniedResult)
    })

    it('handles identity with only intersect composition', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B (from seed data)
      const xExpr = await evaluator.evalIdentity('X')

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), xExpr),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })
  })

  // ===========================================================================
  // CACHING
  // ===========================================================================

  describe('Caching', () => {
    it('produces consistent results across multiple calls', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result1 = await checker.checkAccess({
        principal: 'p',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })
      const result2 = await checker.checkAccess({
        principal: 'p',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M2',
        perm: 'read',
      })
      const result3 = await checker.checkAccess({
        principal: 'p',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M3',
        perm: 'read',
      })

      expectGranted(result1)
      expectGranted(result2)
      expectGranted(result3)
    })

    it('clears cache when requested', async () => {
      const checker = createAccessChecker(ctx.executor)

      await checker.checkAccess({
        principal: 'p',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })
      checker.clearCache()
      const result = await checker.checkAccess({
        principal: 'p',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })
  })

  // ===========================================================================
  // TYPE PERMISSION
  // ===========================================================================

  describe('Type Permission', () => {
    it('denies module access when app lacks use on type', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP2' },
      })

      const checker = createAccessChecker(ctx.executor)
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP2'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectDeniedByType(result)
    })

    it('allows module access when app has use on type', async () => {
      const checker = createAccessChecker(ctx.executor)
      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1']),
        nodeId: 'M1',
        perm: 'read',
      })

      expectGranted(result)
    })
  })
})
