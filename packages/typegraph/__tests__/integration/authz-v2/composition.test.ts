/**
 * AUTH_V2 Integration Tests: Identity Composition
 *
 * Tests unionWith and intersectWith identity composition.
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
import { expectGranted, expectDeniedByTarget, identity } from './helpers'

describe('AUTH_V2: Identity Composition', () => {
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
  // UNION (OR)
  // ===========================================================================

  describe('Union Composition', () => {
    it('Test #10: grants access via unionWith role (proves union enables access)', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 unionWith ROLE1
      // USER1 has edit on workspace-1 only (NOT workspace-2)
      // ROLE1 has edit on workspace-2
      // M3 is in workspace-2

      // First, create a fresh identity with same permissions as USER1 but WITHOUT union
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'USER1_NO_UNION' },
      })
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (r:Root {id: 'root'})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(r)`,
        { params: { identityId: 'USER1_NO_UNION' } },
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (s:Space {id: 'workspace-1'})
         CREATE (i)-[:hasPerm {perm: 'edit'}]->(s)`,
        { params: { identityId: 'USER1_NO_UNION' } },
      )

      // Verify USER1_NO_UNION (no union) CANNOT access M3 for edit
      const deniedResult = await checker.hasAccess(
        [identity('APP1')],
        [identity('USER1_NO_UNION')],
        'M3',
        'edit',
      )
      expectDeniedByTarget(deniedResult)

      // Verify USER1 (has unionWith ROLE1) CAN access M3 for edit
      const grantedResult = await checker.hasAccess(
        [identity('APP1')],
        [identity('USER1')],
        'M3',
        'edit',
      )
      expectGranted(grantedResult)
    })

    it('denies access when neither identity in union has permission', async () => {
      const checker = createAccessChecker(ctx.executor)

      // USER1 unionWith ROLE1
      // Neither USER1 nor ROLE1 has 'admin' permission anywhere
      // So USER1 ∪ ROLE1 should NOT have admin on M1
      const result = await checker.hasAccess(
        [identity('APP1')],
        [identity('USER1')],
        'M1',
        'admin', // Permission that no one has
      )

      expectDeniedByTarget(result)
    })

    it('handles 3-way union (A ∪ B ∪ C)', async () => {
      // Create identities for 3-way union
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'UNION_A' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'UNION_B' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'UNION_C' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'UNION_ABC' },
      })

      // UNION_A has edit on M1 only
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'edit'}]->(m)`,
        { params: { identityId: 'UNION_A', moduleId: 'M1' } },
      )

      // UNION_B has edit on M2 only
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'edit'}]->(m)`,
        { params: { identityId: 'UNION_B', moduleId: 'M2' } },
      )

      // UNION_C has edit on M3 only
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'edit'}]->(m)`,
        { params: { identityId: 'UNION_C', moduleId: 'M3' } },
      )

      // UNION_ABC = UNION_A ∪ UNION_B ∪ UNION_C
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'UNION_ABC'}), (a:Identity {id: 'UNION_A'})
         CREATE (u)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'UNION_ABC'}), (b:Identity {id: 'UNION_B'})
         CREATE (u)-[:unionWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'UNION_ABC'}), (c:Identity {id: 'UNION_C'})
         CREATE (u)-[:unionWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)

      // UNION_ABC should have edit on all three modules
      const resultM1 = await checker.hasAccess(
        [identity('APP1')],
        [identity('UNION_ABC')],
        'M1',
        'edit',
      )
      expectGranted(resultM1)

      const resultM2 = await checker.hasAccess(
        [identity('APP1')],
        [identity('UNION_ABC')],
        'M2',
        'edit',
      )
      expectGranted(resultM2)

      const resultM3 = await checker.hasAccess(
        [identity('APP1')],
        [identity('UNION_ABC')],
        'M3',
        'edit',
      )
      expectGranted(resultM3)
    })
  })

  // ===========================================================================
  // INTERSECTION (AND)
  // ===========================================================================

  describe('Intersection Composition', () => {
    it('Test #13: grants access when all intersected identities have permission', async () => {
      const checker = createAccessChecker(ctx.executor)

      // X = A intersect B
      // A has read on M1 and M2
      // B has read on M1 only
      // So X should have read on M1 (both A and B have it)
      const result = await checker.hasAccess([identity('APP1')], [identity('X')], 'M1', 'read')

      expectGranted(result)
    })

    it('Test #14: denies access when not all intersected identities have permission', async () => {
      const checker = createAccessChecker(ctx.executor)

      // X = A intersect B
      // A has read on M1 and M2
      // B has read on M1 only
      // So X should NOT have read on M2 (only A has it, not B)
      const result = await checker.hasAccess([identity('APP1')], [identity('X')], 'M2', 'read')

      expectDeniedByTarget(result)
    })

    it('handles 3-way intersection (A ∩ B ∩ C)', async () => {
      // Create identities for 3-way intersection
      // INTER_A has read on M1, M2
      // INTER_B has read on M1, M3
      // INTER_C has read on M1 only
      // Result: INTER_ABC should only have read on M1
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'INTER_A' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'INTER_B' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'INTER_C' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'INTER_ABC' },
      })

      // INTER_A has read on M1, M2
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'INTER_A', moduleId: 'M1' } },
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'INTER_A', moduleId: 'M2' } },
      )

      // INTER_B has read on M1, M3
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'INTER_B', moduleId: 'M1' } },
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'INTER_B', moduleId: 'M3' } },
      )

      // INTER_C has read on M1 only
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'INTER_C', moduleId: 'M1' } },
      )

      // INTER_ABC = INTER_A ∩ INTER_B ∩ INTER_C
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'INTER_ABC'}), (a:Identity {id: 'INTER_A'})
         CREATE (u)-[:intersectWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'INTER_ABC'}), (b:Identity {id: 'INTER_B'})
         CREATE (u)-[:intersectWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'INTER_ABC'}), (c:Identity {id: 'INTER_C'})
         CREATE (u)-[:intersectWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)

      // INTER_ABC should ONLY have read on M1 (all three have it)
      const resultM1 = await checker.hasAccess(
        [identity('APP1')],
        [identity('INTER_ABC')],
        'M1',
        'read',
      )
      expectGranted(resultM1)

      // INTER_ABC should NOT have read on M2 (only INTER_A has it)
      const resultM2 = await checker.hasAccess(
        [identity('APP1')],
        [identity('INTER_ABC')],
        'M2',
        'read',
      )
      expectDeniedByTarget(resultM2)

      // INTER_ABC should NOT have read on M3 (only INTER_B has it)
      const resultM3 = await checker.hasAccess(
        [identity('APP1')],
        [identity('INTER_ABC')],
        'M3',
        'read',
      )
      expectDeniedByTarget(resultM3)
    })
  })

  // ===========================================================================
  // COMPLEX COMPOSITION
  // ===========================================================================

  describe('Complex Composition', () => {
    it('handles nested union in intersection', async () => {
      // Create: Y = (A union B) intersect C
      // Where C has read on M1 only
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'C' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'Y' },
      })

      // C has read on M1
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'C', moduleId: 'M1' } },
      )

      // Y = A union B
      await ctx.connection.graph.query(
        `MATCH (y:Identity {id: $yId}), (a:Identity {id: $aId})
         CREATE (y)-[:unionWith]->(a)`,
        { params: { yId: 'Y', aId: 'A' } },
      )
      await ctx.connection.graph.query(
        `MATCH (y:Identity {id: $yId}), (b:Identity {id: $bId})
         CREATE (y)-[:unionWith]->(b)`,
        { params: { yId: 'Y', bId: 'B' } },
      )
      // Y intersect C
      await ctx.connection.graph.query(
        `MATCH (y:Identity {id: $yId}), (c:Identity {id: $cId})
         CREATE (y)-[:intersectWith]->(c)`,
        { params: { yId: 'Y', cId: 'C' } },
      )

      const checker = createAccessChecker(ctx.executor)

      // Y = (A ∪ B) ∩ C
      // A has read on M1, M2
      // B has read on M1
      // C has read on M1
      // So (A ∪ B) has read on M1, M2
      // (A ∪ B) ∩ C has read on M1 only
      const resultM1 = await checker.hasAccess([identity('APP1')], [identity('Y')], 'M1', 'read')
      expectGranted(resultM1)

      const resultM2 = await checker.hasAccess([identity('APP1')], [identity('Y')], 'M2', 'read')
      expectDeniedByTarget(resultM2)
    })
  })
})
