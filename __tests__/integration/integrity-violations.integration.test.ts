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

    // Verify Alice has relationships (use execute + length since .count() isn't on traversal results)
    const authoredPosts = await ctx.graph.nodeByIdWithLabel('user', alice).to('authored').execute()
    expect(authoredPosts.length).toBeGreaterThan(0)

    // Delete without detach should fail
    await expect(ctx.graph.mutate.delete('user', alice, { detach: false })).rejects.toThrow()

    // Verify user still exists
    const userCount = await ctx.graph.node('user').where('id', 'eq', alice).count()
    expect(userCount).toBe(1)
  })

  it('delete with detach removes node and relationships', async () => {
    // Create isolated user with relationships
    const testUser = await ctx.graph.mutate.create(
      'user',
      {
        name: 'DeleteTest',
        email: 'deletetest@test.com',
        status: 'active' as const,
      },
      { id: 'delete-test-user' },
    )

    const testPost = await ctx.graph.mutate.create(
      'post',
      {
        title: 'Delete Test Post',
        views: 0,
      },
      { id: 'delete-test-post' },
    )

    await ctx.graph.mutate.link('authored', testUser.id, testPost.id)

    // Verify relationship exists
    const hasRelationship = await ctx.graph
      .nodeByIdWithLabel('user', testUser.id)
      .to('authored')
      .execute()
    expect(hasRelationship.length).toBeGreaterThan(0)

    // Delete with detach
    await ctx.graph.mutate.delete('user', testUser.id, { detach: true })

    // Verify user deleted
    const userCount = await ctx.graph.node('user').where('id', 'eq', testUser.id).count()
    expect(userCount).toBe(0)

    // Post should still exist (only incoming relationship deleted)
    const postCount = await ctx.graph.node('post').where('id', 'eq', testPost.id).count()
    expect(postCount).toBe(1)

    // Relationship should be gone - use raw query to check
    const [countResult] = await ctx.graph.raw<{ count: number }>(
      `MATCH (u:User)-[:authored]->(p:Post {id: $postId}) RETURN count(u) as count`,
      { postId: testPost.id },
    )
    expect(countResult?.count ?? 0).toBe(0)
  })

  it('link to non-existent target fails gracefully', async () => {
    const alice = ctx.data.users.alice
    const fakePostId = 'non-existent-post-12345'

    await expect(ctx.graph.mutate.link('authored', alice, fakePostId)).rejects.toThrow()

    // Verify no dangling relationship created
    const linkedToFake = await ctx.graph
      .nodeByIdWithLabel('user', alice)
      .to('authored')
      .where('id', 'eq', fakePostId)
      .execute()
    expect(linkedToFake.length).toBe(0)
  })

  it('link from non-existent source fails gracefully', async () => {
    const fakeUserId = 'non-existent-user-12345'
    const post = ctx.data.posts.hello

    await expect(ctx.graph.mutate.link('authored', fakeUserId, post)).rejects.toThrow()
  })

  it('unlink non-existent relationship succeeds silently', async () => {
    const alice = ctx.data.users.alice
    const charlie = ctx.data.users.charlie

    // Verify no relationship exists
    const relationship = await ctx.graph
      .nodeByIdWithLabel('user', alice)
      .to('follows')
      .where('id', 'eq', charlie)
      .execute()
    expect(relationship.length).toBe(0)

    // Unlink should not throw
    await expect(ctx.graph.mutate.unlink('follows', alice, charlie)).resolves.not.toThrow()
  })

  it.skip('create with duplicate ID - requires database unique constraint', async () => {
    // NOTE: Duplicate ID prevention is NOT enforced at the application level for performance.
    // To prevent duplicates, set up a unique constraint on the id property in your database:
    //   CREATE CONSTRAINT FOR (n:User) REQUIRE n.id IS UNIQUE
    //
    // Without a constraint, CREATE will create a second node with the same ID.
    // This test is skipped as it depends on database-level constraints.
    const alice = ctx.data.users.alice

    await expect(
      ctx.graph.mutate.create(
        'user',
        {
          name: 'Duplicate Alice',
          email: 'duplicate@test.com',
          status: 'active' as const,
        },
        { id: alice },
      ),
    ).rejects.toThrow()
  })

  it('update non-existent node fails', async () => {
    const fakeId = 'non-existent-node-99999'

    await expect(
      ctx.graph.mutate.update('user', fakeId, {
        name: 'Should Fail',
      }),
    ).rejects.toThrow()
  })

  it('hierarchy - circular parent detection', async () => {
    // Create chain: A -> B -> C
    const folderA = await ctx.graph.mutate.create(
      'folder',
      {
        name: 'Folder A',
        path: '/a',
      },
      { id: 'circular-test-a' },
    )

    const folderB = await ctx.graph.mutate.createChild('folder', folderA.id, {
      name: 'Folder B',
      path: '/a/b',
    })

    const folderC = await ctx.graph.mutate.createChild('folder', folderB.id, {
      name: 'Folder C',
      path: '/a/b/c',
    })

    // Try to create cycle: C -> A (should fail)
    await expect(ctx.graph.mutate.move(folderA.id, folderC.id)).rejects.toThrow(/cycle/i)

    // Verify hierarchy unchanged - use raw queries to check parent relationships
    const [bParentResult] = await ctx.graph.raw<{ parentId: string }>(
      `MATCH (child:Folder {id: $childId})-[:hasParent]->(parent:Folder) RETURN parent.id as parentId`,
      { childId: folderB.id },
    )
    expect(bParentResult?.parentId).toBe(folderA.id)

    const [cParentResult] = await ctx.graph.raw<{ parentId: string }>(
      `MATCH (child:Folder {id: $childId})-[:hasParent]->(parent:Folder) RETURN parent.id as parentId`,
      { childId: folderC.id },
    )
    expect(cParentResult?.parentId).toBe(folderB.id)
  })

  it('hierarchy - move node to itself fails', async () => {
    const folder = ctx.data.folders.work

    await expect(ctx.graph.mutate.move(folder, folder)).rejects.toThrow(/cycle|self/i)
  })

  it('hierarchy - move to non-existent parent fails', async () => {
    const folder = ctx.data.folders.work
    const fakeParent = 'non-existent-parent-123'

    await expect(ctx.graph.mutate.move(folder, fakeParent)).rejects.toThrow()
  })

  it('batch create with validation errors - partial or all fail?', async () => {
    const users = [
      {
        name: 'Valid User 1',
        email: 'valid1@test.com',
        status: 'active' as const,
      },
      {
        name: 'Invalid User',
        email: 'invalid-email', // Invalid email format
        status: 'active' as const,
      },
      {
        name: 'Valid User 2',
        email: 'valid2@test.com',
        status: 'active' as const,
      },
    ]

    // Should fail due to invalid email
    await expect(ctx.graph.mutate.createMany('user', users)).rejects.toThrow()

    // Verify nothing was created (atomic failure) - check by email since no custom IDs
    const valid1Count = await ctx.graph.node('user').where('email', 'eq', 'valid1@test.com').count()
    const valid2Count = await ctx.graph.node('user').where('email', 'eq', 'valid2@test.com').count()

    expect(valid1Count).toBe(0)
    expect(valid2Count).toBe(0)
  })

  it('unlinkAll removes all relationships of type', async () => {
    const testUser = await ctx.graph.mutate.create(
      'user',
      {
        name: 'UnlinkAllTest',
        email: 'unlinkall@test.com',
        status: 'active' as const,
      },
      { id: 'unlinkall-test-user' },
    )

    // Create multiple posts
    const posts = await ctx.graph.mutate.createMany('post', [
      { title: 'Post 1', views: 0 },
      { title: 'Post 2', views: 0 },
      { title: 'Post 3', views: 0 },
    ])

    // Link all
    await ctx.graph.mutate.linkMany(
      'authored',
      posts.map((p) => ({ from: testUser.id, to: p.id })),
    )

    // Verify all linked
    const linked = await ctx.graph.nodeByIdWithLabel('user', testUser.id).to('authored').execute()
    expect(linked.length).toBe(3)

    // Unlink all
    await ctx.graph.mutate.unlinkAllFrom('authored', testUser.id)

    // Verify none remain
    const remaining = await ctx.graph
      .nodeByIdWithLabel('user', testUser.id)
      .to('authored')
      .execute()
    expect(remaining.length).toBe(0)

    // Posts should still exist
    const postsExist = await ctx.graph
      .node('post')
      .where(
        'id',
        'in',
        posts.map((p) => p.id),
      )
      .count()
    expect(postsExist).toBe(3)
  })

  it('cascade delete via deleteSubtree', async () => {
    // Create folder tree: Root -> Child1 -> Grandchild
    const root = await ctx.graph.mutate.create(
      'folder',
      {
        name: 'Cascade Root',
        path: '/cascade',
      },
      { id: 'cascade-root' },
    )

    const child1 = await ctx.graph.mutate.createChild('folder', root.id, {
      name: 'Child 1',
      path: '/cascade/child1',
    })

    const child2 = await ctx.graph.mutate.createChild('folder', root.id, {
      name: 'Child 2',
      path: '/cascade/child2',
    })

    const grandchild = await ctx.graph.mutate.createChild('folder', child1.id, {
      name: 'Grandchild',
      path: '/cascade/child1/grandchild',
    })

    // Delete entire subtree
    await ctx.graph.mutate.deleteSubtree('folder', root.id)

    // Verify all deleted
    const rootCount = await ctx.graph.node('folder').where('id', 'eq', root.id).count()
    const child1Count = await ctx.graph.node('folder').where('id', 'eq', child1.id).count()
    const child2Count = await ctx.graph.node('folder').where('id', 'eq', child2.id).count()
    const grandchildCount = await ctx.graph.node('folder').where('id', 'eq', grandchild.id).count()

    expect(rootCount).toBe(0)
    expect(child1Count).toBe(0)
    expect(child2Count).toBe(0)
    expect(grandchildCount).toBe(0)
  })
})
