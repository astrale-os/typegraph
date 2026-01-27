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
  // EXCLUDE (SET DIFFERENCE)
  // ===========================================================================

  describe('Exclude Composition', () => {
    it('basic exclude denies access (E = A \\ C where C has M2)', async () => {
      // Create identities for exclude test
      // E = A \ C
      // A has read on M1 and M2
      // C has read on M2 only
      // So E should have read on M1, but NOT M2
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_E' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_C' },
      })

      // EXCLUDE_C has read on M2 only
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'EXCLUDE_C', moduleId: 'M2' } },
      )

      // EXCLUDE_E = A (has M1, M2) \ EXCLUDE_C (has M2)
      await ctx.connection.graph.query(
        `MATCH (e:Identity {id: 'EXCLUDE_E'}), (a:Identity {id: 'A'})
         CREATE (e)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (e:Identity {id: 'EXCLUDE_E'}), (c:Identity {id: 'EXCLUDE_C'})
         CREATE (e)-[:excludeWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)

      // EXCLUDE_E should NOT have read on M2 (excluded by C)
      const resultM2 = await checker.hasAccess(
        [identity('APP1')],
        [identity('EXCLUDE_E')],
        'M2',
        'read',
      )
      expectDeniedByTarget(resultM2)
    })

    it('preserve non-excluded permissions (E = A \\ C keeps M1)', async () => {
      // Reuse setup from previous test by creating fresh identities
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_E2' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_C2' },
      })

      // EXCLUDE_C2 has read on M2 only (not M1)
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'EXCLUDE_C2', moduleId: 'M2' } },
      )

      // EXCLUDE_E2 = A (has M1, M2) \ EXCLUDE_C2 (has M2)
      await ctx.connection.graph.query(
        `MATCH (e:Identity {id: 'EXCLUDE_E2'}), (a:Identity {id: 'A'})
         CREATE (e)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (e:Identity {id: 'EXCLUDE_E2'}), (c:Identity {id: 'EXCLUDE_C2'})
         CREATE (e)-[:excludeWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)

      // EXCLUDE_E2 should STILL have read on M1 (not excluded)
      const resultM1 = await checker.hasAccess(
        [identity('APP1')],
        [identity('EXCLUDE_E2')],
        'M1',
        'read',
      )
      expectGranted(resultM1)
    })

    it('multiple excludes (X = A \\ B \\ C)', async () => {
      // Create identities
      // X = A \ B \ C
      // A has read on M1, M2
      // B has read on M2
      // C has read on M3 (not relevant, but tests chaining)
      // Result: X has read on M1 only
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'MULTI_EXCLUDE_X' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'MULTI_EXCLUDE_B' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'MULTI_EXCLUDE_C' },
      })

      // MULTI_EXCLUDE_B has read on M2
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'MULTI_EXCLUDE_B', moduleId: 'M2' } },
      )

      // MULTI_EXCLUDE_C has read on M1 (this should also exclude M1)
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'MULTI_EXCLUDE_C', moduleId: 'M1' } },
      )

      // MULTI_EXCLUDE_X = A \ B \ C
      await ctx.connection.graph.query(
        `MATCH (x:Identity {id: 'MULTI_EXCLUDE_X'}), (a:Identity {id: 'A'})
         CREATE (x)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (x:Identity {id: 'MULTI_EXCLUDE_X'}), (b:Identity {id: 'MULTI_EXCLUDE_B'})
         CREATE (x)-[:excludeWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (x:Identity {id: 'MULTI_EXCLUDE_X'}), (c:Identity {id: 'MULTI_EXCLUDE_C'})
         CREATE (x)-[:excludeWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)

      // M2 excluded by B
      const resultM2 = await checker.hasAccess(
        [identity('APP1')],
        [identity('MULTI_EXCLUDE_X')],
        'M2',
        'read',
      )
      expectDeniedByTarget(resultM2)

      // M1 excluded by C
      const resultM1 = await checker.hasAccess(
        [identity('APP1')],
        [identity('MULTI_EXCLUDE_X')],
        'M1',
        'read',
      )
      expectDeniedByTarget(resultM1)
    })

    it('union then exclude ((A ∪ B) \\ C)', async () => {
      // Create: Y = (A ∪ B) \ C
      // A has read on M1, M2
      // B has read on M1
      // C has read on M2
      // Result: Y has read on M1, not M2
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'UNION_EXCLUDE_Y' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'UNION_EXCLUDE_C' },
      })

      // UNION_EXCLUDE_C has read on M2
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'UNION_EXCLUDE_C', moduleId: 'M2' } },
      )

      // Y = A ∪ B
      await ctx.connection.graph.query(
        `MATCH (y:Identity {id: 'UNION_EXCLUDE_Y'}), (a:Identity {id: 'A'})
         CREATE (y)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (y:Identity {id: 'UNION_EXCLUDE_Y'}), (b:Identity {id: 'B'})
         CREATE (y)-[:unionWith]->(b)`,
      )
      // Y \ C
      await ctx.connection.graph.query(
        `MATCH (y:Identity {id: 'UNION_EXCLUDE_Y'}), (c:Identity {id: 'UNION_EXCLUDE_C'})
         CREATE (y)-[:excludeWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)

      // Y should have read on M1 (both A and B have it, C doesn't exclude it)
      const resultM1 = await checker.hasAccess(
        [identity('APP1')],
        [identity('UNION_EXCLUDE_Y')],
        'M1',
        'read',
      )
      expectGranted(resultM1)

      // Y should NOT have read on M2 (excluded by C)
      const resultM2 = await checker.hasAccess(
        [identity('APP1')],
        [identity('UNION_EXCLUDE_Y')],
        'M2',
        'read',
      )
      expectDeniedByTarget(resultM2)
    })

    it('intersect then exclude ((A ∩ B) \\ C)', async () => {
      // Create: Z = (A ∩ B) \ C
      // A has read on M1, M2
      // B has read on M1
      // C has read on M3 (doesn't affect result)
      // A ∩ B = M1 only
      // Result: Z has read on M1
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'INTER_EXCLUDE_Z' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'INTER_EXCLUDE_C' },
      })

      // INTER_EXCLUDE_C has read on M3 (not M1, so won't affect the intersection result)
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'INTER_EXCLUDE_C', moduleId: 'M3' } },
      )

      // Z = A ∩ B
      await ctx.connection.graph.query(
        `MATCH (z:Identity {id: 'INTER_EXCLUDE_Z'}), (a:Identity {id: 'A'})
         CREATE (z)-[:intersectWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (z:Identity {id: 'INTER_EXCLUDE_Z'}), (b:Identity {id: 'B'})
         CREATE (z)-[:intersectWith]->(b)`,
      )
      // Z \ C
      await ctx.connection.graph.query(
        `MATCH (z:Identity {id: 'INTER_EXCLUDE_Z'}), (c:Identity {id: 'INTER_EXCLUDE_C'})
         CREATE (z)-[:excludeWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)

      // Z = (A ∩ B) \ C = M1 \ M3 = M1
      const resultM1 = await checker.hasAccess(
        [identity('APP1')],
        [identity('INTER_EXCLUDE_Z')],
        'M1',
        'read',
      )
      expectGranted(resultM1)

      // M2 not in intersection, so denied
      const resultM2 = await checker.hasAccess(
        [identity('APP1')],
        [identity('INTER_EXCLUDE_Z')],
        'M2',
        'read',
      )
      expectDeniedByTarget(resultM2)
    })

    it('complex composition ((A ∪ B) ∩ D) \\ E', async () => {
      // Create: W = ((A ∪ B) ∩ D) \ E
      // A has read on M1, M2
      // B has read on M1
      // D has read on M1, M2, M3
      // E has read on M2
      // (A ∪ B) = M1, M2
      // (A ∪ B) ∩ D = M1, M2 (both have it)
      // Result: W = M1 (M2 excluded by E)
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'COMPLEX_W' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'COMPLEX_D' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'COMPLEX_E' },
      })

      // COMPLEX_D has read on M1, M2, M3
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'COMPLEX_D', moduleId: 'M1' } },
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'COMPLEX_D', moduleId: 'M2' } },
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'COMPLEX_D', moduleId: 'M3' } },
      )

      // COMPLEX_E has read on M2
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'COMPLEX_E', moduleId: 'M2' } },
      )

      // W = (A ∪ B) ∩ D \ E
      await ctx.connection.graph.query(
        `MATCH (w:Identity {id: 'COMPLEX_W'}), (a:Identity {id: 'A'})
         CREATE (w)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (w:Identity {id: 'COMPLEX_W'}), (b:Identity {id: 'B'})
         CREATE (w)-[:unionWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (w:Identity {id: 'COMPLEX_W'}), (d:Identity {id: 'COMPLEX_D'})
         CREATE (w)-[:intersectWith]->(d)`,
      )
      await ctx.connection.graph.query(
        `MATCH (w:Identity {id: 'COMPLEX_W'}), (e:Identity {id: 'COMPLEX_E'})
         CREATE (w)-[:excludeWith]->(e)`,
      )

      const checker = createAccessChecker(ctx.executor)

      // W should have read on M1
      const resultM1 = await checker.hasAccess(
        [identity('APP1')],
        [identity('COMPLEX_W')],
        'M1',
        'read',
      )
      expectGranted(resultM1)

      // W should NOT have read on M2 (excluded by E)
      const resultM2 = await checker.hasAccess(
        [identity('APP1')],
        [identity('COMPLEX_W')],
        'M2',
        'read',
      )
      expectDeniedByTarget(resultM2)
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
