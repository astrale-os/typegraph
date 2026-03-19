/**
 * Integration Tests: Set Operations
 *
 * Tests union, unionAll, and intersect operations for combining query results.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

describe('Set Operations Integration Tests', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  // ===========================================================================
  // UNION (deduplicates results)
  // ===========================================================================

  describe('Union', () => {
    it('union deduplicates results', async () => {
      // Two queries that return overlapping users (Alice is active)
      const query1 = ctx.graph.node('user').where('status', 'eq', 'active')
      const query2 = ctx.graph.node('user').where('name', 'eq', 'Alice')

      const results = await ctx.graph.union(query1, query2).execute()

      // Verify no duplicate IDs
      const ids = results.map((u) => u.id)
      expect(new Set(ids).size).toBe(ids.length)

      // Alice should appear only once even though she matches both queries
      const aliceCount = results.filter((u) => u.name === 'Alice').length
      expect(aliceCount).toBe(1)
    })

    it('union of disjoint sets returns all', async () => {
      const activeUsers = ctx.graph.node('user').where('status', 'eq', 'active')
      const inactiveUsers = ctx.graph.node('user').where('status', 'eq', 'inactive')

      const results = await ctx.graph.union(activeUsers, inactiveUsers).execute()

      // Should have all users (active + inactive = all)
      const allUsers = await ctx.graph.node('user').execute()
      expect(results.length).toBe(allUsers.length)
    })

    it('union preserves data integrity', async () => {
      const query1 = ctx.graph.node('user').where('name', 'eq', 'Alice')
      const query2 = ctx.graph.node('user').where('name', 'eq', 'Bob')

      const results = await ctx.graph.union(query1, query2).execute()

      expect(results).toHaveLength(2)
      const names = results.map((u) => u.name).sort()
      expect(names).toEqual(['Alice', 'Bob'])

      // Verify full user objects are returned
      const alice = results.find((u) => u.name === 'Alice')
      expect(alice).toMatchObject({
        email: 'alice@example.com',
        status: 'active',
      })
    })
  })

  // ===========================================================================
  // UNION ALL (preserves duplicates)
  // ===========================================================================

  describe('UnionAll', () => {
    it('unionAll preserves duplicates', async () => {
      // Same query twice should double results
      const query = ctx.graph.node('user').where('status', 'eq', 'active')

      const single = await query.execute()
      const doubled = await ctx.graph.unionAll(query, query).execute()

      expect(doubled.length).toBe(single.length * 2)
    })

    it('unionAll with overlapping queries keeps both occurrences', async () => {
      // Both queries will return Alice
      const query1 = ctx.graph.node('user').where('status', 'eq', 'active')
      const query2 = ctx.graph.node('user').where('name', 'eq', 'Alice')

      const results = await ctx.graph.unionAll(query1, query2).execute()

      // Alice should appear twice (once from each query)
      const aliceCount = results.filter((u) => u.name === 'Alice').length
      expect(aliceCount).toBe(2)
    })

    it('unionAll returns exact count from both queries', async () => {
      const activeQuery = ctx.graph.node('user').where('status', 'eq', 'active')
      const allQuery = ctx.graph.node('user')

      const activeCount = await activeQuery.count()
      const allCount = await allQuery.count()

      const unionAllResults = await ctx.graph.unionAll(activeQuery, allQuery).execute()

      expect(unionAllResults.length).toBe(activeCount + allCount)
    })
  })

  // ===========================================================================
  // INTERSECT (common results only)
  // ===========================================================================

  describe('Intersect', () => {
    it('intersect returns only common results', async () => {
      // Alice is active, so she should be in both
      const activeUsers = ctx.graph.node('user').where('status', 'eq', 'active')
      const usersNamedAlice = ctx.graph.node('user').where('name', 'eq', 'Alice')

      const results = await ctx.graph.intersect(activeUsers, usersNamedAlice).execute()

      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('Alice')
    })

    it('intersect of disjoint sets returns empty', async () => {
      const activeUsers = ctx.graph.node('user').where('status', 'eq', 'active')
      const charlieOnly = ctx.graph.node('user').where('name', 'eq', 'Charlie')

      // Charlie is inactive, so intersection with active users should be empty
      const results = await ctx.graph.intersect(activeUsers, charlieOnly).execute()

      expect(results.length).toBe(0)
    })

    it('intersect with multiple overlapping criteria', async () => {
      // Both Alice and Bob are active
      const activeUsers = ctx.graph.node('user').where('status', 'eq', 'active')
      const aliceOrBob = ctx.graph.node('user').where('name', 'in', ['Alice', 'Bob'])

      const results = await ctx.graph.intersect(activeUsers, aliceOrBob).execute()

      expect(results.length).toBe(2)
      const names = results.map((u) => u.name).sort()
      expect(names).toEqual(['Alice', 'Bob'])
    })

    it('intersect preserves complete node data', async () => {
      const query1 = ctx.graph.node('user').where('status', 'eq', 'active')
      const query2 = ctx.graph.node('user').where('email', 'contains', 'alice')

      const results = await ctx.graph.intersect(query1, query2).execute()

      expect(results.length).toBe(1)
      expect(results[0]).toMatchObject({
        name: 'Alice',
        email: 'alice@example.com',
        status: 'active',
      })
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Edge Cases', () => {
    it('union with empty query returns non-empty results', async () => {
      const hasUsers = ctx.graph.node('user').where('status', 'eq', 'active')
      const empty = ctx.graph.node('user').where('name', 'eq', 'NonExistent')

      const results = await ctx.graph.union(hasUsers, empty).execute()

      const activeOnly = await hasUsers.execute()
      expect(results.length).toBe(activeOnly.length)
    })

    it('unionAll with empty query preserves original count', async () => {
      const hasUsers = ctx.graph.node('user').where('status', 'eq', 'active')
      const empty = ctx.graph.node('user').where('name', 'eq', 'NonExistent')

      const results = await ctx.graph.unionAll(hasUsers, empty).execute()

      const activeOnly = await hasUsers.execute()
      expect(results.length).toBe(activeOnly.length)
    })

    it('intersect with empty query returns empty', async () => {
      const hasUsers = ctx.graph.node('user').where('status', 'eq', 'active')
      const empty = ctx.graph.node('user').where('name', 'eq', 'NonExistent')

      const results = await ctx.graph.intersect(hasUsers, empty).execute()

      expect(results.length).toBe(0)
    })

    it('set operations with more than 2 queries - union', async () => {
      const q1 = ctx.graph.node('user').where('name', 'eq', 'Alice')
      const q2 = ctx.graph.node('user').where('name', 'eq', 'Bob')
      const q3 = ctx.graph.node('user').where('name', 'eq', 'Charlie')

      const results = await ctx.graph.union(q1, q2, q3).execute()

      expect(results.length).toBe(3)
      const names = results.map((u) => u.name).sort()
      expect(names).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('set operations with more than 2 queries - unionAll', async () => {
      const sameQuery = ctx.graph.node('user').where('name', 'eq', 'Alice')

      const results = await ctx.graph.unionAll(sameQuery, sameQuery, sameQuery).execute()

      // Alice should appear 3 times
      expect(results.length).toBe(3)
      expect(results.every((u) => u.name === 'Alice')).toBe(true)
    })

    it('set operations with more than 2 queries - intersect', async () => {
      // All three queries include Alice
      const q1 = ctx.graph.node('user').where('status', 'eq', 'active')
      const q2 = ctx.graph.node('user').where('name', 'in', ['Alice', 'Bob'])
      const q3 = ctx.graph.node('user').where('email', 'contains', 'alice')

      const results = await ctx.graph.intersect(q1, q2, q3).execute()

      expect(results.length).toBe(1)
      expect(results[0]!.name).toBe('Alice')
    })

    it('union result can be further queried', async () => {
      const q1 = ctx.graph.node('user').where('name', 'eq', 'Alice')
      const q2 = ctx.graph.node('user').where('name', 'eq', 'Bob')

      const results = await ctx.graph.union(q1, q2).orderBy('name', 'ASC').execute()

      expect(results).toHaveLength(2)
      expect(results[0]!.name).toBe('Alice')
      expect(results[1]!.name).toBe('Bob')
    })

    it('intersect result can be further queried', async () => {
      const activeUsers = ctx.graph.node('user').where('status', 'eq', 'active')
      const aliceOrBob = ctx.graph.node('user').where('name', 'in', ['Alice', 'Bob'])

      const results = await ctx.graph
        .intersect(activeUsers, aliceOrBob)
        .orderBy('name', 'DESC')
        .execute()

      expect(results).toHaveLength(2)
      expect(results[0]!.name).toBe('Bob')
      expect(results[1]!.name).toBe('Alice')
    })
  })

  // ===========================================================================
  // SET OPERATIONS WITH DIFFERENT NODE TYPES
  // ===========================================================================

  describe('Set Operations on Posts', () => {
    it('union of post queries', async () => {
      const highViews = ctx.graph.node('post').where('views', 'gt', 100)
      const lowViews = ctx.graph.node('post').where('views', 'lt', 50)

      const results = await ctx.graph.union(highViews, lowViews).execute()

      // Should get high views (250) + low views (0) posts
      expect(results.length).toBe(2)
    })

    it('intersect of post queries', async () => {
      // Post with 100 views matches both: views > 50 AND views < 200
      const viewsAbove50 = ctx.graph.node('post').where('views', 'gt', 50)
      const viewsBelow200 = ctx.graph.node('post').where('views', 'lt', 200)

      const results = await ctx.graph.intersect(viewsAbove50, viewsBelow200).execute()

      // Should get post with 100 views only (250 is not < 200, 0 is not > 50)
      expect(results.length).toBe(1)
      expect(results[0]!.views).toBe(100)
    })
  })

  // ===========================================================================
  // COMPILE OUTPUT VERIFICATION
  // ===========================================================================

  describe('Compile Output', () => {
    it('union compiles to valid Cypher', () => {
      const q1 = ctx.graph.node('user').where('status', 'eq', 'active')
      const q2 = ctx.graph.node('user').where('name', 'eq', 'Alice')

      const compiled = ctx.graph.union(q1, q2).compile()

      expect(compiled.cypher).toBeDefined()
      expect(compiled.cypher.length).toBeGreaterThan(0)
    })

    it('intersect compiles to valid Cypher', () => {
      const q1 = ctx.graph.node('user').where('status', 'eq', 'active')
      const q2 = ctx.graph.node('user').where('name', 'eq', 'Alice')

      const compiled = ctx.graph.intersect(q1, q2).compile()

      expect(compiled.cypher).toBeDefined()
      expect(compiled.cypher.length).toBeGreaterThan(0)
    })
  })
})
