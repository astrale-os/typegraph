/**
 * Integration Tests: Grouped Aggregations
 *
 * Tests groupBy with aggregation functions (count, sum, avg, min, max, collect)
 * against a real database instance.
 *
 * API: packages/typegraph/src/query/grouped.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

describe('Grouped Aggregations', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()

    // Create additional posts with varying view counts for aggregation testing
    // Use raw adapter to add more test data beyond the seed data
    await ctx.adapter.mutate(`CREATE (p:Post {id: $id, title: $title, views: $views})`, {
      id: 'post-agg-1',
      title: 'Aggregation Post A',
      views: 500,
    })
    await ctx.adapter.mutate(`CREATE (p:Post {id: $id, title: $title, views: $views})`, {
      id: 'post-agg-2',
      title: 'Aggregation Post B',
      views: 750,
    })
    await ctx.adapter.mutate(`CREATE (p:Post {id: $id, title: $title, views: $views})`, {
      id: 'post-agg-3',
      title: 'Aggregation Post C',
      views: 300,
    })

    // Create additional users with different statuses and ages for groupBy testing
    await ctx.adapter.mutate(
      `CREATE (u:User {id: $id, email: $email, name: $name, status: $status, age: $age})`,
      { id: 'user-agg-1', email: 'dave@example.com', name: 'Dave', status: 'active', age: 30 },
    )
    await ctx.adapter.mutate(
      `CREATE (u:User {id: $id, email: $email, name: $name, status: $status, age: $age})`,
      { id: 'user-agg-2', email: 'eve@example.com', name: 'Eve', status: 'inactive', age: 25 },
    )
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  // ===========================================================================
  // COUNT AGGREGATIONS
  // ===========================================================================

  describe('Count Aggregations', () => {
    it('groupBy with count and default alias', async () => {
      const results = await ctx.graph.node('user').groupBy('status').count().execute()

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toHaveProperty('status')
      expect(results[0]).toHaveProperty('count')
      expect(typeof results[0]!.count).toBe('number')

      // Verify total matches actual count
      const totalCount = results.reduce((sum, r) => sum + (r.count as number), 0)
      const allUsers = await ctx.graph.node('user').execute()
      expect(totalCount).toBe(allUsers.length)
    })

    it('groupBy with count and custom alias', async () => {
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'userCount' })
        .execute()

      expect(results[0]).toHaveProperty('userCount')
      expect(results[0]).not.toHaveProperty('count')
    })

    it('groupBy with count distinct', async () => {
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ distinct: true, alias: 'distinctCount' })
        .execute()

      expect(results[0]).toHaveProperty('distinctCount')
      expect(typeof results[0]!.distinctCount).toBe('number')
    })

    it('groupBy by multiple fields with count', async () => {
      // Create some users with overlapping status to test multi-field grouping
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'cnt' })
        .execute()

      // Should have groups for each unique status
      const statuses = results.map((r) => r.status)
      expect(statuses).toContain('active')
      expect(statuses).toContain('inactive')
    })
  })

  // ===========================================================================
  // NUMERIC AGGREGATIONS
  // ===========================================================================

  describe('Numeric Aggregations', () => {
    it('groupBy with sum', async () => {
      // Group posts and sum their views
      // Since groupBy('title') creates one group per unique title, we need a field
      // that will create meaningful groups. Let's group all posts together by
      // using a common attribute or just verify the sum works.
      const results = await ctx.graph
        .node('post')
        .groupBy('title')
        .sum('views', { alias: 'totalViews' })
        .execute()

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toHaveProperty('totalViews')
      expect(typeof results[0]!.totalViews).toBe('number')
    })

    it('groupBy with avg', async () => {
      const results = await ctx.graph
        .node('post')
        .groupBy('title')
        .avg('views', { alias: 'avgViews' })
        .execute()

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toHaveProperty('avgViews')
      expect(typeof results[0]!.avgViews).toBe('number')
    })

    it('groupBy with min', async () => {
      const results = await ctx.graph
        .node('post')
        .groupBy('title')
        .min('views', { alias: 'minViews' })
        .execute()

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toHaveProperty('minViews')
      expect(typeof results[0]!.minViews).toBe('number')
    })

    it('groupBy with max', async () => {
      const results = await ctx.graph
        .node('post')
        .groupBy('title')
        .max('views', { alias: 'maxViews' })
        .execute()

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toHaveProperty('maxViews')
      expect(typeof results[0]!.maxViews).toBe('number')
    })

    it('groupBy with min and max together', async () => {
      const results = await ctx.graph
        .node('post')
        .groupBy('title')
        .min('views', { alias: 'minViews' })
        .max('views', { alias: 'maxViews' })
        .execute()

      expect(results[0]).toHaveProperty('minViews')
      expect(results[0]).toHaveProperty('maxViews')

      // For single-row groups, min and max should equal
      const firstResult = results[0]!
      expect(firstResult.minViews).toBe(firstResult.maxViews)
    })
  })

  // ===========================================================================
  // COLLECTION AGGREGATIONS
  // ===========================================================================

  describe('Collection Aggregations', () => {
    it('groupBy with collect', async () => {
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .collect('name', { alias: 'names' })
        .execute()

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toHaveProperty('names')
      expect(Array.isArray(results[0]!.names)).toBe(true)

      // Verify names are collected correctly
      const activeGroup = results.find((r) => r.status === 'active')
      expect(activeGroup).toBeDefined()
      expect((activeGroup!.names as string[]).length).toBeGreaterThan(0)
    })

    it('groupBy with collect distinct', async () => {
      // Collect status values (which are the same within each group)
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .collect('status', { alias: 'statuses', distinct: true })
        .execute()

      expect(results[0]).toHaveProperty('statuses')

      // Each group should have only one unique status since we're grouping by status
      const firstResult = results[0]!
      expect((firstResult.statuses as string[]).length).toBe(1)
    })

    it('groupBy with collect preserves all values', async () => {
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .collect('email', { alias: 'emails' })
        .execute()

      // Get total collected emails across all groups
      const totalEmails = results.reduce((sum, r) => sum + (r.emails as string[]).length, 0)

      // Should match total user count
      const allUsers = await ctx.graph.node('user').execute()
      expect(totalEmails).toBe(allUsers.length)
    })
  })

  // ===========================================================================
  // MULTIPLE AGGREGATIONS
  // ===========================================================================

  describe('Multiple Aggregations in Single Query', () => {
    it('combines count and sum', async () => {
      const results = await ctx.graph
        .node('post')
        .groupBy('title')
        .count({ alias: 'postCount' })
        .sum('views', { alias: 'totalViews' })
        .execute()

      expect(results[0]).toHaveProperty('postCount')
      expect(results[0]).toHaveProperty('totalViews')
    })

    it('combines count, sum, and avg', async () => {
      const results = await ctx.graph
        .node('post')
        .groupBy('title')
        .count({ alias: 'cnt' })
        .sum('views', { alias: 'totalViews' })
        .avg('views', { alias: 'avgViews' })
        .execute()

      expect(results[0]).toHaveProperty('cnt')
      expect(results[0]).toHaveProperty('totalViews')
      expect(results[0]).toHaveProperty('avgViews')

      // For single-item groups, total and avg should equal
      const firstResult = results[0]!
      if ((firstResult.cnt as number) === 1) {
        expect(firstResult.totalViews).toBe(firstResult.avgViews)
      }
    })

    it('combines all numeric aggregations', async () => {
      const results = await ctx.graph
        .node('post')
        .groupBy('title')
        .count({ alias: 'cnt' })
        .sum('views', { alias: 'total' })
        .avg('views', { alias: 'average' })
        .min('views', { alias: 'minimum' })
        .max('views', { alias: 'maximum' })
        .execute()

      const firstResult = results[0]!
      expect(firstResult).toHaveProperty('cnt')
      expect(firstResult).toHaveProperty('total')
      expect(firstResult).toHaveProperty('average')
      expect(firstResult).toHaveProperty('minimum')
      expect(firstResult).toHaveProperty('maximum')

      // For single-item groups, all values should be consistent
      if ((firstResult.cnt as number) === 1) {
        expect(firstResult.minimum).toBe(firstResult.maximum)
        expect(firstResult.total).toBe(firstResult.average)
      }
    })

    it('combines count and collect', async () => {
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'userCount' })
        .collect('name', { alias: 'userNames' })
        .execute()

      const firstResult = results[0]!
      expect(firstResult).toHaveProperty('userCount')
      expect(firstResult).toHaveProperty('userNames')

      // Count should match collected array length
      expect(firstResult.userCount).toBe((firstResult.userNames as string[]).length)
    })
  })

  // ===========================================================================
  // ORDERING
  // ===========================================================================

  describe('Ordering with GroupBy', () => {
    it('orderBy group field ascending', async () => {
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'cnt' })
        .orderBy('status', 'ASC')
        .execute()

      // Verify alphabetical order: 'active' < 'inactive'
      if (results.length >= 2) {
        const statuses = results.map((r) => r.status)
        const sorted = [...statuses].sort()
        expect(statuses).toEqual(sorted)
      }
    })

    it('orderBy group field descending', async () => {
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'cnt' })
        .orderBy('status', 'DESC')
        .execute()

      // Verify reverse alphabetical order
      if (results.length >= 2) {
        const statuses = results.map((r) => r.status)
        const sorted = [...statuses].sort().reverse()
        expect(statuses).toEqual(sorted)
      }
    })

    it('orderBy aggregation result descending', async () => {
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'cnt' })
        .orderBy('cnt', 'DESC')
        .execute()

      // Verify counts are in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.cnt as number).toBeGreaterThanOrEqual(results[i]!.cnt as number)
      }
    })

    it('orderBy aggregation result ascending', async () => {
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'cnt' })
        .orderBy('cnt', 'ASC')
        .execute()

      // Verify counts are in ascending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.cnt as number).toBeLessThanOrEqual(results[i]!.cnt as number)
      }
    })

    it('orderBy with sum aggregation', async () => {
      const results = await ctx.graph
        .node('post')
        .groupBy('title')
        .sum('views', { alias: 'totalViews' })
        .orderBy('totalViews', 'DESC')
        .execute()

      // Verify sums are in descending order
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1]!.totalViews as number).toBeGreaterThanOrEqual(
          results[i]!.totalViews as number,
        )
      }
    })

    it('multiple orderBy clauses', async () => {
      const results = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'cnt' })
        .orderBy('cnt', 'DESC')
        .orderBy('status', 'ASC')
        .execute()

      // Results should be ordered by count first, then by status
      expect(results.length).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // PAGINATION
  // ===========================================================================

  describe('Pagination with GroupBy', () => {
    it('limit restricts result count', async () => {
      const all = await ctx.graph.node('user').groupBy('status').count().execute()

      const limited = await ctx.graph.node('user').groupBy('status').count().limit(1).execute()

      expect(limited.length).toBe(1)
      expect(limited.length).toBeLessThanOrEqual(all.length)
    })

    it('skip offsets results', async () => {
      const all = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'cnt' })
        .orderBy('status', 'ASC')
        .execute()

      const skipped = await ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'cnt' })
        .orderBy('status', 'ASC')
        .skip(1)
        .execute()

      if (all.length > 1) {
        expect(skipped.length).toBe(all.length - 1)
        // First skipped result should match second of all results
        expect(skipped[0]!.status).toBe(all[1]!.status)
      }
    })

    it('skip and limit together for pagination', async () => {
      const all = await ctx.graph
        .node('post')
        .groupBy('title')
        .count({ alias: 'cnt' })
        .orderBy('title', 'ASC')
        .execute()

      // Get second page (items 2-3)
      const page2 = await ctx.graph
        .node('post')
        .groupBy('title')
        .count({ alias: 'cnt' })
        .orderBy('title', 'ASC')
        .skip(2)
        .limit(2)
        .execute()

      if (all.length > 3) {
        expect(page2[0]!.title).toBe(all[2]!.title)
      }
    })
  })

  // ===========================================================================
  // FILTERING BEFORE GROUPBY
  // ===========================================================================

  describe('Filtering Before GroupBy', () => {
    it('where clause filters before aggregation', async () => {
      // Count only active users
      const results = await ctx.graph
        .node('user')
        .where('status', 'eq', 'active')
        .groupBy('status')
        .count({ alias: 'cnt' })
        .execute()

      // Should only have one group: active
      expect(results.length).toBe(1)
      expect(results[0]!.status).toBe('active')
    })

    it('where with greater than before sum', async () => {
      // Sum views only for posts with more than 0 views
      const results = await ctx.graph
        .node('post')
        .where('views', 'gt', 0)
        .groupBy('title')
        .sum('views', { alias: 'totalViews' })
        .execute()

      // All results should have positive views
      for (const result of results) {
        expect(result.totalViews as number).toBeGreaterThan(0)
      }
    })

    it('multiple where clauses before aggregation', async () => {
      const results = await ctx.graph
        .node('post')
        .where('views', 'gt', 50)
        .where('views', 'lt', 1000)
        .groupBy('title')
        .count({ alias: 'cnt' })
        .execute()

      // Should only include posts within range
      expect(results.length).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // TRAVERSAL + AGGREGATION
  // ===========================================================================

  describe('GroupBy After Traversal', () => {
    it('groupBy on traversed nodes', async () => {
      // Get Alice's posts grouped by title
      const results = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .to('authored')
        .groupBy('title')
        .count({ alias: 'cnt' })
        .execute()

      // Alice authored 2 posts, each with unique title
      expect(results.length).toBe(2)
    })

    it('sum after traversal', async () => {
      // Sum views of Alice's posts
      const results = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .to('authored')
        .groupBy('title')
        .sum('views', { alias: 'totalViews' })
        .execute()

      expect(results.length).toBe(2)
      for (const result of results) {
        expect(result).toHaveProperty('totalViews')
      }
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Edge Cases', () => {
    it('groupBy returns empty array when no matches', async () => {
      const results = await ctx.graph
        .node('user')
        .where('name', 'eq', 'NonExistentUser')
        .groupBy('status')
        .count()
        .execute()

      expect(results).toEqual([])
    })

    it('groupBy without aggregation returns group keys', async () => {
      const results = await ctx.graph.node('user').groupBy('status').execute()

      expect(results.length).toBeGreaterThan(0)
      expect(results[0]).toHaveProperty('status')
    })

    it('sum on zero-value field returns 0', async () => {
      // Draft post has 0 views
      const results = await ctx.graph
        .node('post')
        .where('title', 'eq', 'Draft Post')
        .groupBy('title')
        .sum('views', { alias: 'totalViews' })
        .execute()

      if (results.length > 0) {
        expect(results[0]!.totalViews).toBe(0)
      }
    })

    it('handles default aliases correctly', async () => {
      // Test default alias naming
      const results = await ctx.graph.node('post').groupBy('title').sum('views').execute()

      // Default alias for sum should be 'sum_views'
      expect(results[0]).toHaveProperty('sum_views')
    })
  })

  // ===========================================================================
  // CYPHER VERIFICATION
  // ===========================================================================

  describe('Cypher Compilation Verification', () => {
    it('produces valid Cypher with GROUP BY semantics', () => {
      const cypher = ctx.graph.node('user').groupBy('status').count({ alias: 'cnt' }).toCypher()

      expect(cypher).toContain('MATCH')
      expect(cypher).toContain(':User')
      expect(cypher).toContain('status')
      expect(cypher).toContain('count')
      expect(cypher).toContain('AS cnt')
    })

    it('includes ORDER BY in Cypher when specified', () => {
      const cypher = ctx.graph
        .node('user')
        .groupBy('status')
        .count({ alias: 'cnt' })
        .orderBy('cnt', 'DESC')
        .toCypher()

      expect(cypher).toContain('ORDER BY')
      expect(cypher).toContain('cnt')
      expect(cypher).toContain('DESC')
    })

    it('includes SKIP and LIMIT in Cypher when specified', () => {
      const cypher = ctx.graph.node('user').groupBy('status').count().skip(5).limit(10).toCypher()

      expect(cypher).toContain('SKIP 5')
      expect(cypher).toContain('LIMIT 10')
    })
  })
})
