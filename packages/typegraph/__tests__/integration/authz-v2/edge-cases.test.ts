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
} from './setup'
import { createAccessChecker } from './access-checker'
import {
  createIdentityEvaluator,
  CycleDetectedError,
  InvalidIdentityError,
} from './identity-evaluator'
import { expectGranted, identity } from './helpers'

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
      // Create identity that points to itself
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'CYCLE_SELF' },
      })
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $id})
         CREATE (i)-[:unionWith]->(i)`,
        { params: { id: 'CYCLE_SELF' } },
      )

      const evaluator = createIdentityEvaluator(ctx.executor)

      await expect(evaluator.evalIdentity('CYCLE_SELF')).rejects.toThrow(CycleDetectedError)
    })

    it('detects indirect cycle (A -> B -> A)', async () => {
      // Create cyclic identities
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'CYCLE_A' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'CYCLE_B' },
      })

      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: $aId}), (b:Identity {id: $bId})
         CREATE (a)-[:unionWith]->(b)`,
        { params: { aId: 'CYCLE_A', bId: 'CYCLE_B' } },
      )
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: $aId}), (b:Identity {id: $bId})
         CREATE (b)-[:unionWith]->(a)`,
        { params: { aId: 'CYCLE_A', bId: 'CYCLE_B' } },
      )

      const evaluator = createIdentityEvaluator(ctx.executor)

      await expect(evaluator.evalIdentity('CYCLE_A')).rejects.toThrow(CycleDetectedError)
    })

    it('allows diamond pattern (A -> B, A -> C, B -> D, C -> D)', async () => {
      // Create diamond pattern
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

      // Add perms to D so it's a valid leaf
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'DIAMOND_D', moduleId: 'M1' } },
      )

      // A -> B, A -> C
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'DIAMOND_A'}), (b:Identity {id: 'DIAMOND_B'})
         CREATE (a)-[:unionWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'DIAMOND_A'}), (c:Identity {id: 'DIAMOND_C'})
         CREATE (a)-[:unionWith]->(c)`,
      )

      // B -> D, C -> D
      await ctx.connection.graph.query(
        `MATCH (b:Identity {id: 'DIAMOND_B'}), (d:Identity {id: 'DIAMOND_D'})
         CREATE (b)-[:unionWith]->(d)`,
      )
      await ctx.connection.graph.query(
        `MATCH (c:Identity {id: 'DIAMOND_C'}), (d:Identity {id: 'DIAMOND_D'})
         CREATE (c)-[:unionWith]->(d)`,
      )

      const evaluator = createIdentityEvaluator(ctx.executor)

      // Should not throw - diamond is allowed
      const expr = await evaluator.evalIdentity('DIAMOND_A')
      expect(expr).toBeDefined()
    })

    it('returns base expression for leaf identity (no composition)', async () => {
      // Create an isolated identity with no permissions and no composition edges
      // This is valid - it just won't match any permissions when evaluated
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'ISOLATED' },
      })

      const evaluator = createIdentityEvaluator(ctx.executor)

      // Leaf nodes (no composition) return a base expression
      const expr = await evaluator.evalIdentity('ISOLATED')
      expect(expr).toEqual({ kind: 'base', id: 'ISOLATED' })
    })

    it('denies access for identity without permissions', async () => {
      // Create an isolated identity with no permissions
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'NO_PERMS' },
      })

      const checker = createAccessChecker(ctx.executor)

      // Access check should deny because NO_PERMS has no permissions
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identity('NO_PERMS')],
        'M1',
        'read',
      )

      expect(result.granted).toBe(false)
      expect(result.reason).toBe('target')
    })
  })

  // ===========================================================================
  // DEEP HIERARCHY
  // ===========================================================================

  describe('Deep Hierarchy', () => {
    it('handles 15-level deep hierarchy within FalkorDB limits', async () => {
      // Create 15-level deep hierarchy
      let parentId = 'workspace-1'

      for (let i = 1; i <= 15; i++) {
        const nodeId = `DEEP_${i}`
        await ctx.connection.graph.query('CREATE (m:Node:Module {id: $id, name: $name})', {
          params: { id: nodeId, name: `Deep ${i}` },
        })
        await ctx.connection.graph.query(
          `MATCH (child:Module {id: $childId}), (parent:Node {id: $parentId})
           CREATE (child)-[:hasParent]->(parent)`,
          { params: { childId: nodeId, parentId } },
        )
        // Assign type
        await ctx.connection.graph.query(
          `MATCH (m:Module {id: $moduleId}), (t:Type {id: $typeId})
           CREATE (m)-[:ofType]->(t)`,
          { params: { moduleId: nodeId, typeId: 'T1' } },
        )
        parentId = nodeId
      }

      const checker = createAccessChecker(ctx.executor)

      // Permission on workspace-1 should inherit to deepest node
      // USER1 has edit on workspace-1
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identity('USER1')],
        'DEEP_15',
        'edit',
      )

      expectGranted(result)
    })
  })

  // ===========================================================================
  // IDENTITY WITHOUT DIRECT PERMS
  // ===========================================================================

  describe('Identity Without Direct Perms', () => {
    it('handles identity with only union composition', async () => {
      // Create identity with no direct perms, only unionWith
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'UNION_ONLY' },
      })
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'UNION_ONLY'}), (r:Identity {id: 'ROLE1'})
         CREATE (u)-[:unionWith]->(r)`,
      )

      const checker = createAccessChecker(ctx.executor)

      // UNION_ONLY -> ROLE1 -> edit on workspace-2
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identity('UNION_ONLY')],
        'M3',
        'edit',
      )

      expectGranted(result)
    })

    it('handles identity with only intersect composition', async () => {
      // X already has intersectWith A and B
      const checker = createAccessChecker(ctx.executor)

      // X = A ∩ B, should have read on M1
      const result = await checker.hasAccess([identity('APP1')], [identity('X')], 'M1', 'read')

      expectGranted(result)
    })
  })

  // ===========================================================================
  // CACHING
  // ===========================================================================

  describe('Caching', () => {
    it('produces consistent results across multiple calls with same identity', async () => {
      const checker = createAccessChecker(ctx.executor)

      // Make multiple calls with same identity - results should be consistent
      const result1 = await checker.hasAccess([identity('APP1')], [identity('USER1')], 'M1', 'read')
      const result2 = await checker.hasAccess([identity('APP1')], [identity('USER1')], 'M2', 'read')
      const result3 = await checker.hasAccess([identity('APP1')], [identity('USER1')], 'M3', 'read')

      // All calls should succeed (USER1 has read on root, inherited by all modules)
      expectGranted(result1)
      expectGranted(result2)
      expectGranted(result3)

      // Verify type cache: all modules have same type T1
      const result4 = await checker.hasAccess(
        [identity('APP1')],
        [identity('USER1')],
        'M1',
        'edit', // Different permission, same target
      )
      expectGranted(result4) // USER1 has edit on workspace-1, M1 inherits
    })

    it('clears cache when requested', async () => {
      const checker = createAccessChecker(ctx.executor)

      await checker.hasAccess([identity('APP1')], [identity('USER1')], 'M1', 'read')

      // Clear cache
      checker.clearCache()

      // Should still work after cache clear
      const result = await checker.hasAccess([identity('APP1')], [identity('USER1')], 'M1', 'read')

      expectGranted(result)
    })
  })

  // ===========================================================================
  // TYPE PERMISSION
  // ===========================================================================

  describe('Type Permission', () => {
    it('denies module access when app lacks use on type', async () => {
      // Create APP2 without use permission on T1
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'APP2' },
      })

      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP2')], // APP2 has no use on T1
        [identity('USER1')],
        'M1',
        'read',
      )

      expect(result.granted).toBe(false)
      expect(result.reason).toBe('type')
    })

    it('allows module access when app has use on type', async () => {
      const checker = createAccessChecker(ctx.executor)

      const result = await checker.hasAccess(
        [identity('APP1')], // APP1 has use on T1
        [identity('USER1')],
        'M1',
        'read',
      )

      expectGranted(result)
    })
  })
})
