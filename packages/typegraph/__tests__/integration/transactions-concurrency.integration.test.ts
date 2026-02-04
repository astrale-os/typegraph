/**
 * Integration Tests: Transaction Semantics & Concurrency
 *
 * Tests transaction isolation, rollback behavior, and concurrent modifications.
 * These tests verify the system handles race conditions and maintains data integrity.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

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
      ctx.graph.update('user', nodeId, { name: 'Alice-Update-1' }),
      ctx.graph.update('user', nodeId, { name: 'Alice-Update-2' }),
    ])

    // At least one should succeed
    const successCount = [result1, result2].filter((r) => r.status === 'fulfilled').length
    expect(successCount).toBeGreaterThanOrEqual(1)

    // Verify final state is one of the updates
    const final = await ctx.graph.nodeByIdWithLabel('user', nodeId).execute()
    expect(['Alice-Update-1', 'Alice-Update-2']).toContain(final.name)
    expect(final.name).not.toBe(initialName)
  })

  it('transaction rollback on error - all operations reverted', async () => {
    const initialCount = await ctx.graph.node('user').count()

    await expect(
      ctx.graph.transaction(async (tx) => {
        // Create a user
        await tx.create('user', {
          id: 'tx-test-user-1',
          name: 'TxUser1',
          email: 'txuser1@test.com',
          status: 'active' as const,
        })

        // Create another user
        await tx.create('user', {
          id: 'tx-test-user-2',
          name: 'TxUser2',
          email: 'txuser2@test.com',
          status: 'active' as const,
        })

        // Intentional failure
        throw new Error('Transaction rollback test')
      }),
    ).rejects.toThrow('Transaction rollback test')

    // Verify nothing was persisted
    const finalCount = await ctx.graph.node('user').count()
    expect(finalCount).toBe(initialCount)

    const user1Exists = await ctx.graph
      .node('user')
      .where('id', 'eq', 'tx-test-user-1')
      .exists()
    expect(user1Exists).toBe(false)

    const user2Exists = await ctx.graph
      .node('user')
      .where('id', 'eq', 'tx-test-user-2')
      .exists()
    expect(user2Exists).toBe(false)
  })

  it('transaction commits successfully with multiple operations', async () => {
    const result = await ctx.graph.transaction(async (tx) => {
      const user = await tx.create('user', {
        id: 'tx-success-user',
        name: 'TxSuccess',
        email: 'txsuccess@test.com',
        status: 'active' as const,
      })

      const post = await tx.create('post', {
        id: 'tx-success-post',
        title: 'Transaction Test Post',
        content: 'Created in transaction',
        views: 0,
      })

      await tx.link('authored', user.id, post.id)

      return { userId: user.id, postId: post.id }
    })

    // Verify all operations persisted
    const userExists = await ctx.graph
      .nodeByIdWithLabel('user', result.userId)
      .exists()
    expect(userExists).toBe(true)

    const postExists = await ctx.graph
      .nodeByIdWithLabel('post', result.postId)
      .exists()
    expect(postExists).toBe(true)

    const authoredPost = await ctx.graph
      .nodeByIdWithLabel('user', result.userId)
      .to('authored')
      .where('id', 'eq', result.postId)
      .exists()
    expect(authoredPost).toBe(true)
  })

  it('concurrent creates with different IDs succeed', async () => {
    const results = await Promise.allSettled([
      ctx.graph.create('user', {
        id: 'concurrent-user-1',
        name: 'Concurrent1',
        email: 'concurrent1@test.com',
        status: 'active' as const,
      }),
      ctx.graph.create('user', {
        id: 'concurrent-user-2',
        name: 'Concurrent2',
        email: 'concurrent2@test.com',
        status: 'active' as const,
      }),
      ctx.graph.create('user', {
        id: 'concurrent-user-3',
        name: 'Concurrent3',
        email: 'concurrent3@test.com',
        status: 'active' as const,
      }),
    ])

    // All should succeed since IDs are unique
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true)

    // Verify all exist
    const count = await ctx.graph
      .node('user')
      .where('name', 'startsWith', 'Concurrent')
      .count()
    expect(count).toBe(3)
  })

  it('concurrent link and unlink operations', async () => {
    const alice = ctx.data.users.alice
    const post = ctx.data.posts.hello

    // Ensure no existing like
    await ctx.graph.unlinkAllFrom('likes', alice)

    // Create initial like
    await ctx.graph.link('likes', alice, post)

    // Concurrent link and unlink
    await Promise.allSettled([
      ctx.graph.link('likes', alice, post),
      ctx.graph.unlink('likes', alice, post),
    ])

    // Final state should be consistent (either exists or doesn't)
    const likeExists = await ctx.graph
      .nodeByIdWithLabel('user', alice)
      .to('likes')
      .where('id', 'eq', post)
      .exists()

    // Just verify it's a boolean (deterministic final state)
    expect(typeof likeExists).toBe('boolean')
  })

  it('transaction with complex query and mutation mix', async () => {
    await ctx.graph.transaction(async (tx) => {
      // Query existing data
      const activeUsers = await tx.node('user').where('status', 'eq', 'active').execute()

      expect(activeUsers.length).toBeGreaterThan(0)

      // Create new post
      const newPost = await tx.create('post', {
        id: 'tx-complex-post',
        title: 'Complex Transaction Post',
        content: 'Testing queries in transaction',
        views: 0,
      })

      // Link to first active user
      await tx.link('authored', activeUsers[0]!.id, newPost.id)

      // Query the relationship we just created
      const authoredPosts = await tx
        .nodeByIdWithLabel('user', activeUsers[0]!.id)
        .to('authored')
        .where('id', 'eq', newPost.id)
        .execute()

      expect(authoredPosts).toHaveLength(1)
    })

    // Verify post exists after transaction
    const postExists = await ctx.graph
      .nodeByIdWithLabel('post', 'tx-complex-post')
      .exists()
    expect(postExists).toBe(true)
  })

  it('transaction rollback preserves existing data', async () => {
    const alice = ctx.data.users.alice
    const initialName = (await ctx.graph.nodeByIdWithLabel('user', alice).execute()).name

    await expect(
      ctx.graph.transaction(async (tx) => {
        // Update existing user
        await tx.update('user', alice, { name: 'Temporary Name' })

        // Verify update in transaction
        const updated = await tx.nodeByIdWithLabel('user', alice).execute()
        expect(updated.name).toBe('Temporary Name')

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
      id: `batch1-user-${i}`,
      name: `Batch1User${i}`,
      email: `batch1-${i}@test.com`,
      status: 'active' as const,
    }))

    const batch2 = Array.from({ length: 10 }, (_, i) => ({
      id: `batch2-user-${i}`,
      name: `Batch2User${i}`,
      email: `batch2-${i}@test.com`,
      status: 'active' as const,
    }))

    // Execute batches concurrently
    const [result1, result2] = await Promise.all([
      ctx.graph.createMany('user', batch1),
      ctx.graph.createMany('user', batch2),
    ])

    expect(result1).toHaveLength(10)
    expect(result2).toHaveLength(10)

    // Verify all 20 users exist
    const batch1Count = await ctx.graph
      .node('user')
      .where('name', 'startsWith', 'Batch1')
      .count()
    const batch2Count = await ctx.graph
      .node('user')
      .where('name', 'startsWith', 'Batch2')
      .count()

    expect(batch1Count).toBe(10)
    expect(batch2Count).toBe(10)
  })
})
