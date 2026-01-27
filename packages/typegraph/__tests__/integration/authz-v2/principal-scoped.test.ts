/**
 * AUTH_V2 Tests: Principal-Scoped Identity Expressions
 *
 * Tests for principal filtering on identity expression leaves.
 * Verifies empty-set propagation through composition operators.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  setupAuthzTest,
  teardownAuthzTest,
  clearDatabase,
  seedAuthzTestData,
  type AuthzTestContext,
} from './setup'
import { createCypherGenerator } from './cypher-generator'
import { scopeAllows, anyScopeAllows } from './scope-utils'
import type { IdentityExpr, Scope } from './types'

// =============================================================================
// UNIT TESTS: Scope Utility Functions
// =============================================================================

describe('Scope Utilities', () => {
  describe('scopeAllows', () => {
    it('allows when principals is undefined (unrestricted)', () => {
      const scope: Scope = { nodes: ['ws-1'] }
      expect(scopeAllows(scope, 'any-principal', 'read')).toBe(true)
    })

    it('allows when principals is empty array (unrestricted)', () => {
      const scope: Scope = { principals: [] }
      expect(scopeAllows(scope, 'any-principal', 'read')).toBe(true)
    })

    it('allows when principal is in principals list', () => {
      const scope: Scope = { principals: ['alice', 'bob'] }
      expect(scopeAllows(scope, 'alice', 'read')).toBe(true)
      expect(scopeAllows(scope, 'bob', 'read')).toBe(true)
    })

    it('denies when principal is not in principals list', () => {
      const scope: Scope = { principals: ['alice', 'bob'] }
      expect(scopeAllows(scope, 'eve', 'read')).toBe(false)
    })

    it('denies when principal is undefined but principals list is non-empty', () => {
      const scope: Scope = { principals: ['alice'] }
      expect(scopeAllows(scope, undefined, 'read')).toBe(false)
    })

    it('allows when perms is undefined (unrestricted)', () => {
      const scope: Scope = { principals: ['alice'] }
      expect(scopeAllows(scope, 'alice', 'any-perm')).toBe(true)
    })

    it('allows when perms is empty array (unrestricted)', () => {
      const scope: Scope = { perms: [] }
      expect(scopeAllows(scope, 'alice', 'any-perm')).toBe(true)
    })

    it('allows when perm is in perms list', () => {
      const scope: Scope = { perms: ['read', 'write'] }
      expect(scopeAllows(scope, 'alice', 'read')).toBe(true)
      expect(scopeAllows(scope, 'alice', 'write')).toBe(true)
    })

    it('denies when perm is not in perms list', () => {
      const scope: Scope = { perms: ['read'] }
      expect(scopeAllows(scope, 'alice', 'write')).toBe(false)
    })

    it('requires both principal AND perm to pass', () => {
      const scope: Scope = { principals: ['alice'], perms: ['read'] }
      expect(scopeAllows(scope, 'alice', 'read')).toBe(true)
      expect(scopeAllows(scope, 'alice', 'write')).toBe(false)
      expect(scopeAllows(scope, 'bob', 'read')).toBe(false)
      expect(scopeAllows(scope, 'bob', 'write')).toBe(false)
    })
  })

  describe('anyScopeAllows', () => {
    it('returns allowed:true with empty applicableScopes when scopes is undefined', () => {
      const result = anyScopeAllows(undefined, 'alice', 'read')
      expect(result.allowed).toBe(true)
      expect(result.applicableScopes).toEqual([])
    })

    it('returns allowed:true with empty applicableScopes when scopes is empty array', () => {
      const result = anyScopeAllows([], 'alice', 'read')
      expect(result.allowed).toBe(true)
      expect(result.applicableScopes).toEqual([])
    })

    it('returns allowed:true when any scope allows (OR semantics)', () => {
      const scopes: Scope[] = [
        { principals: ['bob'] }, // doesn't allow alice
        { principals: ['alice'] }, // allows alice
      ]
      const result = anyScopeAllows(scopes, 'alice', 'read')
      expect(result.allowed).toBe(true)
      expect(result.applicableScopes).toHaveLength(1)
      expect(result.applicableScopes[0]).toEqual({ principals: ['alice'] })
    })

    it('returns allowed:false when no scope allows', () => {
      const scopes: Scope[] = [{ principals: ['bob'] }, { principals: ['charlie'] }]
      const result = anyScopeAllows(scopes, 'alice', 'read')
      expect(result.allowed).toBe(false)
      expect(result.applicableScopes).toEqual([])
    })

    it('returns multiple applicable scopes when several allow', () => {
      const scopes: Scope[] = [
        { principals: ['alice'], nodes: ['ws-1'] },
        { principals: ['alice'], nodes: ['ws-2'] },
        { principals: ['bob'] },
      ]
      const result = anyScopeAllows(scopes, 'alice', 'read')
      expect(result.allowed).toBe(true)
      expect(result.applicableScopes).toHaveLength(2)
    })

    it('filters by perm as well as principal', () => {
      const scopes: Scope[] = [
        { principals: ['alice'], perms: ['read'] },
        { principals: ['alice'], perms: ['write'] },
      ]
      const result = anyScopeAllows(scopes, 'alice', 'read')
      expect(result.allowed).toBe(true)
      expect(result.applicableScopes).toHaveLength(1)
      expect(result.applicableScopes[0]?.perms).toEqual(['read'])
    })
  })
})

// =============================================================================
// UNIT TESTS: CypherGenerator with Principal Filtering
// =============================================================================

describe('CypherGenerator Principal Filtering', () => {
  const gen = createCypherGenerator({ maxDepth: 20 })

  // Helper to create identity expression
  const id = (name: string, scopes?: Scope[]): IdentityExpr => ({
    kind: 'identity',
    id: name,
    scopes,
  })

  // Helper to create union
  const union = (left: IdentityExpr, right: IdentityExpr): IdentityExpr => ({
    kind: 'union',
    left,
    right,
  })

  // Helper to create intersect
  const intersect = (left: IdentityExpr, right: IdentityExpr): IdentityExpr => ({
    kind: 'intersect',
    left,
    right,
  })

  // Helper to create exclude
  const exclude = (left: IdentityExpr, right: IdentityExpr): IdentityExpr => ({
    kind: 'exclude',
    left,
    right,
  })

  // ==========================================================================
  // Leaf Node Filtering
  // ==========================================================================

  describe('Leaf Node Filtering', () => {
    it('returns pattern when no scopes (unrestricted)', () => {
      const expr = id('USER1')
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('USER1')
      expect(result).toContain('hasPerm')
      expect(result).not.toBe('false')
    })

    it('returns pattern when principal is allowed by scope', () => {
      const expr = id('USER1', [{ principals: ['alice', 'bob'] }])
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('USER1')
      expect(result).not.toBe('false')
    })

    it('returns false when principal is not allowed by any scope', () => {
      const expr = id('USER1', [{ principals: ['alice', 'bob'] }])
      const result = gen.toPermCheck(expr, 'target', 'read', 'eve')
      expect(result).toBe('false')
    })

    it('returns false when perm is not allowed by any scope', () => {
      const expr = id('USER1', [{ perms: ['read'] }])
      const result = gen.toPermCheck(expr, 'target', 'write', 'alice')
      expect(result).toBe('false')
    })

    it('returns pattern when principal undefined and no principal restriction', () => {
      const expr = id('USER1', [{ perms: ['read'] }])
      const result = gen.toPermCheck(expr, 'target', 'read', undefined)
      expect(result).toContain('USER1')
      expect(result).not.toBe('false')
    })

    it('returns false when principal undefined but scope requires principals', () => {
      const expr = id('USER1', [{ principals: ['alice'] }])
      const result = gen.toPermCheck(expr, 'target', 'read', undefined)
      expect(result).toBe('false')
    })
  })

  // ==========================================================================
  // Empty Set Propagation: Union
  // ==========================================================================

  describe('Union Empty Set Propagation', () => {
    it('A ∪ ∅ = A (right filtered)', () => {
      const expr = union(
        id('A'),
        id('B', [{ principals: ['bob'] }]), // filtered for alice
      )
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      // Should just be A's pattern, not "(A OR false)"
      expect(result).toContain('A')
      expect(result).not.toContain('B')
      expect(result).not.toContain('false')
      expect(result).not.toContain('OR')
    })

    it('∅ ∪ A = A (left filtered)', () => {
      const expr = union(
        id('A', [{ principals: ['bob'] }]), // filtered for alice
        id('B'),
      )
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('B')
      expect(result).not.toContain('A')
      expect(result).not.toContain('false')
      expect(result).not.toContain('OR')
    })

    it('∅ ∪ ∅ = ∅ (both filtered)', () => {
      const expr = union(
        id('A', [{ principals: ['charlie'] }]),
        id('B', [{ principals: ['charlie'] }]),
      )
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toBe('false')
    })

    it('A ∪ B (neither filtered)', () => {
      const expr = union(id('A'), id('B'))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('A')
      expect(result).toContain('B')
      expect(result).toContain('OR')
    })
  })

  // ==========================================================================
  // Empty Set Propagation: Intersect
  // ==========================================================================

  describe('Intersect Empty Set Propagation', () => {
    it('A ∩ ∅ = ∅ (right filtered)', () => {
      const expr = intersect(id('A'), id('B', [{ principals: ['bob'] }]))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toBe('false')
    })

    it('∅ ∩ A = ∅ (left filtered)', () => {
      const expr = intersect(id('A', [{ principals: ['bob'] }]), id('B'))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toBe('false')
    })

    it('∅ ∩ ∅ = ∅ (both filtered)', () => {
      const expr = intersect(
        id('A', [{ principals: ['charlie'] }]),
        id('B', [{ principals: ['charlie'] }]),
      )
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toBe('false')
    })

    it('A ∩ B (neither filtered)', () => {
      const expr = intersect(id('A'), id('B'))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('A')
      expect(result).toContain('B')
      expect(result).toContain('AND')
      expect(result).not.toContain('NOT')
    })
  })

  // ==========================================================================
  // Empty Set Propagation: Exclude
  // ==========================================================================

  describe('Exclude Empty Set Propagation', () => {
    it('A \\ ∅ = A (excluded filtered)', () => {
      const expr = exclude(id('A'), id('B', [{ principals: ['bob'] }]))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      // Should just be A, exclusion has no effect
      expect(result).toContain('A')
      expect(result).not.toContain('B')
      expect(result).not.toContain('NOT')
    })

    it('∅ \\ A = ∅ (base filtered)', () => {
      const expr = exclude(id('A', [{ principals: ['bob'] }]), id('B'))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toBe('false')
    })

    it('∅ \\ ∅ = ∅ (both filtered)', () => {
      const expr = exclude(
        id('A', [{ principals: ['charlie'] }]),
        id('B', [{ principals: ['charlie'] }]),
      )
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toBe('false')
    })

    it('A \\ B (neither filtered)', () => {
      const expr = exclude(id('A'), id('B'))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('A')
      expect(result).toContain('B')
      expect(result).toContain('AND NOT')
    })
  })

  // ==========================================================================
  // Nested Compositions
  // ==========================================================================

  describe('Nested Compositions', () => {
    it('(A ∪ ∅) ∩ B = A ∩ B', () => {
      const expr = intersect(union(id('A'), id('FILTERED', [{ principals: ['bob'] }])), id('B'))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('A')
      expect(result).toContain('B')
      expect(result).toContain('AND')
      expect(result).not.toContain('FILTERED')
      expect(result).not.toContain('OR')
    })

    it('(∅ ∪ ∅) ∩ B = ∅', () => {
      const expr = intersect(
        union(id('X', [{ principals: ['bob'] }]), id('Y', [{ principals: ['bob'] }])),
        id('B'),
      )
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toBe('false')
    })

    it('(A ∩ ∅) ∪ B = B', () => {
      const expr = union(intersect(id('A'), id('FILTERED', [{ principals: ['bob'] }])), id('B'))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('B')
      expect(result).not.toContain('A')
      expect(result).not.toContain('OR')
    })

    it('(A \\ ∅) ∩ B = A ∩ B', () => {
      const expr = intersect(exclude(id('A'), id('FILTERED', [{ principals: ['bob'] }])), id('B'))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('A')
      expect(result).toContain('B')
      expect(result).toContain('AND')
      expect(result).not.toContain('NOT')
    })

    it('((A ∪ B) ∩ C) \\ D with A filtered = (B ∩ C) \\ D', () => {
      const expr = exclude(
        intersect(
          union(
            id('A', [{ principals: ['bob'] }]), // filtered
            id('B'),
          ),
          id('C'),
        ),
        id('D'),
      )
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('B')
      expect(result).toContain('C')
      expect(result).toContain('D')
      expect(result).not.toContain("'A'")
      expect(result).toContain('AND')
      expect(result).toContain('AND NOT')
    })

    it('deep nesting: ((A ∪ B) ∩ (C ∪ D)) \\ E', () => {
      const expr = exclude(intersect(union(id('A'), id('B')), union(id('C'), id('D'))), id('E'))
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('A')
      expect(result).toContain('B')
      expect(result).toContain('C')
      expect(result).toContain('D')
      expect(result).toContain('E')
    })
  })

  // ==========================================================================
  // Node Scope Integration
  // ==========================================================================

  describe('Node Scope Integration', () => {
    it('includes node scope check when scope has nodes', () => {
      const expr = id('USER1', [{ principals: ['alice'], nodes: ['workspace-1'] }])
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('workspace-1')
      expect(result).toContain('USER1')
      expect(result).toContain('AND')
    })

    it('OR multiple node scopes when multiple scopes apply', () => {
      const expr = id('USER1', [
        { principals: ['alice'], nodes: ['ws-1'] },
        { principals: ['alice'], nodes: ['ws-2'] },
      ])
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('ws-1')
      expect(result).toContain('ws-2')
      expect(result).toContain('OR')
    })

    it('no node check when scope has no nodes restriction', () => {
      const expr = id('USER1', [{ principals: ['alice'] }])
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('USER1')
      // Should be just the perm pattern, no extra AND for nodes
      // The pattern itself contains AND for hasParent, but not for nodeInScope
      expect(result).not.toContain('Node {id:')
    })

    it('mixes node-scoped and unrestricted scopes correctly', () => {
      const expr = id('USER1', [
        { principals: ['alice'], nodes: ['ws-1'] }, // node-restricted
        { principals: ['alice'] }, // unrestricted nodes
      ])
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      // When one scope is unrestricted, the permCheck should appear
      // The unrestricted scope should just be permCheck, node-restricted is (nodeCheck AND permCheck)
      expect(result).toContain('USER1')
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge Cases', () => {
    it('handles empty scopes array as unrestricted', () => {
      const expr = id('USER1', [])
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('USER1')
      expect(result).not.toBe('false')
    })

    it('handles scope with empty principals array as unrestricted', () => {
      const expr = id('USER1', [{ principals: [] }])
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('USER1')
      expect(result).not.toBe('false')
    })

    it('handles scope with empty perms array as unrestricted', () => {
      const expr = id('USER1', [{ perms: [] }])
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('USER1')
      expect(result).not.toBe('false')
    })

    it('handles principal with special characters in id', () => {
      const expr = id('user-with-dash_and_underscore', [{ principals: ['alice'] }])
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('user-with-dash_and_underscore')
    })

    it('handles three-way union with one filtered', () => {
      const expr = union(
        union(
          id('A'),
          id('B', [{ principals: ['bob'] }]), // filtered
        ),
        id('C'),
      )
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('A')
      expect(result).toContain('C')
      expect(result).not.toContain("'B'")
    })

    it('handles three-way intersect with one filtered', () => {
      const expr = intersect(
        intersect(
          id('A'),
          id('B', [{ principals: ['bob'] }]), // filtered
        ),
        id('C'),
      )
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      // A ∩ ∅ ∩ C = ∅
      expect(result).toBe('false')
    })

    it('handles multiple excludes with partial filtering', () => {
      const expr = exclude(
        exclude(
          id('A'),
          id('B', [{ principals: ['bob'] }]), // filtered, so A \ ∅ = A
        ),
        id('C'),
      )
      // A \ C
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('A')
      expect(result).toContain('C')
      expect(result).not.toContain("'B'")
      expect(result).toContain('AND NOT')
    })

    it('handles mixed unrestricted and principal-scoped in union', () => {
      const expr = union(
        id('A', [{ principals: ['alice'] }]), // filtered for eve
        id('B'), // unrestricted
      )
      // For eve, A is filtered, result is just B
      const result = gen.toPermCheck(expr, 'target', 'read', 'eve')
      expect(result).toContain('B')
      expect(result).not.toContain("'A'")
      expect(result).not.toContain('OR')
    })

    it('handles principal + perm + nodes combined in single scope', () => {
      const expr = id('USER1', [
        {
          principals: ['alice'],
          perms: ['read'],
          nodes: ['ws-1'],
        },
      ])
      // All three constraints must pass
      const result = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(result).toContain('USER1')
      expect(result).toContain('ws-1')
      expect(result).not.toBe('false')

      // Wrong principal
      const resultBadPrincipal = gen.toPermCheck(expr, 'target', 'read', 'eve')
      expect(resultBadPrincipal).toBe('false')

      // Wrong perm
      const resultBadPerm = gen.toPermCheck(expr, 'target', 'write', 'alice')
      expect(resultBadPerm).toBe('false')
    })

    it('handles multiple scopes with partial principal matches', () => {
      const expr = id('USER1', [
        { principals: ['alice'] }, // matches alice
        { principals: ['bob'] }, // doesn't match alice
        { principals: ['alice', 'eve'] }, // matches alice
      ])
      const result = anyScopeAllows(expr.scopes, 'alice', 'read')
      expect(result.allowed).toBe(true)
      expect(result.applicableScopes).toHaveLength(2) // Two scopes allow alice
    })
  })
})

// =============================================================================
// INTEGRATION TESTS: Full Access Check with Principal Filtering
// =============================================================================

describe('AUTH_V2: Principal-Scoped Access Check', () => {
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

  describe('Basic Principal Filtering', () => {
    it('grants access when principal is allowed by scope', async () => {
      // Create identity with principal-scoped permission
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'SCOPED_USER' },
      })
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'SCOPED_USER', moduleId: 'M1' } },
      )

      // Access via expression with principal scope allowing 'alice'
      const gen = createCypherGenerator()
      const expr: IdentityExpr = {
        kind: 'identity',
        id: 'SCOPED_USER',
        scopes: [{ principals: ['alice', 'bob'] }],
      }

      const permCheck = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(permCheck).not.toBe('false')

      // Verify it actually finds the permission
      const query = `
        MATCH (target:Node {id: 'M1'})
        WHERE ${permCheck}
        RETURN true AS found
      `
      const results = await ctx.executor.run<{ found: boolean }>(query, {})
      expect(results[0]?.found).toBe(true)
    })

    it('denies access when principal is not allowed by scope', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'SCOPED_USER2' },
      })
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'SCOPED_USER2', moduleId: 'M1' } },
      )

      const gen = createCypherGenerator()
      const expr: IdentityExpr = {
        kind: 'identity',
        id: 'SCOPED_USER2',
        scopes: [{ principals: ['alice', 'bob'] }],
      }

      // Eve is not in the principals list
      const permCheck = gen.toPermCheck(expr, 'target', 'read', 'eve')
      expect(permCheck).toBe('false')
    })
  })

  describe('Union with Principal Filtering', () => {
    it('grants via allowed branch when other branch is filtered', async () => {
      // USER1 has read on M1 (from seed data)
      // Create ADMIN_ROLE that only alice can invoke
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'ADMIN_ROLE' },
      })
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'ADMIN_ROLE', moduleId: 'M2' } },
      )

      const gen = createCypherGenerator()
      // USER1 ∪ ADMIN_ROLE, where ADMIN_ROLE is only for alice
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'USER1' }, // no scope restriction
        right: {
          kind: 'identity',
          id: 'ADMIN_ROLE',
          scopes: [{ principals: ['alice'] }],
        },
      }

      // For 'eve', ADMIN_ROLE is filtered, so result is just USER1
      const permCheck = gen.toPermCheck(expr, 'target', 'read', 'eve')
      expect(permCheck).not.toBe('false')
      expect(permCheck).not.toContain('ADMIN_ROLE')

      // Should find M1 (USER1 has read via root)
      const query = `
        MATCH (target:Node {id: 'M1'})
        WHERE ${permCheck}
        RETURN true AS found
      `
      const results = await ctx.executor.run<{ found: boolean }>(query, {})
      expect(results[0]?.found).toBe(true)
    })
  })

  describe('Intersect with Principal Filtering', () => {
    it('denies when one branch is filtered (A ∩ ∅ = ∅)', async () => {
      const gen = createCypherGenerator()
      const expr: IdentityExpr = {
        kind: 'intersect',
        left: { kind: 'identity', id: 'A' },
        right: {
          kind: 'identity',
          id: 'B',
          scopes: [{ principals: ['alice'] }],
        },
      }

      // For 'eve', B is filtered
      const permCheck = gen.toPermCheck(expr, 'target', 'read', 'eve')
      expect(permCheck).toBe('false')
    })

    it('grants when both branches allowed for principal', async () => {
      const gen = createCypherGenerator()
      const expr: IdentityExpr = {
        kind: 'intersect',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      }

      const permCheck = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(permCheck).not.toBe('false')

      // A ∩ B should have read on M1 (both A and B have it in seed data)
      const query = `
        MATCH (target:Node {id: 'M1'})
        WHERE ${permCheck}
        RETURN true AS found
      `
      const results = await ctx.executor.run<{ found: boolean }>(query, {})
      expect(results[0]?.found).toBe(true)
    })
  })

  describe('Exclude with Principal Filtering', () => {
    it('ignores filtered exclusion (A \\ ∅ = A)', async () => {
      // Create BLACKLIST identity
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'BLACKLIST' },
      })
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'BLACKLIST', moduleId: 'M1' } },
      )

      const gen = createCypherGenerator()
      // USER1 \ BLACKLIST, where BLACKLIST only applies to alice
      const expr: IdentityExpr = {
        kind: 'exclude',
        left: { kind: 'identity', id: 'USER1' },
        right: {
          kind: 'identity',
          id: 'BLACKLIST',
          scopes: [{ principals: ['alice'] }],
        },
      }

      // For 'eve', BLACKLIST is filtered, so result is just USER1
      const permCheck = gen.toPermCheck(expr, 'target', 'read', 'eve')
      expect(permCheck).not.toBe('false')
      expect(permCheck).not.toContain('BLACKLIST')
      expect(permCheck).not.toContain('AND NOT')
    })

    it('applies exclusion when principal can invoke it', async () => {
      await ctx.connection.graph.query('CREATE (i:Node:Identity {id: $id})', {
        params: { id: 'BLACKLIST2' },
      })
      await ctx.connection.graph.query(
        `MATCH (i:Identity {id: $identityId}), (m:Module {id: $moduleId})
         CREATE (i)-[:hasPerm {perm: 'read'}]->(m)`,
        { params: { identityId: 'BLACKLIST2', moduleId: 'M1' } },
      )

      const gen = createCypherGenerator()
      const expr: IdentityExpr = {
        kind: 'exclude',
        left: { kind: 'identity', id: 'A' }, // has read on M1, M2
        right: {
          kind: 'identity',
          id: 'BLACKLIST2',
          scopes: [{ principals: ['alice'] }],
        },
      }

      // For 'alice', BLACKLIST2 applies
      const permCheck = gen.toPermCheck(expr, 'target', 'read', 'alice')
      expect(permCheck).toContain('AND NOT')
      expect(permCheck).toContain('BLACKLIST2')

      // M1 should be denied (BLACKLIST2 has read on M1)
      const queryM1 = `
        MATCH (target:Node {id: 'M1'})
        WHERE ${permCheck}
        RETURN true AS found
      `
      const resultsM1 = await ctx.executor.run<{ found: boolean }>(queryM1, {})
      expect(resultsM1[0]?.found).toBeUndefined() // No result = denied

      // M2 should be granted (A has read, BLACKLIST2 doesn't)
      const queryM2 = `
        MATCH (target:Node {id: 'M2'})
        WHERE ${permCheck}
        RETURN true AS found
      `
      const resultsM2 = await ctx.executor.run<{ found: boolean }>(queryM2, {})
      expect(resultsM2[0]?.found).toBe(true)
    })
  })
})
