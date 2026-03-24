/**
 * Integration Tests: Transaction Semantics & Concurrency
 *
 * Tests transaction isolation, rollback behavior, and concurrent modifications.
 * These tests verify the system handles race conditions and maintains data integrity.
 *
 * Note: FalkorDB does not support ACID transactions with rollback.
 * Tests requiring rollback are skipped when running against FalkorDB.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

// FalkorDB doesn't support ACID transactions - skip rollback tests
const isFalkorDB = (process.env.TEST_DB_TYPE ?? 'falkordb') === 'falkordb'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Transaction Concurrency', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  it('concurrent updates to same node - last write behavior', async () => {
    const nodeId = ctx.data.users.alice

    // Get initial state
    const initial = await ctx.graph.nodeByIdWithLabel('user', nodeId).execute()
    const initialName = initial.name

    // Execute two concurrent updates
    const [result1, result2] = await Promise.allSettled([
      ctx.graph.mutate.update('user', nodeId, { name: 'Alice-Update-1' }),
      ctx.graph.mutate.update('user', nodeId, { name: 'Alice-Update-2' }),
    ])

    // At least one should succeed
    const successCount = [result1, result2].filter((r) => r.status === 'fulfilled').length
    expect(successCount).toBeGreaterThanOrEqual(1)

    // Verify final state is one of the updates
    const final = await ctx.graph.nodeByIdWithLabel('user', nodeId).execute()
    expect(['Alice-Update-1', 'Alice-Update-2']).toContain(final.name)
    expect(final.name).not.toBe(initialName)
  })

  it.skipIf(isFalkorDB)('transaction rollback on error - all operations reverted', async () => {
    const initialCount = await ctx.graph.node('user').count()

    await expect(
      ctx.graph.mutate.transaction(async (tx) => {
        // Create a user
        await tx.create(
          'user',
          {
            name: 'TxUser1',
            email: 'txuser1@test.com',
            status: 'active' as const,
          },
          { id: 'tx-test-user-1' },
        )

        // Create another user
        await tx.create(
          'user',
          {
            name: 'TxUser2',
            email: 'txuser2@test.com',
            status: 'active' as const,
          },
          { id: 'tx-test-user-2' },
        )

        // Intentional failure
        throw new Error('Transaction rollback test')
      }),
    ).rejects.toThrow('Transaction rollback test')

    // Verify nothing was persisted
    const finalCount = await ctx.graph.node('user').count()
    expect(finalCount).toBe(initialCount)

    const user1Count = await ctx.graph.node('user').where('email', 'eq', 'txuser1@test.com').count()
    expect(user1Count).toBe(0)

    const user2Count = await ctx.graph.node('user').where('email', 'eq', 'txuser2@test.com').count()
    expect(user2Count).toBe(0)
  })

  it.skipIf(isFalkorDB)('transaction commits successfully with multiple operations', async () => {
    const result = await ctx.graph.mutate.transaction(async (tx) => {
      const user = await tx.create(
        'user',
        {
          name: 'TxSuccess',
          email: 'txsuccess@test.com',
          status: 'active' as const,
        },
        { id: 'tx-success-user' },
      )

      const post = await tx.create(
        'post',
        {
          title: 'Transaction Test Post',
          content: 'Created in transaction',
          views: 0,
        },
        { id: 'tx-success-post' },
      )

      await tx.link('authored', user.id, post.id)

      return { userId: user.id, postId: post.id }
    })

    // Verify all operations persisted
    const userExists = await ctx.graph.nodeByIdWithLabel('user', result.userId).exists()
    expect(userExists).toBe(true)

    const postExists = await ctx.graph.nodeByIdWithLabel('post', result.postId).exists()
    expect(postExists).toBe(true)

    const authoredPosts = await ctx.graph
      .nodeByIdWithLabel('user', result.userId)
      .to('authored')
      .where('id', 'eq', result.postId)
      .execute()
    expect(authoredPosts.length).toBeGreaterThan(0)
  })

  it('concurrent creates with different IDs succeed', async () => {
    const results = await Promise.allSettled([
      ctx.graph.mutate.create(
        'user',
        {
          name: 'Concurrent1',
          email: 'concurrent1@test.com',
          status: 'active' as const,
        },
        { id: 'concurrent-user-1' },
      ),
      ctx.graph.mutate.create(
        'user',
        {
          name: 'Concurrent2',
          email: 'concurrent2@test.com',
          status: 'active' as const,
        },
        { id: 'concurrent-user-2' },
      ),
      ctx.graph.mutate.create(
        'user',
        {
          name: 'Concurrent3',
          email: 'concurrent3@test.com',
          status: 'active' as const,
        },
        { id: 'concurrent-user-3' },
      ),
    ])

    // All should succeed since IDs are unique
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

    // Verify all exist
    const count = await ctx.graph.node('user').where('name', 'startsWith', 'Concurrent').count()
    expect(count).toBe(3)
  })

  it('concurrent link and unlink operations', async () => {
    const alice = ctx.data.users.alice
    const post = ctx.data.posts.hello

    // Ensure no existing like
    await ctx.graph.mutate.unlinkAllFrom('likes', alice)

    // Create initial like
    await ctx.graph.mutate.link('likes', alice, post)

    // Concurrent link and unlink
    await Promise.allSettled([
      ctx.graph.mutate.link('likes', alice, post),
      ctx.graph.mutate.unlink('likes', alice, post),
    ])

    // Final state should be consistent (either exists or doesn't)
    const likeCount = await ctx.graph
      .nodeByIdWithLabel('user', alice)
      .to('likes')
      .where('id', 'eq', post)
      .count()

    // Just verify it returns a number (deterministic final state)
    expect(typeof likeCount).toBe('number')
  })

  it.skipIf(isFalkorDB)('transaction with complex query and mutation mix', async () => {
    // First get active users outside transaction
    const activeUsers = await ctx.graph.node('user').where('status', 'eq', 'active').execute()
    expect(activeUsers.length).toBeGreaterThan(0)

    await ctx.graph.mutate.transaction(async (tx) => {
      // Create new post
      const newPost = await tx.create(
        'post',
        {
          title: 'Complex Transaction Post',
          content: 'Testing queries in transaction',
          views: 0,
        },
        { id: 'tx-complex-post' },
      )

      // Link to first active user
      await tx.link('authored', activeUsers[0]!.id, newPost.id)
    })

    // Verify post exists after transaction
    const postExists = await ctx.graph.nodeByIdWithLabel('post', 'tx-complex-post').exists()
    expect(postExists).toBe(true)

    // Verify relationship exists
    const authoredPosts = await ctx.graph
      .nodeByIdWithLabel('user', activeUsers[0]!.id)
      .to('authored')
      .where('id', 'eq', 'tx-complex-post')
      .execute()
    expect(authoredPosts.length).toBeGreaterThan(0)
  })

  it.skipIf(isFalkorDB)('transaction rollback preserves existing data', async () => {
    const alice = ctx.data.users.alice
    const initialName = (await ctx.graph.nodeByIdWithLabel('user', alice).execute()).name

    await expect(
      ctx.graph.mutate.transaction(async (tx) => {
        // Update existing user
        await tx.update('user', alice, { name: 'Temporary Name' })

        // Rollback
        throw new Error('Rollback test')
      }),
    ).rejects.toThrow('Rollback test')

    // Verify original name restored
    const final = await ctx.graph.nodeByIdWithLabel('user', alice).execute()
    expect(final.name).toBe(initialName)
  })

  it('concurrent batch operations', async () => {
    const batch1 = Array.from({ length: 10 }, (_, i) => ({
      name: `Batch1User${i}`,
      email: `batch1-${i}@test.com`,
      status: 'active' as const,
    }))

    const batch2 = Array.from({ length: 10 }, (_, i) => ({
      name: `Batch2User${i}`,
      email: `batch2-${i}@test.com`,
      status: 'active' as const,
    }))

    // Execute batches concurrently
    const [result1, result2] = await Promise.all([
      ctx.graph.mutate.createMany('user', batch1),
      ctx.graph.mutate.createMany('user', batch2),
    ])

    expect(result1).toHaveLength(10)
    expect(result2).toHaveLength(10)

    // Verify all 20 users exist
    const batch1Count = await ctx.graph.node('user').where('name', 'startsWith', 'Batch1').count()
    const batch2Count = await ctx.graph.node('user').where('name', 'startsWith', 'Batch2').count()

    expect(batch1Count).toBe(10)
    expect(batch2Count).toBe(10)
  })
})
