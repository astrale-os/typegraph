/**
 * Integration Tests: Performance & Edge Cases
 *
 * Tests system behavior under load, with large datasets, and complex queries.
 * Verifies performance characteristics and resource handling.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

describe('Performance Edge Cases', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  it('large IN list with 1000 items', async () => {
    const largeList = Array.from({ length: 1000 }, (_, i) => `fake-id-${i}`)

    const query = ctx.graph.node('user').where('id', 'in', largeList)
    const compiled = query.compile()

    // Should use parameters
    expect(compiled.params).toBeDefined()

    const startTime = Date.now()
    const results = await query.execute()
    const duration = Date.now() - startTime

    expect(results).toHaveLength(0) // None exist
    expect(duration).toBeLessThan(2000) // Should complete quickly
  })

  it('deep WHERE nesting - 50 levels', async () => {
    let query = ctx.graph.node('user')

    // Build deeply nested OR conditions using the correct API
    query = query.whereComplex((where) => {
      let condition = where.eq('status', 'active')
      for (let i = 0; i < 50; i++) {
        condition = where.or(condition, where.eq('name', `User${i}`))
      }
      return condition
    })

    const compiled = query.compile()

    // Should compile without stack overflow
    expect(compiled.cypher).toBeDefined()
    expect(compiled.cypher.length).toBeGreaterThan(0)

    // Should execute without timeout
    const startTime = Date.now()
    const results = await query.execute()
    const duration = Date.now() - startTime

    expect(results).toBeDefined()
    expect(duration).toBeLessThan(3000)
  })

  it('variable length path with bounded depth', async () => {
    // Create deep follow chain: A -> B -> C -> D -> E
    const users = []
    for (let i = 0; i < 5; i++) {
      const result = await ctx.graph.mutate.create(
        'user',
        {
          name: `ChainUser${i}`,
          email: `chain${i}@test.com`,
          status: 'active' as const,
        },
        { id: `chain-user-${i}` },
      )
      users.push(result)
    }

    // Link in chain
    for (let i = 0; i < users.length - 1; i++) {
      await ctx.graph.mutate.link('follows', users[i]!.id, users[i + 1]!.id)
    }

    // Query with variable length using raw Cypher (since depth option isn't in the type)
    const results = await ctx.graph.raw<{ id: string }>(
      `MATCH (start:User {id: $startId})-[:follows*1..4]->(reachable:User)
       RETURN DISTINCT reachable.id as id`,
      { startId: users[0]!.id },
    )

    const startTime = Date.now()
    const duration = Date.now() - startTime

    // Should find users at depths 1-4
    expect(results.length).toBe(4)
    expect(duration).toBeLessThan(2000)
  })

  it('fan-out query - user with many posts with many comments', async () => {
    const fanoutUser = await ctx.graph.mutate.create(
      'user',
      {
        name: 'FanoutUser',
        email: 'fanout@test.com',
        status: 'active' as const,
      },
      { id: 'fanout-user' },
    )

    // Create 10 posts
    const posts = await ctx.graph.mutate.createMany(
      'post',
      Array.from({ length: 10 }, (_, i) => ({
        title: `Fanout Post ${i}`,
        views: 0,
      })),
    )

    // Link posts to user
    await ctx.graph.mutate.linkMany(
      'authored',
      posts.map((p) => ({ from: fanoutUser.id, to: p.id })),
    )

    // Create 5 comments per post
    for (const post of posts) {
      const comments = await ctx.graph.mutate.createMany(
        'comment',
        Array.from({ length: 5 }, (_, i) => ({
          text: `Comment ${i} on ${post.id}`,
        })),
      )

      await ctx.graph.mutate.linkMany(
        'hasComment',
        comments.map((c) => ({ from: post.id, to: c.id })),
      )
    }

    // Query: User -> Posts -> Comments using raw Cypher for the full join
    const startTime = Date.now()
    const results = await ctx.graph.raw<{ userId: string; postId: string; commentId: string }>(
      `MATCH (u:User {id: $userId})-[:authored]->(p:Post)-[:hasComment]->(c:Comment)
       RETURN u.id as userId, p.id as postId, c.id as commentId`,
      { userId: fanoutUser.id },
    )
    const duration = Date.now() - startTime

    expect(results).toHaveLength(50)
    expect(duration).toBeLessThan(3000)

    // Verify structure
    expect(results[0]).toHaveProperty('userId')
    expect(results[0]).toHaveProperty('postId')
    expect(results[0]).toHaveProperty('commentId')
  })

  it('batch create 100 nodes', async () => {
    const batch = Array.from({ length: 100 }, (_, i) => ({
      name: `BatchUser${i}`,
      email: `batch${i}@test.com`,
      status: 'active' as const,
    }))

    const startTime = Date.now()
    const results = await ctx.graph.mutate.createMany('user', batch)
    const duration = Date.now() - startTime

    expect(results).toHaveLength(100)
    expect(duration).toBeLessThan(5000)

    // Verify all created
    const count = await ctx.graph.node('user').where('name', 'startsWith', 'BatchUser').count()
    expect(count).toBe(100)
  })

  it('batch link 500 relationships', async () => {
    // Create 50 users and 10 posts
    const users = await ctx.graph.mutate.createMany(
      'user',
      Array.from({ length: 50 }, (_, i) => ({
        name: `BatchLinkUser${i}`,
        email: `batchlink${i}@test.com`,
        status: 'active' as const,
      })),
    )

    const posts = await ctx.graph.mutate.createMany(
      'post',
      Array.from({ length: 10 }, (_, i) => ({
        title: `BatchLink Post ${i}`,
        views: 0,
      })),
    )

    // Each user likes all posts (50 * 10 = 500 relationships)
    const links = []
    for (const user of users) {
      for (const post of posts) {
        links.push({ from: user.id, to: post.id })
      }
    }

    const startTime = Date.now()
    await ctx.graph.mutate.linkMany('likes', links)
    const duration = Date.now() - startTime

    expect(duration).toBeLessThan(10000)

    // Verify count using raw query
    const [countResult] = await ctx.graph.raw<{ count: number }>(
      `MATCH (u:User)-[r:likes]->(p:Post) WHERE u.name STARTS WITH 'BatchLinkUser' RETURN count(r) as count`,
      {},
    )
    expect(countResult!.count).toBe(500)
  })

  it('deep pagination - page 50 of size 1', async () => {
    // Create 60 posts
    await ctx.graph.mutate.createMany(
      'post',
      Array.from({ length: 60 }, (_, i) => ({
        title: `Post ${String(i).padStart(3, '0')}`, // Pad for consistent sorting
        views: i,
      })),
    )

    // Query page 50
    const query = ctx.graph
      .node('post')
      .where('title', 'startsWith', 'Post ')
      .orderBy('title', 'ASC')
      .paginate({ page: 50, pageSize: 1 })

    const compiled = query.compile()
    expect(compiled.cypher).toContain('SKIP 49')
    expect(compiled.cypher).toContain('LIMIT 1')

    const results = await query.execute()
    expect(results).toHaveLength(1)
    expect(results[0]!.title).toBe('Post 049')
  })

  it('distinct on large result set', async () => {
    // Create scenario where many paths lead to same nodes
    const hubUser = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Hub',
        email: 'hub@test.com',
        status: 'active' as const,
      },
      { id: 'hub-user' },
    )

    const targetUser = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Target',
        email: 'target@test.com',
        status: 'active' as const,
      },
      { id: 'target-user' },
    )

    // Create 50 intermediate users, all following both hub and target
    const intermediates = await ctx.graph.mutate.createMany(
      'user',
      Array.from({ length: 50 }, (_, i) => ({
        name: `Intermediate${i}`,
        email: `intermediate${i}@test.com`,
        status: 'active' as const,
      })),
    )

    for (const user of intermediates) {
      await ctx.graph.mutate.link('follows', user.id, hubUser.id)
      await ctx.graph.mutate.link('follows', user.id, targetUser.id)
    }

    // Query: Hub <- follows <- * -> follows -> ? using raw query for distinct
    const startTime = Date.now()
    const results = await ctx.graph.raw<{ id: string }>(
      `MATCH (hub:User {id: $hubId})<-[:follows]-(intermediate)-[:follows]->(target)
       RETURN DISTINCT target.id as id`,
      { hubId: hubUser.id },
    )
    const duration = Date.now() - startTime

    expect(duration).toBeLessThan(3000)

    // Should return hub and target (distinct)
    const ids = results.map((u) => u.id)
    const uniqueIds = Array.from(new Set(ids))
    expect(ids).toEqual(uniqueIds)
  })

  it('complex WHERE with many fields', async () => {
    // Use correct WhereBuilder API
    const query = ctx.graph
      .node('post')
      .whereComplex((where) =>
        where.and(
          where.gte('views', 0),
          where.lte('views', 1000),
          where.isNotNull('title'),
          where.or(
            where.contains('title', 'Hello'),
            where.contains('title', 'World'),
            where.contains('title', 'Test'),
          ),
        ),
      )

    const compiled = query.compile()
    expect(compiled.cypher).toBeDefined()

    const startTime = Date.now()
    const results = await query.execute()
    const duration = Date.now() - startTime

    expect(duration).toBeLessThan(2000)
    expect(results).toBeDefined()
  })

  it('empty result set operations', async () => {
    // Query that returns nothing
    const query = ctx.graph.node('user').where('name', 'eq', 'NonExistentUser12345').to('authored')

    const results = await query.execute()
    expect(results).toHaveLength(0)

    // Chain more operations on empty result
    const furtherQuery = ctx.graph
      .node('user')
      .where('name', 'eq', 'NonExistentUser12345')
      .to('authored')
      .to('hasComment')

    const furtherResults = await furtherQuery.execute()
    expect(furtherResults).toHaveLength(0)
  })

  it('special characters in string filters', async () => {
    const specialUser = await ctx.graph.mutate.create(
      'user',
      {
        name: 'O\'Reilly\'s "Book" Store & Café',
        email: 'special@test.com',
        status: 'active' as const,
      },
      { id: 'special-char-user' },
    )

    // Query with special chars
    const query = ctx.graph.node('user').where('name', 'contains', "O'Reilly")

    const results = await query.execute()
    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe(specialUser.id)

    // Query with quotes
    const query2 = ctx.graph.node('user').where('name', 'contains', '"Book"')
    const results2 = await query2.execute()
    expect(results2).toHaveLength(1)
  })
})
