/**
 * AUTH_V2 Integration Tests: Identity Composition
 *
 * Tests unionWith, intersectWith, and excludeWith identity composition.
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
import { expectGranted, expectDeniedByTarget, subjectFromIds, subject, identity } from './helpers'

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
    it('grants access via unionWith role', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // USER1 unionWith ROLE1
      // USER1 has edit on workspace-1 only
      // ROLE1 has edit on workspace-2
      // M3 is in workspace-2

      // First, create identity without union for comparison
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

      // USER1_NO_UNION CANNOT access M3 for edit
      const deniedResult = await checker.checkAccess(
        subjectFromIds(['APP1'], ['USER1_NO_UNION']),
        'M3',
        'edit',
        'principal',
      )
      expectDeniedByTarget(deniedResult)

      // USER1 (has unionWith ROLE1) CAN access M3 for edit
      // Build the expression for USER1 which includes ROLE1 via union
      const user1Expr = await evaluator.evalIdentity('USER1')

      const grantedResult = await checker.checkAccess(
        subject(identity('APP1'), user1Expr),
        'M3',
        'edit',
        'principal',
      )
      expectGranted(grantedResult)
    })

    it('denies when neither identity in union has permission', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // USER1 unionWith ROLE1, but neither has 'admin'
      const user1Expr = await evaluator.evalIdentity('USER1')

      const result = await checker.checkAccess(
        subject(identity('APP1'), user1Expr),
        'M1',
        'admin',
        'principal',
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

      // Each has edit on different module
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'edit'}]->(m)`,
        { params: { identityId: 'UNION_A', moduleId: 'M1' } },
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'edit'}]->(m)`,
        { params: { identityId: 'UNION_B', moduleId: 'M2' } },
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'edit'}]->(m)`,
        { params: { identityId: 'UNION_C', moduleId: 'M3' } },
      )

      // UNION_ABC = A ∪ B ∪ C
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
      const evaluator = new IdentityEvaluator(ctx.executor)

      const unionAbcExpr = await evaluator.evalIdentity('UNION_ABC')

      // Should have edit on all three
      expectGranted(
        await checker.checkAccess(subject(identity('APP1'), unionAbcExpr), 'M1', 'edit', 'p'),
      )
      expectGranted(
        await checker.checkAccess(subject(identity('APP1'), unionAbcExpr), 'M2', 'edit', 'p'),
      )
      expectGranted(
        await checker.checkAccess(subject(identity('APP1'), unionAbcExpr), 'M3', 'edit', 'p'),
      )
    })
  })

  // ===========================================================================
  // INTERSECTION (AND)
  // ===========================================================================

  describe('Intersection Composition', () => {
    it('grants when all intersected identities have permission', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B
      // A has read on M1 and M2
      // B has read on M1 only
      // X should have read on M1
      const xExpr = await evaluator.evalIdentity('X')

      const result = await checker.checkAccess(
        subject(identity('APP1'), xExpr),
        'M1',
        'read',
        'principal',
      )

      expectGranted(result)
    })

    it('denies when not all intersected identities have permission', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B
      // A has read on M2, B does not
      const xExpr = await evaluator.evalIdentity('X')

      const result = await checker.checkAccess(
        subject(identity('APP1'), xExpr),
        'M2',
        'read',
        'principal',
      )

      expectDeniedByTarget(result)
    })

    it('handles 3-way intersection (A ∩ B ∩ C)', async () => {
      // INTER_A: M1, M2
      // INTER_B: M1, M3
      // INTER_C: M1 only
      // Result: M1 only
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

      // Permissions
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'INTER_A'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'INTER_A'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'INTER_B'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'INTER_B'}), (m:Module {id: 'M3'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'INTER_C'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )

      // INTER_ABC = A ∩ B ∩ C
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'INTER_ABC'}), (a:Identity {id: 'INTER_A'}) CREATE (u)-[:intersectWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'INTER_ABC'}), (b:Identity {id: 'INTER_B'}) CREATE (u)-[:intersectWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (u:Identity {id: 'INTER_ABC'}), (c:Identity {id: 'INTER_C'}) CREATE (u)-[:intersectWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      const interAbcExpr = await evaluator.evalIdentity('INTER_ABC')

      expectGranted(
        await checker.checkAccess(subject(identity('APP1'), interAbcExpr), 'M1', 'read', 'p'),
      )
      expectDeniedByTarget(
        await checker.checkAccess(subject(identity('APP1'), interAbcExpr), 'M2', 'read', 'p'),
      )
      expectDeniedByTarget(
        await checker.checkAccess(subject(identity('APP1'), interAbcExpr), 'M3', 'read', 'p'),
      )
    })
  })

  // ===========================================================================
  // EXCLUDE (SET DIFFERENCE)
  // ===========================================================================

  describe('Exclude Composition', () => {
    it('denies excluded permissions (E = A \\ C)', async () => {
      // E = A \ C where C has M2
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_E' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_C' },
      })

      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'EXCLUDE_C'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )

      // E = A \ C
      await ctx.connection.graph.query(
        `MATCH (e:Identity {id: 'EXCLUDE_E'}), (a:Identity {id: 'A'}) CREATE (e)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (e:Identity {id: 'EXCLUDE_E'}), (c:Identity {id: 'EXCLUDE_C'}) CREATE (e)-[:excludeWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      const excludeEExpr = await evaluator.evalIdentity('EXCLUDE_E')

      // M2 excluded by C
      expectDeniedByTarget(
        await checker.checkAccess(subject(identity('APP1'), excludeEExpr), 'M2', 'read', 'p'),
      )
    })

    it('preserves non-excluded permissions', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_E2' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_C2' },
      })

      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'EXCLUDE_C2'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )

      await ctx.connection.graph.query(
        `MATCH (e:Identity {id: 'EXCLUDE_E2'}), (a:Identity {id: 'A'}) CREATE (e)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (e:Identity {id: 'EXCLUDE_E2'}), (c:Identity {id: 'EXCLUDE_C2'}) CREATE (e)-[:excludeWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      const excludeE2Expr = await evaluator.evalIdentity('EXCLUDE_E2')

      // M1 not excluded
      expectGranted(
        await checker.checkAccess(subject(identity('APP1'), excludeE2Expr), 'M1', 'read', 'p'),
      )
    })

    it('handles multiple excludes (X = A \\ B \\ C)', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'MULTI_EXCLUDE_X' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'MULTI_EXCLUDE_B' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'MULTI_EXCLUDE_C' },
      })

      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'MULTI_EXCLUDE_B'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'MULTI_EXCLUDE_C'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )

      await ctx.connection.graph.query(
        `MATCH (x:Identity {id: 'MULTI_EXCLUDE_X'}), (a:Identity {id: 'A'}) CREATE (x)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (x:Identity {id: 'MULTI_EXCLUDE_X'}), (b:Identity {id: 'MULTI_EXCLUDE_B'}) CREATE (x)-[:excludeWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (x:Identity {id: 'MULTI_EXCLUDE_X'}), (c:Identity {id: 'MULTI_EXCLUDE_C'}) CREATE (x)-[:excludeWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      const multiExcludeXExpr = await evaluator.evalIdentity('MULTI_EXCLUDE_X')

      expectDeniedByTarget(
        await checker.checkAccess(subject(identity('APP1'), multiExcludeXExpr), 'M1', 'read', 'p'),
      )
      expectDeniedByTarget(
        await checker.checkAccess(subject(identity('APP1'), multiExcludeXExpr), 'M2', 'read', 'p'),
      )
    })

    it('handles union then exclude ((A ∪ B) \\ C)', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'UNION_EXCLUDE_Y' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'UNION_EXCLUDE_C' },
      })

      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'UNION_EXCLUDE_C'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )

      await ctx.connection.graph.query(
        `MATCH (y:Identity {id: 'UNION_EXCLUDE_Y'}), (a:Identity {id: 'A'}) CREATE (y)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (y:Identity {id: 'UNION_EXCLUDE_Y'}), (b:Identity {id: 'B'}) CREATE (y)-[:unionWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (y:Identity {id: 'UNION_EXCLUDE_Y'}), (c:Identity {id: 'UNION_EXCLUDE_C'}) CREATE (y)-[:excludeWith]->(c)`,
      )

      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      const unionExcludeYExpr = await evaluator.evalIdentity('UNION_EXCLUDE_Y')

      expectGranted(
        await checker.checkAccess(subject(identity('APP1'), unionExcludeYExpr), 'M1', 'read', 'p'),
      )
      expectDeniedByTarget(
        await checker.checkAccess(subject(identity('APP1'), unionExcludeYExpr), 'M2', 'read', 'p'),
      )
    })

    it('handles complex composition ((A ∪ B) ∩ D) \\ E', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'COMPLEX_W' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'COMPLEX_D' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'COMPLEX_E' },
      })

      // D has read on all
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'COMPLEX_D'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'COMPLEX_D'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'COMPLEX_D'}), (m:Module {id: 'M3'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )

      // E excludes M2
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'COMPLEX_E'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
      )

      // W = (A ∪ B) ∩ D \ E
      await ctx.connection.graph.query(
        `MATCH (w:Identity {id: 'COMPLEX_W'}), (a:Identity {id: 'A'}) CREATE (w)-[:unionWith]->(a)`,
      )
      await ctx.connection.graph.query(
        `MATCH (w:Identity {id: 'COMPLEX_W'}), (b:Identity {id: 'B'}) CREATE (w)-[:unionWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (w:Identity {id: 'COMPLEX_W'}), (d:Identity {id: 'COMPLEX_D'}) CREATE (w)-[:intersectWith]->(d)`,
      )
      await ctx.connection.graph.query(
        `MATCH (w:Identity {id: 'COMPLEX_W'}), (e:Identity {id: 'COMPLEX_E'}) CREATE (w)-[:excludeWith]->(e)`,
      )

      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      const complexWExpr = await evaluator.evalIdentity('COMPLEX_W')

      expectGranted(
        await checker.checkAccess(subject(identity('APP1'), complexWExpr), 'M1', 'read', 'p'),
      )
      expectDeniedByTarget(
        await checker.checkAccess(subject(identity('APP1'), complexWExpr), 'M2', 'read', 'p'),
      )
    })
  })
})
