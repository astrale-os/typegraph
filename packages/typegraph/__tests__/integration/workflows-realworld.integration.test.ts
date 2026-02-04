/**
 * Integration Tests: Real-World Workflow Patterns
 *
 * Tests common production patterns: soft deletes, audit trails, versioning,
 * multi-tenancy, and other real-world application scenarios.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

describe('Real-World Workflows', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  it('soft delete pattern - preserve but mark as deleted', async () => {
    // Create post
    const post = await ctx.graph.create('post', {
      id: 'soft-delete-post',
      title: 'Soft Delete Test',
      content: 'This will be soft deleted',
      views: 10,
    })

    // Mark as deleted (via raw update since schema doesn't have deletedAt)
    await ctx.connection.run(
      `MATCH (n:Node:Post {id: $id}) SET n.deletedAt = $deletedAt`,
      {
        id: post.id,
        deletedAt: new Date().toISOString(),
      },
    )

    // Query excluding soft-deleted using raw WHERE
    const activePostsQuery = await ctx.graph.raw<{ id: string; title: string }>(
      `MATCH (p:Node:Post) WHERE p.deletedAt IS NULL RETURN p.id as id, p.title as title`,
      {},
    )

    expect(activePostsQuery.every((p) => p.id !== post.id)).toBe(true)

    // Admin query including deleted
    const allPostsQuery = await ctx.graph.raw<{ id: string; title: string }>(
      `MATCH (p:Node:Post) RETURN p.id as id, p.title as title`,
      {},
    )

    expect(allPostsQuery.some((p) => p.id === post.id)).toBe(true)
  })

  it('audit trail - track creation and modifications', async () => {
    const now = new Date().toISOString()

    // Create with audit fields
    await ctx.connection.run(
      `CREATE (p:Node:Post {
        id: $id,
        title: $title,
        views: 0,
        createdBy: $userId,
        createdAt: $createdAt,
        updatedBy: $userId,
        updatedAt: $createdAt
      })`,
      {
        id: 'audit-post',
        title: 'Audited Post',
        userId: 'user-1',
        createdAt: now,
      },
    )

    // Update with different user
    const updateTime = new Date().toISOString()
    await ctx.connection.run(
      `MATCH (p:Node:Post {id: $id})
       SET p.title = $title,
           p.updatedBy = $updatedBy,
           p.updatedAt = $updatedAt`,
      {
        id: 'audit-post',
        title: 'Updated Title',
        updatedBy: 'user-2',
        updatedAt: updateTime,
      },
    )

    // Verify audit trail
    const [result] = await ctx.graph.raw<{
      createdBy: string
      updatedBy: string
      createdAt: string
      updatedAt: string
    }>(`MATCH (p:Node:Post {id: $id}) RETURN p.createdBy as createdBy, p.updatedBy as updatedBy, p.createdAt as createdAt, p.updatedAt as updatedAt`, {
      id: 'audit-post',
    })

    expect(result).toBeDefined()
    expect(result!.createdBy).toBe('user-1')
    expect(result!.updatedBy).toBe('user-2')
    expect(result!.createdAt).toBe(now)
    expect(result!.updatedAt).toBe(updateTime)
  })

  it('versioning - track document revisions', async () => {
    // Create document
    const doc = await ctx.graph.create('post', {
      id: 'versioned-doc',
      title: 'Document v1',
      content: 'Initial content',
      views: 0,
    })

    // Add version metadata via raw
    await ctx.connection.run(
      `MATCH (p:Node:Post {id: $id}) SET p.version = $version`,
      { id: doc.id, version: 1 },
    )

    // Create new version
    const docV2 = await ctx.graph.create('post', {
      id: 'versioned-doc-v2',
      title: 'Document v2',
      content: 'Updated content',
      views: 0,
    })

    await ctx.connection.run(
      `MATCH (p:Node:Post {id: $id}) SET p.version = $version`,
      { id: docV2.id, version: 2 },
    )

    // Link versions with custom edge (using raw since not in schema)
    await ctx.connection.run(
      `MATCH (old:Node:Post {id: $oldId}), (new:Node:Post {id: $newId})
       CREATE (new)-[:supersedes]->(old)`,
      { oldId: doc.id, newId: docV2.id },
    )

    // Query: Get latest version
    const [latest] = await ctx.graph.raw<{ id: string; version: number; title: string }>(
      `MATCH (p:Node:Post)
       WHERE p.id IN [$id1, $id2]
       RETURN p.id as id, p.version as version, p.title as title
       ORDER BY p.version DESC
       LIMIT 1`,
      { id1: doc.id, id2: docV2.id },
    )

    expect(latest).toBeDefined()
    expect(latest!.version).toBe(2)
    expect(latest!.id).toBe(docV2.id)

    // Query: Get version history
    const history = await ctx.graph.raw<{ version: number; title: string }>(
      `MATCH (p:Node:Post)
       WHERE p.id IN [$id1, $id2]
       RETURN p.version as version, p.title as title
       ORDER BY p.version ASC`,
      { id1: doc.id, id2: docV2.id },
    )

    expect(history).toHaveLength(2)
    expect(history[0]!.version).toBe(1)
    expect(history[1]!.version).toBe(2)
  })

  it('multi-tenancy - tenant data isolation', async () => {
    // Create data for tenant A
    await ctx.connection.run(
      `CREATE (p:Node:Post {
        id: $id,
        title: $title,
        views: 0,
        tenantId: $tenantId
      })`,
      { id: 'tenant-a-post-1', title: 'Tenant A Post 1', tenantId: 'tenant-a' },
    )

    await ctx.connection.run(
      `CREATE (p:Node:Post {
        id: $id,
        title: $title,
        views: 0,
        tenantId: $tenantId
      })`,
      { id: 'tenant-a-post-2', title: 'Tenant A Post 2', tenantId: 'tenant-a' },
    )

    // Create data for tenant B
    await ctx.connection.run(
      `CREATE (p:Node:Post {
        id: $id,
        title: $title,
        views: 0,
        tenantId: $tenantId
      })`,
      { id: 'tenant-b-post-1', title: 'Tenant B Post 1', tenantId: 'tenant-b' },
    )

    // Query with tenant filter
    const tenantAPosts = await ctx.graph.raw<{ id: string; title: string }>(
      `MATCH (p:Node:Post {tenantId: $tenantId})
       RETURN p.id as id, p.title as title`,
      { tenantId: 'tenant-a' },
    )

    expect(tenantAPosts).toHaveLength(2)
    expect(tenantAPosts.every((p) => p.title.startsWith('Tenant A'))).toBe(true)

    const tenantBPosts = await ctx.graph.raw<{ id: string; title: string }>(
      `MATCH (p:Node:Post {tenantId: $tenantId})
       RETURN p.id as id, p.title as title`,
      { tenantId: 'tenant-b' },
    )

    expect(tenantBPosts).toHaveLength(1)
    expect(tenantBPosts[0]!.title).toBe('Tenant B Post 1')

    // Verify no cross-tenant leakage
    const tenantAIds = tenantAPosts.map((p) => p.id)
    const tenantBIds = tenantBPosts.map((p) => p.id)

    expect(tenantAIds.some((id) => tenantBIds.includes(id))).toBe(false)
  })

  it('rate limiting - track request counts', async () => {
    const userId = ctx.data.users.alice

    // Simulate API requests with counters (via raw)
    const requestLimit = 10
    const windowStart = new Date().toISOString()

    // Set request counter
    await ctx.connection.run(
      `MATCH (u:Node:User {id: $userId})
       SET u.requestCount = $count,
           u.windowStart = $windowStart`,
      { userId, count: 5, windowStart },
    )

    // Check if under limit
    const [status] = await ctx.graph.raw<{ requestCount: number; allowed: boolean }>(
      `MATCH (u:Node:User {id: $userId})
       RETURN u.requestCount as requestCount,
              u.requestCount < $limit as allowed`,
      { userId, limit: requestLimit },
    )

    expect(status).toBeDefined()
    expect(status!.requestCount).toBe(5)
    expect(status!.allowed).toBe(true)

    // Increment counter
    await ctx.connection.run(
      `MATCH (u:Node:User {id: $userId})
       SET u.requestCount = u.requestCount + 1`,
      { userId },
    )

    // Verify increment
    const [afterIncrement] = await ctx.graph.raw<{ requestCount: number }>(
      `MATCH (u:Node:User {id: $userId}) RETURN u.requestCount as requestCount`,
      { userId },
    )

    expect(afterIncrement!.requestCount).toBe(6)
  })

  it('content moderation - flag and review workflow', async () => {
    const post = await ctx.graph.create('post', {
      id: 'moderation-post',
      title: 'Potentially Problematic Post',
      content: 'Some content',
      views: 0,
    })

    // Flag for moderation
    await ctx.connection.run(
      `MATCH (p:Node:Post {id: $id})
       SET p.flagged = true,
           p.flagReason = $reason,
           p.flaggedAt = $flaggedAt`,
      {
        id: post.id,
        reason: 'Spam',
        flaggedAt: new Date().toISOString(),
      },
    )

    // Query flagged content
    const flagged = await ctx.graph.raw<{
      id: string
      title: string
      flagReason: string
    }>(`MATCH (p:Node:Post) WHERE p.flagged = true RETURN p.id as id, p.title as title, p.flagReason as flagReason`, {})

    expect(flagged.some((p) => p.id === post.id)).toBe(true)
    expect(flagged.find((p) => p.id === post.id)?.flagReason).toBe('Spam')

    // Moderator approves
    await ctx.connection.run(
      `MATCH (p:Node:Post {id: $id})
       SET p.flagged = false,
           p.moderatedBy = $moderatorId,
           p.moderatedAt = $moderatedAt,
           p.moderationStatus = $status`,
      {
        id: post.id,
        moderatorId: 'moderator-1',
        moderatedAt: new Date().toISOString(),
        status: 'approved',
      },
    )

    // Verify no longer flagged
    const stillFlagged = await ctx.graph.raw<{ id: string }>(
      `MATCH (p:Node:Post {id: $id}) WHERE p.flagged = true RETURN p.id as id`,
      { id: post.id },
    )

    expect(stillFlagged).toHaveLength(0)
  })

  it('search relevance - weighted scoring', async () => {
    // Create posts with different relevance
    const posts = await ctx.graph.createMany('post', [
      { id: 'search-1', title: 'Graph Databases', content: 'All about graphs', views: 100 },
      { id: 'search-2', title: 'Introduction to Graphs', content: 'Graph theory', views: 50 },
      { id: 'search-3', title: 'Data Structures', content: 'Including graphs', views: 75 },
    ])

    // Query with relevance scoring (title match = 2x, content match = 1x)
    const results = await ctx.graph.raw<{ id: string; title: string; score: number }>(
      `MATCH (p:Node:Post)
       WHERE p.title CONTAINS $term OR p.content CONTAINS $term
       WITH p,
         (CASE WHEN p.title CONTAINS $term THEN 2 ELSE 0 END +
          CASE WHEN p.content CONTAINS $term THEN 1 ELSE 0 END) as score
       RETURN p.id as id, p.title as title, score
       ORDER BY score DESC`,
      { term: 'graph' },
    )

    expect(results.length).toBeGreaterThan(0)

    // "Graph Databases" should score 3 (title + content)
    // "Introduction to Graphs" should score 3 (title + content)
    // "Data Structures" should score 1 (content only)
    const scores = results.map((r) => ({ id: r.id, score: r.score }))
    expect(scores.some((s) => s.score === 3)).toBe(true)
    expect(scores.some((s) => s.score === 1)).toBe(true)

    // Highest scores first
    expect(results[0]!.score).toBeGreaterThanOrEqual(results[results.length - 1]!.score)
  })

  it('recommendation system - friend-of-friend suggestions', async () => {
    // Create network: Alice -> Bob, Bob -> Charlie
    const alice = ctx.data.users.alice
    const bob = ctx.data.users.bob
    const charlie = ctx.data.users.charlie

    // Ensure relationships
    await ctx.graph.link('follows', alice, bob)
    await ctx.graph.link('follows', bob, charlie)

    // Find users Alice might want to follow (friends of friends, not already following)
    const suggestions = await ctx.graph.raw<{ id: string; name: string; mutualFriends: number }>(
      `MATCH (me:Node:User {id: $userId})-[:follows]->(friend)-[:follows]->(suggestion)
       WHERE NOT (me)-[:follows]->(suggestion)
         AND suggestion.id <> $userId
       RETURN DISTINCT suggestion.id as id,
              suggestion.name as name,
              count(DISTINCT friend) as mutualFriends
       ORDER BY mutualFriends DESC`,
      { userId: alice },
    )

    expect(suggestions.some((s) => s.id === charlie)).toBe(true)
    const charlieSuggestion = suggestions.find((s) => s.id === charlie)
    expect(charlieSuggestion?.mutualFriends).toBe(1) // Bob is mutual friend
  })

  it('activity feed - aggregate recent actions', async () => {
    const alice = ctx.data.users.alice

    // Get recent activity (posts and comments)
    const activity = await ctx.graph.raw<{
      type: string
      id: string
      title?: string
      text?: string
      timestamp: string
    }>(
      `MATCH (u:Node:User {id: $userId})-[:authored]->(p:Node:Post)
       WITH 'post' as type, p.id as id, p.title as title, null as text, p.id as timestamp
       UNION ALL
       MATCH (u:Node:User {id: $userId})-[:wroteComment]->(c:Node:Comment)
       WITH 'comment' as type, c.id as id, null as title, c.text as text, c.id as timestamp
       RETURN type, id, title, text, timestamp
       ORDER BY timestamp DESC
       LIMIT 10`,
      { userId: alice },
    )

    expect(activity.length).toBeGreaterThan(0)

    // Should have both posts and comments (if any)
    const types = new Set(activity.map((a) => a.type))
    expect(types.has('post')).toBe(true)
  })

  it('permission inheritance - folder permissions cascade', async () => {
    // Create folder hierarchy with permissions
    const workspace = await ctx.graph.create('folder', {
      id: 'workspace-perm',
      name: 'Workspace',
      path: '/workspace',
    })

    const project = await ctx.graph.createChild('folder', workspace.id, {
      id: 'project-perm',
      name: 'Project',
      path: '/workspace/project',
    })

    const file = await ctx.graph.createChild('folder', project.id, {
      id: 'file-perm',
      name: 'File',
      path: '/workspace/project/file',
    })

    // Set permission on workspace
    await ctx.connection.run(
      `MATCH (f:Node:Folder {id: $id})
       SET f.permissions = $permissions`,
      { id: workspace.id, permissions: JSON.stringify({ userId: 'user-1', role: 'admin' }) },
    )

    // Query inherited permissions
    const fileWithPerms = await ctx.graph.raw<{
      fileId: string
      workspaceId: string
      permissions: string
    }>(
      `MATCH (file:Node:Folder {id: $fileId})-[:hasParent*]->(workspace:Node:Folder)
       WHERE workspace.permissions IS NOT NULL
       RETURN file.id as fileId, workspace.id as workspaceId, workspace.permissions as permissions
       LIMIT 1`,
      { fileId: file.id },
    )

    expect(fileWithPerms).toHaveLength(1)
    expect(fileWithPerms[0]!.workspaceId).toBe(workspace.id)

    const perms = JSON.parse(fileWithPerms[0]!.permissions)
    expect(perms.role).toBe('admin')
  })
})
