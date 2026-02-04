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
    const results = await ctx.executor.execute(compiled)
    const duration = Date.now() - startTime

    expect(results.data).toHaveLength(0) // None exist
    expect(duration).toBeLessThan(2000) // Should complete quickly
  })

  it('deep WHERE nesting - 50 levels', async () => {
    let query = ctx.graph.node('user')

    // Build deeply nested OR conditions
    query = query.whereComplex((where) => {
      let condition = where.field('status', 'eq', 'active')
      for (let i = 0; i < 50; i++) {
        condition = where.or(condition, where.field('name', 'eq', `User${i}`))
      }
      return condition
    })

    const compiled = query.compile()

    // Should compile without stack overflow
    expect(compiled.cypher).toBeDefined()
    expect(compiled.cypher.length).toBeGreaterThan(0)

    // Should execute without timeout
    const startTime = Date.now()
    const results = await ctx.executor.execute(compiled)
    const duration = Date.now() - startTime

    expect(results.data).toBeDefined()
    expect(duration).toBeLessThan(3000)
  })

  it('variable length path with bounded depth', async () => {
    // Create deep follow chain: A -> B -> C -> D -> E
    const users = []
    for (let i = 0; i < 5; i++) {
      const user = await ctx.graph.create('user', {
        id: `chain-user-${i}`,
        name: `ChainUser${i}`,
        email: `chain${i}@test.com`,
        status: 'active' as const,
      })
      users.push(user)
    }

    // Link in chain
    for (let i = 0; i < users.length - 1; i++) {
      await ctx.graph.link('follows', users[i]!.id, users[i + 1]!.id)
    }

    // Query with variable length
    const query = ctx.graph
      .nodeByIdWithLabel('user', users[0]!.id)
      .to('follows', { depth: { min: 1, max: 4 } })

    const compiled = query.compile()
    expect(compiled.cypher).toContain('*1..4')

    const startTime = Date.now()
    const results = await ctx.executor.execute(compiled)
    const duration = Date.now() - startTime

    // Should find users at depths 1-4
    expect(results.data.length).toBe(4)
    expect(duration).toBeLessThan(2000)
  })

  it('fan-out query - user with many posts with many comments', async () => {
    const fanoutUser = await ctx.graph.create('user', {
      id: 'fanout-user',
      name: 'FanoutUser',
      email: 'fanout@test.com',
      status: 'active' as const,
    })

    // Create 10 posts
    const posts = await ctx.graph.createMany(
      'post',
      Array.from({ length: 10 }, (_, i) => ({
        id: `fanout-post-${i}`,
        title: `Fanout Post ${i}`,
        views: 0,
      })),
    )

    // Link posts to user
    await ctx.graph.linkMany(
      'authored',
      posts.map((p) => ({ from: fanoutUser.id, to: p.id })),
    )

    // Create 5 comments per post
    for (const post of posts) {
      const comments = await ctx.graph.createMany(
        'comment',
        Array.from({ length: 5 }, (_, i) => ({
          id: `fanout-comment-${post.id}-${i}`,
          text: `Comment ${i} on ${post.id}`,
        })),
      )

      await ctx.graph.linkMany(
        'hasComment',
        comments.map((c) => ({ from: post.id, to: c.id })),
      )
    }

    // Query: User -> Posts -> Comments (cartesian product: 1 * 10 * 5 = 50 rows)
    const query = ctx.graph
      .nodeByIdWithLabel('user', fanoutUser.id)
      .as('user')
      .to('authored')
      .as('post')
      .to('hasComment')
      .as('comment')
      .returning('user', 'post', 'comment')

    const startTime = Date.now()
    const results = await ctx.executor.executeMultiNode(query.compile())
    const duration = Date.now() - startTime

    expect(results.data).toHaveLength(50)
    expect(duration).toBeLessThan(3000)

    // Verify structure
    expect(results.data[0]).toHaveProperty('user')
    expect(results.data[0]).toHaveProperty('post')
    expect(results.data[0]).toHaveProperty('comment')
  })

  it('batch create 100 nodes', async () => {
    const batch = Array.from({ length: 100 }, (_, i) => ({
      id: `batch100-${i}`,
      name: `BatchUser${i}`,
      email: `batch${i}@test.com`,
      status: 'active' as const,
    }))

    const startTime = Date.now()
    const results = await ctx.graph.createMany('user', batch)
    const duration = Date.now() - startTime

    expect(results).toHaveLength(100)
    expect(duration).toBeLessThan(5000)

    // Verify all created
    const count = await ctx.graph.node('user').where('name', 'startsWith', 'BatchUser').count()
    expect(count).toBe(100)
  })

  it('batch link 500 relationships', async () => {
    // Create 50 users and 10 posts
    const users = await ctx.graph.createMany(
      'user',
      Array.from({ length: 50 }, (_, i) => ({
        id: `batchlink-user-${i}`,
        name: `BatchLinkUser${i}`,
        email: `batchlink${i}@test.com`,
        status: 'active' as const,
      })),
    )

    const posts = await ctx.graph.createMany(
      'post',
      Array.from({ length: 10 }, (_, i) => ({
        id: `batchlink-post-${i}`,
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
    await ctx.graph.linkMany('likes', links)
    const duration = Date.now() - startTime

    expect(duration).toBeLessThan(10000)

    // Verify count
    const likeCount = await ctx.graph
      .node('user')
      .where('name', 'startsWith', 'BatchLinkUser')
      .to('likes')
      .count()
    expect(likeCount).toBe(500)
  })

  it('deep pagination - page 50 of size 1', async () => {
    // Create 60 posts
    const posts = await ctx.graph.createMany(
      'post',
      Array.from({ length: 60 }, (_, i) => ({
        id: `pagination-post-${i}`,
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

    const results = await ctx.executor.execute(compiled)
    expect(results.data).toHaveLength(1)
    expect((results.data[0] as { title: string }).title).toBe('Post 049')
  })

  it('distinct on large result set', async () => {
    // Create scenario where many paths lead to same nodes
    const hubUser = await ctx.graph.create('user', {
      id: 'hub-user',
      name: 'Hub',
      email: 'hub@test.com',
      status: 'active' as const,
    })

    const targetUser = await ctx.graph.create('user', {
      id: 'target-user',
      name: 'Target',
      email: 'target@test.com',
      status: 'active' as const,
    })

    // Create 50 intermediate users, all following both hub and target
    const intermediates = await ctx.graph.createMany(
      'user',
      Array.from({ length: 50 }, (_, i) => ({
        id: `intermediate-${i}`,
        name: `Intermediate${i}`,
        email: `intermediate${i}@test.com`,
        status: 'active' as const,
      })),
    )

    for (const user of intermediates) {
      await ctx.graph.link('follows', user.id, hubUser.id)
      await ctx.graph.link('follows', user.id, targetUser.id)
    }

    // Query: Hub <- follows <- * -> follows -> ?
    // This creates many duplicate paths to target
    const query = ctx.graph
      .nodeByIdWithLabel('user', hubUser.id)
      .from('follows')
      .to('follows')
      .distinct()

    const startTime = Date.now()
    const results = await ctx.executor.execute(query.compile())
    const duration = Date.now() - startTime

    expect(duration).toBeLessThan(3000)

    // Should return hub and target (distinct)
    const ids = (results.data as Array<{ id: string }>).map((u) => u.id)
    const uniqueIds = [...new Set(ids)]
    expect(ids).toEqual(uniqueIds)
  })

  it('complex WHERE with many fields', async () => {
    const query = ctx.graph.node('post').whereComplex((where) =>
      where.and(
        where.field('views', 'gte', 0),
        where.field('views', 'lte', 1000),
        where.field('title', 'isNotNull'),
        where.or(
          where.field('title', 'contains', 'Hello'),
          where.field('title', 'contains', 'World'),
          where.field('title', 'contains', 'Test'),
        ),
      ),
    )

    const compiled = query.compile()
    expect(compiled.cypher).toBeDefined()

    const startTime = Date.now()
    const results = await ctx.executor.execute(compiled)
    const duration = Date.now() - startTime

    expect(duration).toBeLessThan(2000)
    expect(results.data).toBeDefined()
  })

  it('empty result set operations', async () => {
    // Query that returns nothing
    const query = ctx.graph
      .node('user')
      .where('name', 'eq', 'NonExistentUser12345')
      .to('authored')

    const results = await ctx.executor.execute(query.compile())
    expect(results.data).toHaveLength(0)

    // Chain more operations on empty result
    const furtherQuery = ctx.graph
      .node('user')
      .where('name', 'eq', 'NonExistentUser12345')
      .to('authored')
      .to('hasComment')

    const furtherResults = await ctx.executor.execute(furtherQuery.compile())
    expect(furtherResults.data).toHaveLength(0)
  })

  it('special characters in string filters', async () => {
    const specialUser = await ctx.graph.create('user', {
      id: 'special-char-user',
      name: "O'Reilly's \"Book\" Store & Café",
      email: 'special@test.com',
      status: 'active' as const,
    })

    // Query with special chars
    const query = ctx.graph.node('user').where('name', 'contains', 'O\'Reilly')

    const results = await ctx.executor.execute(query.compile())
    expect(results.data).toHaveLength(1)
    expect((results.data[0] as { id: string }).id).toBe(specialUser.id)

    // Query with quotes
    const query2 = ctx.graph.node('user').where('name', 'contains', '"Book"')
    const results2 = await ctx.executor.execute(query2.compile())
    expect(results2.data).toHaveLength(1)
  })
})
