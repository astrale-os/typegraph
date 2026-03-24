/**
 * AUTH_V2 Integration Tests: Identity Composition
 *
 * Tests unionWith, intersectWith, and excludeWith identity composition.
 */

import { describe, it, beforeAll, afterAll, beforeEach, expect } from 'vitest'

import type { Permission } from './types'

import { createAccessChecker } from './adapter'
import { IdentityEvaluator, createCompositionCache } from './adapter/identity-evaluator'
import { identity, union, intersect, grant, raw } from './expression/builder'
import {
  expectGranted,
  expectDeniedByResource,
  grantFromIds,
  READ,
  EDIT,
  USE,
} from './testing/helpers'
import {
  setupAuthzTest,
  teardownAuthzTest,
  clearDatabase,
  seedAuthzTestData,
  type AuthzTestContext,
} from './testing/setup'

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
         CREATE (i)-[:hasPerm {perms: 1}]->(r)`,
        { params: { identityId: 'USER1_NO_UNION' } },
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (s:Space {id: 'workspace-1'})
         CREATE (i)-[:hasPerm {perms: 2}]->(s)`,
        { params: { identityId: 'USER1_NO_UNION' } },
      )

      // USER1_NO_UNION CANNOT access M3 for edit
      const deniedResult = await checker.checkAccess({
        principal: 'principal',
        grant: grantFromIds(['APP1'], ['USER1_NO_UNION']),
        nodeId: 'M3',
        nodePerm: EDIT,
        typePerm: USE,
      })
      expectDeniedByResource(deniedResult)

      // USER1 (has unionWith ROLE1) CAN access M3 for edit
      // Build the expression for USER1 which includes ROLE1 via union
      const user1Expr = await evaluator.evalIdentity('USER1')

      const grantedResult = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), raw(user1Expr)).build(),
        nodeId: 'M3',
        nodePerm: EDIT,
        typePerm: USE,
      })
      expectGranted(grantedResult)
    })

    it('denies when neither identity in union has permission', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // USER1 unionWith ROLE1, but neither has 'admin'
      const user1Expr = await evaluator.evalIdentity('USER1')

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), raw(user1Expr)).build(),
        nodeId: 'M1',
        nodePerm: 16 as Permission,
        typePerm: USE,
      })

      expectDeniedByResource(result)
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
         CREATE (i)-[:hasPerm {perms: 2}]->(m)`,
        { params: { identityId: 'UNION_A', moduleId: 'M1' } },
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perms: 2}]->(m)`,
        { params: { identityId: 'UNION_B', moduleId: 'M2' } },
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perms: 2}]->(m)`,
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
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(unionAbcExpr)).build(),
          nodeId: 'M1',
          nodePerm: EDIT,
          typePerm: USE,
        }),
      )
      expectGranted(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(unionAbcExpr)).build(),
          nodeId: 'M2',
          nodePerm: EDIT,
          typePerm: USE,
        }),
      )
      expectGranted(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(unionAbcExpr)).build(),
          nodeId: 'M3',
          nodePerm: EDIT,
          typePerm: USE,
        }),
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

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), raw(xExpr)).build(),
        nodeId: 'M1',
        nodePerm: READ,
        typePerm: USE,
      })

      expectGranted(result)
    })

    it('denies when not all intersected identities have permission', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B
      // A has read on M2, B does not
      const xExpr = await evaluator.evalIdentity('X')

      const result = await checker.checkAccess({
        principal: 'principal',
        grant: grant(identity('APP1'), raw(xExpr)).build(),
        nodeId: 'M2',
        nodePerm: READ,
        typePerm: USE,
      })

      expectDeniedByResource(result)
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
        `MATCH (i:Identity {id: 'INTER_A'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'INTER_A'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'INTER_B'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'INTER_B'}), (m:Module {id: 'M3'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'INTER_C'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
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
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(interAbcExpr)).build(),
          nodeId: 'M1',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
      expectDeniedByResource(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(interAbcExpr)).build(),
          nodeId: 'M2',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
      expectDeniedByResource(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(interAbcExpr)).build(),
          nodeId: 'M3',
          nodePerm: READ,
          typePerm: USE,
        }),
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
        `MATCH (i:Identity {id: 'EXCLUDE_C'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
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
      expectDeniedByResource(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(excludeEExpr)).build(),
          nodeId: 'M2',
          nodePerm: READ,
          typePerm: USE,
        }),
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
        `MATCH (i:Identity {id: 'EXCLUDE_C2'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
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
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(excludeE2Expr)).build(),
          nodeId: 'M1',
          nodePerm: READ,
          typePerm: USE,
        }),
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
        `MATCH (i:Identity {id: 'MULTI_EXCLUDE_B'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'MULTI_EXCLUDE_C'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
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

      expectDeniedByResource(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(multiExcludeXExpr)).build(),
          nodeId: 'M1',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
      expectDeniedByResource(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(multiExcludeXExpr)).build(),
          nodeId: 'M2',
          nodePerm: READ,
          typePerm: USE,
        }),
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
        `MATCH (i:Identity {id: 'UNION_EXCLUDE_C'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
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
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(unionExcludeYExpr)).build(),
          nodeId: 'M1',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
      expectDeniedByResource(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(unionExcludeYExpr)).build(),
          nodeId: 'M2',
          nodePerm: READ,
          typePerm: USE,
        }),
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
        `MATCH (i:Identity {id: 'COMPLEX_D'}), (m:Module {id: 'M1'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'COMPLEX_D'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
      )
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'COMPLEX_D'}), (m:Module {id: 'M3'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
      )

      // E excludes M2
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: 'COMPLEX_E'}), (m:Module {id: 'M2'}) CREATE (i)-[:hasPerm {perms: 1}]->(m)`,
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
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(complexWExpr)).build(),
          nodeId: 'M1',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
      expectDeniedByResource(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(complexWExpr)).build(),
          nodeId: 'M2',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
    })
  })

  // ===========================================================================
  // evalExpr() INTEGRATION (SDK + Resolution)
  // ===========================================================================

  describe('evalExpr() Integration', () => {
    it('accepts builder and resolves unscoped leaves', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // USER1 has unionWith ROLE1 in DB
      // Using builder: identity("USER1") should expand to union(USER1, ROLE1)
      const resolved = await evaluator.evalExpr(identity('USER1'))

      // Should be a union expression (expanded from DB)
      expect(resolved.kind).toBe('union')

      // Should grant access to M3 (via ROLE1's workspace-2 edit)
      expectGranted(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(resolved)).build(),
          nodeId: 'M3',
          nodePerm: EDIT,
          typePerm: USE,
        }),
      )
    })

    it('preserves scoped leaves without expansion', async () => {
      const evaluator = new IdentityEvaluator(ctx.executor)

      // USER1 has unionWith ROLE1 in DB, but scoped leaves are NOT expanded
      const resolved = await evaluator.evalExpr(identity('USER1', { perms: READ }))

      // Should remain as scope-wrapped identity (scoped = not expanded)
      expect(resolved.kind).toBe('scope')
      expect((resolved as any).scopes).toEqual([{ perms: READ }])
      expect((resolved as any).expr.kind).toBe('identity')
      expect((resolved as any).expr.id).toBe('USER1')
    })

    it('resolves mixed expression with scoped and unscoped leaves', async () => {
      const evaluator = new IdentityEvaluator(ctx.executor)

      // union(USER1 (unscoped), ROLE1 (scoped))
      // - USER1 should expand to union(USER1, ROLE1) from DB
      // - ROLE1 (scoped) should remain as-is
      const expr = union(identity('USER1'), identity('ROLE1', { perms: READ }))

      const resolved = await evaluator.evalExpr(expr)

      // Result should be: union(union(USER1, ROLE1), scope(ROLE1))
      expect(resolved.kind).toBe('union')

      // Verify structure: first operand should be the expanded USER1
      const operands = (resolved as any).operands
      expect(operands[0].kind).toBe('union')

      // Second operand should be the scope-wrapped ROLE1
      const scoped = operands[1]
      expect(scoped.kind).toBe('scope')
      expect(scoped.scopes).toEqual([{ perms: READ }])
      expect(scoped.expr.kind).toBe('identity')
      expect(scoped.expr.id).toBe('ROLE1')
    })

    it('works with complex builder expression and checkAccess', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // Build expression using SDK
      const forResourceBuilder = identity('USER1').intersect(identity('A'))

      // Resolve (expands USER1 to union(USER1, ROLE1), A stays as-is)
      const resolved = await evaluator.evalExpr(forResourceBuilder)

      // (USER1 ∪ ROLE1) ∩ A
      // A has read on M1
      // USER1 has read at root
      // Result: should have read on M1
      expectGranted(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(resolved)).build(),
          nodeId: 'M1',
          nodePerm: READ,
          typePerm: USE,
        }),
      )
    })

    it('accepts raw IdentityExpr directly', async () => {
      const checker = createAccessChecker(ctx.executor)
      const evaluator = new IdentityEvaluator(ctx.executor)

      // Pass raw expression instead of builder
      const rawExpr = { kind: 'identity' as const, id: 'USER1' }
      const resolved = await evaluator.evalExpr(rawExpr)

      // Should expand from DB
      expect(resolved.kind).toBe('union')

      expectGranted(
        await checker.checkAccess({
          principal: 'p',
          grant: grant(identity('APP1'), raw(resolved)).build(),
          nodeId: 'M3',
          nodePerm: EDIT,
          typePerm: USE,
        }),
      )
    })

    it('resolves nested compositions correctly', async () => {
      const evaluator = new IdentityEvaluator(ctx.executor)

      // X = A ∩ B in DB
      // Build: intersect(X, identity("USER1"))
      // - X should expand to intersect(A, B)
      // - USER1 should expand to union(USER1, ROLE1)
      const expr = intersect(identity('X'), identity('USER1'))
      const resolved = await evaluator.evalExpr(expr)

      expect(resolved.kind).toBe('intersect')

      // First operand should be X expanded to intersect(A, B)
      const operands = (resolved as any).operands
      expect(operands[0].kind).toBe('intersect')

      // Second operand should be USER1 expanded to union(USER1, ROLE1)
      expect(operands[1].kind).toBe('union')
    })
  })

  // ===========================================================================
  // BATCH RESOLUTION PERFORMANCE TESTS
  // ===========================================================================

  describe('Batch Resolution', () => {
    it('fetches entire composition graph in single query', async () => {
      const evaluator = new IdentityEvaluator(ctx.executor)

      // Create a deep composition chain: CHAIN_0 -> CHAIN_1 -> CHAIN_2 -> ... -> CHAIN_5
      for (let i = 0; i < 6; i++) {
        await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
          params: { id: `CHAIN_${i}` },
        })
        if (i > 0) {
          await ctx.connection.graph.query(
            `MATCH (a:Identity {id: $from}), (b:Identity {id: $to})
             CREATE (a)-[:unionWith]->(b)`,
            { params: { from: `CHAIN_${i - 1}`, to: `CHAIN_${i}` } },
          )
        }
        // Give each node permission for tracking
        await ctx.connection.graph.query(
          `MATCH (i:Identity {id: $identityId}), (r:Root {id: 'root'})
           CREATE (i)-[:hasPerm {perms: 16}]->(r)`,
          { params: { identityId: `CHAIN_${i}` } },
        )
      }

      // Fetch all at once
      const compositions = await evaluator.batchFetchCompositions(['CHAIN_0'])

      // Should have all 6 identities
      expect(compositions.size).toBe(6)
      for (let i = 0; i < 6; i++) {
        expect(compositions.has(`CHAIN_${i}`)).toBe(true)
      }
    })

    it('handles diamond patterns with batch fetch', async () => {
      // Diamond: TOP -> [LEFT, RIGHT] -> BOTTOM
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'DIAMOND_TOP' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'DIAMOND_LEFT' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'DIAMOND_RIGHT' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'DIAMOND_BOTTOM' },
      })

      // TOP -> LEFT, TOP -> RIGHT
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'DIAMOND_TOP'}), (b:Identity {id: 'DIAMOND_LEFT'})
         CREATE (a)-[:unionWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'DIAMOND_TOP'}), (b:Identity {id: 'DIAMOND_RIGHT'})
         CREATE (a)-[:unionWith]->(b)`,
      )
      // LEFT -> BOTTOM, RIGHT -> BOTTOM
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'DIAMOND_LEFT'}), (b:Identity {id: 'DIAMOND_BOTTOM'})
         CREATE (a)-[:unionWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'DIAMOND_RIGHT'}), (b:Identity {id: 'DIAMOND_BOTTOM'})
         CREATE (a)-[:unionWith]->(b)`,
      )

      const evaluator = new IdentityEvaluator(ctx.executor)
      const compositions = await evaluator.batchFetchCompositions(['DIAMOND_TOP'])

      // Should have all 4 nodes exactly once (DISTINCT handles diamond)
      expect(compositions.size).toBe(4)
      expect(compositions.has('DIAMOND_TOP')).toBe(true)
      expect(compositions.has('DIAMOND_LEFT')).toBe(true)
      expect(compositions.has('DIAMOND_RIGHT')).toBe(true)
      expect(compositions.has('DIAMOND_BOTTOM')).toBe(true)
    })

    it('detects cycles in batched mode', async () => {
      // Create cycle: CYCLE_A -> CYCLE_B -> CYCLE_A
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'CYCLE_A' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'CYCLE_B' },
      })
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'CYCLE_A'}), (b:Identity {id: 'CYCLE_B'})
         CREATE (a)-[:unionWith]->(b)`,
      )
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'CYCLE_B'}), (b:Identity {id: 'CYCLE_A'})
         CREATE (a)-[:unionWith]->(b)`,
      )

      const evaluator = new IdentityEvaluator(ctx.executor)

      // evalExpr should detect the cycle during tree building
      await expect(evaluator.evalExpr(identity('CYCLE_A'))).rejects.toThrow(/Cycle detected/)
    })

    it('reuses cache within request scope', async () => {
      const evaluator = new IdentityEvaluator(ctx.executor)

      // Track fetch calls
      let fetchCount = 0
      const originalBatch = evaluator.batchFetchCompositions.bind(evaluator)
      evaluator.batchFetchCompositions = async (...args) => {
        fetchCount++
        return originalBatch(...args)
      }

      // Create request-scoped cache
      const cache = createCompositionCache()

      // First call - should fetch from DB
      await evaluator.evalExpr(identity('USER1'), { cache })
      expect(fetchCount).toBe(1)

      // Second call with same cache - should NOT fetch again
      await evaluator.evalExpr(identity('USER1'), { cache })
      expect(fetchCount).toBe(1)

      // Call without cache (fresh) - should fetch again
      await evaluator.evalExpr(identity('USER1'))
      expect(fetchCount).toBe(2)

      // New cache - should fetch again
      const newCache = createCompositionCache()
      await evaluator.evalExpr(identity('USER1'), { cache: newCache })
      expect(fetchCount).toBe(3)
    })

    it('respects maxDepth limit', async () => {
      // Create chain deeper than maxDepth=2
      for (let i = 0; i < 5; i++) {
        await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
          params: { id: `DEEP_${i}` },
        })
        if (i > 0) {
          await ctx.connection.graph.query(
            `MATCH (a:Identity {id: $from}), (b:Identity {id: $to})
             CREATE (a)-[:unionWith]->(b)`,
            { params: { from: `DEEP_${i - 1}`, to: `DEEP_${i}` } },
          )
        }
      }

      const evaluator = new IdentityEvaluator(ctx.executor)

      // With maxDepth=2, should only get 3 nodes (0, 1, 2)
      const compositions = await evaluator.batchFetchCompositions(['DEEP_0'], 2)

      // Should have exactly 3 nodes
      expect(compositions.size).toBe(3)
      expect(compositions.has('DEEP_0')).toBe(true)
      expect(compositions.has('DEEP_1')).toBe(true)
      expect(compositions.has('DEEP_2')).toBe(true)
      expect(compositions.has('DEEP_3')).toBe(false)
    })

    it('handles missing identity in composition', async () => {
      const evaluator = new IdentityEvaluator(ctx.executor)

      // Try to resolve non-existent identity
      await expect(evaluator.evalExpr(identity('NONEXISTENT_IDENTITY'))).rejects.toThrow(
        /Identity not found/,
      )
    })

    it('rejects exclude-only identities', async () => {
      // Create exclude-only identity (no base set)
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_ONLY' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'EXCLUDE_TARGET' },
      })
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'EXCLUDE_ONLY'}), (b:Identity {id: 'EXCLUDE_TARGET'})
         CREATE (a)-[:excludeWith]->(b)`,
      )

      const evaluator = new IdentityEvaluator(ctx.executor)

      await expect(evaluator.evalExpr(identity('EXCLUDE_ONLY'))).rejects.toThrow(
        /exclude composition edges with no base set/,
      )
    })

    it('throws immediately on exclude without base set', async () => {
      // Create identity with union then exclude, but union points to exclude-only
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'TRICKY_BASE' },
      })
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'TRICKY_EXCLUDE' },
      })
      // TRICKY_BASE has only excludeWith (no base)
      await ctx.connection.graph.query(
        `MATCH (a:Identity {id: 'TRICKY_BASE'}), (b:Identity {id: 'TRICKY_EXCLUDE'})
         CREATE (a)-[:excludeWith]->(b)`,
      )

      const evaluator = new IdentityEvaluator(ctx.executor)

      await expect(evaluator.evalExpr(identity('TRICKY_BASE'))).rejects.toThrow(/base set/)
    })

    it('produces consistent results across calls', async () => {
      const evaluator = new IdentityEvaluator(ctx.executor)

      // Multiple calls should produce identical results
      const result1 = await evaluator.evalExpr(identity('USER1'))
      const result2 = await evaluator.evalExpr(identity('USER1'))
      const result3 = await evaluator.evalIdentity('USER1') // deprecated but should work

      // All should be structurally identical
      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2))
      expect(JSON.stringify(result1)).toBe(JSON.stringify(result3))

      // Verify expected structure: USER1 unionWith ROLE1
      expect(result1.kind).toBe('union')
    })

    it('handles multiple roots efficiently', async () => {
      const evaluator = new IdentityEvaluator(ctx.executor)

      // Fetch multiple roots at once (simulating forType + forResource)
      const compositions = await evaluator.batchFetchCompositions(['APP1', 'USER1'])

      // Should have APP1, USER1, and ROLE1 (transitively from USER1)
      expect(compositions.has('APP1')).toBe(true)
      expect(compositions.has('USER1')).toBe(true)
      expect(compositions.has('ROLE1')).toBe(true)
    })

    it('resolves 10-node composition graph efficiently', async () => {
      // Create a 10-node chain
      for (let i = 0; i < 10; i++) {
        await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
          params: { id: `PERF_${i}` },
        })
        if (i > 0) {
          await ctx.connection.graph.query(
            `MATCH (a:Identity {id: $from}), (b:Identity {id: $to})
             CREATE (a)-[:unionWith]->(b)`,
            { params: { from: `PERF_${i - 1}`, to: `PERF_${i}` } },
          )
        }
      }

      const evaluator = new IdentityEvaluator(ctx.executor)

      const start = performance.now()
      await evaluator.evalExpr(identity('PERF_0'))
      const elapsed = performance.now() - start

      // Should complete in reasonable time (well under 1 second, typically <50ms)
      // Note: This is a rough check - actual perf depends on DB connection
      expect(elapsed).toBeLessThan(1000)
    })
  })
})
