/**
 * Integration Tests: Data Integrity & Constraint Violations
 *
 * Tests cardinality enforcement, constraint violations, and referential integrity.
 * These tests verify the system properly enforces schema rules and handles violations.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

describe('Data Integrity', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  it('delete node without detach fails when relationships exist', async () => {
    const alice = ctx.data.users.alice

    // Verify Alice has relationships
    const authoredPosts = await ctx.graph
      .nodeByIdWithLabel('user', alice)
      .to('authored')
      .count()
    expect(authoredPosts).toBeGreaterThan(0)

    // Delete without detach should fail
    await expect(ctx.graph.delete('user', alice, { detach: false })).rejects.toThrow()

    // Verify user still exists
    const userExists = await ctx.graph.nodeByIdWithLabel('user', alice).exists()
    expect(userExists).toBe(true)
  })

  it('delete with detach removes node and relationships', async () => {
    // Create isolated user with relationships
    const testUser = await ctx.graph.create('user', {
      id: 'delete-test-user',
      name: 'DeleteTest',
      email: 'deletetest@test.com',
      status: 'active' as const,
    })

    const testPost = await ctx.graph.create('post', {
      id: 'delete-test-post',
      title: 'Delete Test Post',
      views: 0,
    })

    await ctx.graph.link('authored', testUser.id, testPost.id)

    // Verify relationship exists
    const hasRelationship = await ctx.graph
      .nodeByIdWithLabel('user', testUser.id)
      .to('authored')
      .exists()
    expect(hasRelationship).toBe(true)

    // Delete with detach
    await ctx.graph.delete('user', testUser.id, { detach: true })

    // Verify user deleted
    const userExists = await ctx.graph.nodeByIdWithLabel('user', testUser.id).exists()
    expect(userExists).toBe(false)

    // Post should still exist (only incoming relationship deleted)
    const postExists = await ctx.graph.nodeByIdWithLabel('post', testPost.id).exists()
    expect(postExists).toBe(true)

    // Relationship should be gone
    const orphanedPost = await ctx.graph
      .nodeByIdWithLabel('post', testPost.id)
      .from('authored')
      .exists()
    expect(orphanedPost).toBe(false)
  })

  it('link to non-existent target fails gracefully', async () => {
    const alice = ctx.data.users.alice
    const fakePostId = 'non-existent-post-12345'

    await expect(ctx.graph.link('authored', alice, fakePostId)).rejects.toThrow()

    // Verify no dangling relationship created
    const linkedToFake = await ctx.graph
      .nodeByIdWithLabel('user', alice)
      .to('authored')
      .where('id', 'eq', fakePostId)
      .exists()
    expect(linkedToFake).toBe(false)
  })

  it('link from non-existent source fails gracefully', async () => {
    const fakeUserId = 'non-existent-user-12345'
    const post = ctx.data.posts.hello

    await expect(ctx.graph.link('authored', fakeUserId, post)).rejects.toThrow()
  })

  it('unlink non-existent relationship succeeds silently', async () => {
    const alice = ctx.data.users.alice
    const charlie = ctx.data.users.charlie

    // Verify no relationship exists
    const relationshipExists = await ctx.graph
      .nodeByIdWithLabel('user', alice)
      .to('follows')
      .where('id', 'eq', charlie)
      .exists()
    expect(relationshipExists).toBe(false)

    // Unlink should not throw
    await expect(
      ctx.graph.unlink('follows', alice, charlie),
    ).resolves.not.toThrow()
  })

  it('create with duplicate ID fails', async () => {
    const alice = ctx.data.users.alice

    await expect(
      ctx.graph.create('user', {
        id: alice,
        name: 'Duplicate Alice',
        email: 'duplicate@test.com',
        status: 'active' as const,
      }),
    ).rejects.toThrow()

    // Verify original data unchanged
    const user = await ctx.graph.nodeByIdWithLabel('user', alice).execute()
    expect(user.name).toBe('Alice')
    expect(user.email).toBe('alice@example.com')
  })

  it('update non-existent node fails', async () => {
    const fakeId = 'non-existent-node-99999'

    await expect(
      ctx.graph.update('user', fakeId, {
        name: 'Should Fail',
      }),
    ).rejects.toThrow()
  })

  it('hierarchy - circular parent detection', async () => {
    // Create chain: A -> B -> C
    const folderA = await ctx.graph.create('folder', {
      id: 'circular-test-a',
      name: 'Folder A',
      path: '/a',
    })

    const folderB = await ctx.graph.createChild('folder', folderA.id, {
      id: 'circular-test-b',
      name: 'Folder B',
      path: '/a/b',
    })

    const folderC = await ctx.graph.createChild('folder', folderB.id, {
      id: 'circular-test-c',
      name: 'Folder C',
      path: '/a/b/c',
    })

    // Try to create cycle: C -> A (should fail)
    await expect(ctx.graph.move(folderA.id, folderC.id)).rejects.toThrow(/cycle/i)

    // Verify hierarchy unchanged
    const bParent = await ctx.graph.nodeByIdWithLabel('folder', folderB.id).parent()
    expect(bParent?.id).toBe(folderA.id)

    const cParent = await ctx.graph.nodeByIdWithLabel('folder', folderC.id).parent()
    expect(cParent?.id).toBe(folderB.id)
  })

  it('hierarchy - move node to itself fails', async () => {
    const folder = ctx.data.folders.work

    await expect(ctx.graph.move(folder, folder)).rejects.toThrow(/cycle|self/i)
  })

  it('hierarchy - move to non-existent parent fails', async () => {
    const folder = ctx.data.folders.work
    const fakeParent = 'non-existent-parent-123'

    await expect(ctx.graph.move(folder, fakeParent)).rejects.toThrow()
  })

  it('batch create with validation errors - partial or all fail?', async () => {
    const users = [
      {
        id: 'batch-valid-1',
        name: 'Valid User 1',
        email: 'valid1@test.com',
        status: 'active' as const,
      },
      {
        id: 'batch-invalid',
        name: 'Invalid User',
        email: 'invalid-email', // Invalid email format
        status: 'active' as const,
      },
      {
        id: 'batch-valid-2',
        name: 'Valid User 2',
        email: 'valid2@test.com',
        status: 'active' as const,
      },
    ]

    // Should fail due to invalid email
    await expect(ctx.graph.createMany('user', users)).rejects.toThrow()

    // Verify nothing was created (atomic failure)
    const valid1Exists = await ctx.graph
      .node('user')
      .where('id', 'eq', 'batch-valid-1')
      .exists()
    const valid2Exists = await ctx.graph
      .node('user')
      .where('id', 'eq', 'batch-valid-2')
      .exists()

    expect(valid1Exists).toBe(false)
    expect(valid2Exists).toBe(false)
  })

  it('unlinkAll removes all relationships of type', async () => {
    const testUser = await ctx.graph.create('user', {
      id: 'unlinkall-test-user',
      name: 'UnlinkAllTest',
      email: 'unlinkall@test.com',
      status: 'active' as const,
    })

    // Create multiple posts
    const posts = await ctx.graph.createMany('post', [
      { id: 'unlinkall-post-1', title: 'Post 1', views: 0 },
      { id: 'unlinkall-post-2', title: 'Post 2', views: 0 },
      { id: 'unlinkall-post-3', title: 'Post 3', views: 0 },
    ])

    // Link all
    await ctx.graph.linkMany(
      'authored',
      posts.map((p) => ({ from: testUser.id, to: p.id })),
    )

    // Verify all linked
    const linkedCount = await ctx.graph
      .nodeByIdWithLabel('user', testUser.id)
      .to('authored')
      .count()
    expect(linkedCount).toBe(3)

    // Unlink all
    await ctx.graph.unlinkAllFrom('authored', testUser.id)

    // Verify none remain
    const remainingCount = await ctx.graph
      .nodeByIdWithLabel('user', testUser.id)
      .to('authored')
      .count()
    expect(remainingCount).toBe(0)

    // Posts should still exist
    const postsExist = await ctx.graph
      .node('post')
      .where('id', 'in', posts.map((p) => p.id))
      .count()
    expect(postsExist).toBe(3)
  })

  it('cascade delete via deleteSubtree', async () => {
    // Create folder tree: Root -> Child1 -> Grandchild
    const root = await ctx.graph.create('folder', {
      id: 'cascade-root',
      name: 'Cascade Root',
      path: '/cascade',
    })

    const child1 = await ctx.graph.createChild('folder', root.id, {
      id: 'cascade-child1',
      name: 'Child 1',
      path: '/cascade/child1',
    })

    const child2 = await ctx.graph.createChild('folder', root.id, {
      id: 'cascade-child2',
      name: 'Child 2',
      path: '/cascade/child2',
    })

    const grandchild = await ctx.graph.createChild('folder', child1.id, {
      id: 'cascade-grandchild',
      name: 'Grandchild',
      path: '/cascade/child1/grandchild',
    })

    // Delete entire subtree
    await ctx.graph.deleteSubtree('folder', root.id)

    // Verify all deleted
    const rootExists = await ctx.graph.nodeByIdWithLabel('folder', root.id).exists()
    const child1Exists = await ctx.graph.nodeByIdWithLabel('folder', child1.id).exists()
    const child2Exists = await ctx.graph.nodeByIdWithLabel('folder', child2.id).exists()
    const grandchildExists = await ctx.graph
      .nodeByIdWithLabel('folder', grandchild.id)
      .exists()

    expect(rootExists).toBe(false)
    expect(child1Exists).toBe(false)
    expect(child2Exists).toBe(false)
    expect(grandchildExists).toBe(false)
  })
})
