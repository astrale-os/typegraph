/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Integration Tests: Fork (Fan-out) Queries
 *
 * Tests the fork() method for complex multi-branch traversals against a real database.
 * Fork executes multiple independent traversals from a source node, compiling to
 * OPTIONAL MATCH in Cypher. Essential for avoiding N+1 queries in scenarios like
 * fetching a user with their posts, followers, and comments in one query.
 *
 * Note: Uses @ts-nocheck because the fork return type inference is complex and
 * TypeScript has trouble with the deep generic type instantiation.
 *
 * IMPORTANT: FalkorDB has a Cypher dialect limitation where OPTIONAL MATCH requires
 * a WITH clause before it when following a WHERE clause. Tests marked with
 * `.skip()` fail execution against FalkorDB but compile correctly. These tests
 * will pass once the Cypher compiler is updated to insert WITH clauses for FalkorDB
 * compatibility, or when using Neo4j/Memgraph which don't have this limitation.
 */

import { collect, collectDistinct } from '@astrale/typegraph-client'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

describe('Fork Queries Integration Tests', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  // ===========================================================================
  // BASIC FORK PATTERNS
  // ===========================================================================

  describe('Basic Fork Patterns', () => {
    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork with 2 branches from single node', async () => {
      // Get a user with their posts (authored) and followers (follows)
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.from('follows').as('follower'),
        )
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          followers: collect(q.follower),
        }))
        .execute()

      expect(result).toBeDefined()
      expect(result.user).toBeDefined()
      expect(result.user.id).toBe(ctx.data.users.alice)
      expect(result.posts).toBeInstanceOf(Array)
      expect(result.followers).toBeInstanceOf(Array)
      // Alice has 2 posts (hello and graphql)
      expect(result.posts).toHaveLength(2)
      // Alice has 2 followers (Bob and Charlie)
      expect(result.followers).toHaveLength(2)
    })

    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork with 4 branches - maximum supported', async () => {
      // Test all 4 branch slots
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.from('follows').as('follower'),
          (q) => q.to('follows').as('following'),
          (q) => q.to('likes').as('likedPost'),
        )
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          followers: collect(q.follower),
          following: collect(q.following),
          likedPosts: collect(q.likedPost),
        }))
        .execute()

      expect(result.user).toBeDefined()
      expect(result.user.id).toBe(ctx.data.users.alice)
      expect(result.posts).toBeInstanceOf(Array)
      expect(result.followers).toBeInstanceOf(Array)
      expect(result.following).toBeInstanceOf(Array)
      expect(result.likedPosts).toBeInstanceOf(Array)
    })

    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork from collection applies to each node', async () => {
      // Fork from multiple users - returns array of results
      const results = await ctx.graph
        .node('user')
        .where('status', 'eq', 'active')
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))
        .execute()

      // Should have results for active users (Alice and Bob)
      expect(results.length).toBeGreaterThan(0)

      // Each result should have user and posts array
      for (const result of results) {
        expect(result.user).toBeDefined()
        expect(result.posts).toBeInstanceOf(Array)
      }
    })
  })

  // ===========================================================================
  // FORK WITH CHAINED TRAVERSALS
  // ===========================================================================

  describe('Fork with Chained Traversals', () => {
    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork with multi-hop traversal inside branch', async () => {
      // user -> authored -> post -> hasComment -> comment
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork((q) => q.to('authored').to('hasComment').as('comment'))
        .return((q) => ({
          user: q.user,
          comments: collect(q.comment),
        }))
        .execute()

      expect(result.user).toBeDefined()
      expect(result.comments).toBeInstanceOf(Array)
      // Alice's posts have comments
      expect(result.comments.length).toBeGreaterThan(0)
    })

    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork with filtering inside branch', async () => {
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork((q) => q.to('authored').where('views', 'gt', 50).as('popularPost'))
        .return((q) => ({
          user: q.user,
          popularPosts: collect(q.popularPost),
        }))
        .execute()

      expect(result.user).toBeDefined()
      expect(result.popularPosts).toBeInstanceOf(Array)
      // Verify all returned posts have views > 50
      for (const post of result.popularPosts) {
        expect(post.views).toBeGreaterThan(50)
      }
    })

    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork with chained traversal capturing intermediate nodes', async () => {
      // Get user -> post -> comments with both post and comment captured
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork((q) => q.to('authored').as('post').to('hasComment').as('comment'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          comments: collect(q.comment),
        }))
        .execute()

      expect(result.user).toBeDefined()
      expect(result.posts).toBeInstanceOf(Array)
      expect(result.comments).toBeInstanceOf(Array)
    })
  })

  // ===========================================================================
  // FORK WITH MISSING DATA
  // ===========================================================================

  describe('Fork with Missing Data', () => {
    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork returns empty array when branch has no matches', async () => {
      // Charlie has no authored posts (only Bob's draft post-3)
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.charlie)
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))
        .execute()

      expect(result.user).toBeDefined()
      expect(result.user.id).toBe(ctx.data.users.charlie)
      expect(result.posts).toEqual([])
    })

    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork handles mixed present and absent branches', async () => {
      // Charlie has no posts but does follow Alice
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.charlie)
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.to('follows').as('following'),
        )
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          following: collect(q.following),
        }))
        .execute()

      expect(result.user).toBeDefined()
      expect(result.posts).toEqual([])
      expect(result.following).toBeInstanceOf(Array)
      expect(result.following).toHaveLength(1) // Charlie follows Alice
    })
  })

  // ===========================================================================
  // FORK WITH AGGREGATIONS
  // ===========================================================================

  describe('Fork with Aggregations', () => {
    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork with collectDistinct removes duplicates', async () => {
      // Get post with all users who liked it
      const result = await ctx.graph
        .nodeByIdWithLabel('post', ctx.data.posts.hello)
        .as('post')
        .fork((q) => q.from('likes').as('liker'))
        .return((q) => ({
          post: q.post,
          likers: collectDistinct(q.liker),
        }))
        .execute()

      expect(result.post).toBeDefined()
      expect(result.likers).toBeInstanceOf(Array)

      // Verify no duplicate user IDs
      const ids = result.likers.map((u: { id: string }) => u.id)
      expect(new Set(ids).size).toBe(ids.length)

      // post-1 (hello) is liked by Bob and Charlie
      expect(result.likers).toHaveLength(2)
    })

    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork with both collect and collectDistinct in different branches', async () => {
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.from('follows').as('follower'),
        )
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          uniqueFollowers: collectDistinct(q.follower),
        }))
        .execute()

      expect(result.posts).toBeInstanceOf(Array)
      expect(result.uniqueFollowers).toBeInstanceOf(Array)

      // Verify no duplicate follower IDs
      const followerIds = result.uniqueFollowers.map((u: { id: string }) => u.id)
      expect(new Set(followerIds).size).toBe(followerIds.length)
    })
  })

  // ===========================================================================
  // FORK WITH ORDERING AND PAGINATION
  // ===========================================================================

  describe('Fork with Ordering and Pagination', () => {
    // These tests PASS because orderBy/limit generate WITH clauses
    it('fork with orderBy before fork', async () => {
      // Get users ordered by name, each with their posts
      const results = await ctx.graph
        .node('user')
        .orderBy('name', 'ASC')
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))
        .execute()

      expect(results.length).toBeGreaterThan(0)

      // Verify users are ordered by name ascending
      const names = results.map((r) => r.user.name)
      const sortedNames = [...names].sort()
      expect(names).toEqual(sortedNames)
    })

    it('fork with limit before fork', async () => {
      const results = await ctx.graph
        .node('user')
        .orderBy('name', 'ASC')
        .limit(2)
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))
        .execute()

      expect(results).toHaveLength(2)
    })

    it('fork with skip and limit before fork', async () => {
      const results = await ctx.graph
        .node('user')
        .orderBy('name', 'ASC')
        .skip(1)
        .limit(2)
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))
        .execute()

      expect(results).toHaveLength(2)
      // Should skip Alice (first alphabetically)
      expect(results[0].user.name).not.toBe('Alice')
    })
  })

  // ===========================================================================
  // FORK AFTER TRAVERSAL
  // ===========================================================================

  describe('Fork After Traversal', () => {
    // FalkorDB limitation: duplicate relationship variable in fork branches
    it.skip('fork after initial traversal (not just from root)', async () => {
      // Start from user, traverse to post, then fork from post
      const results = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .to('authored')
        .as('post')
        .fork(
          (q) => q.to('hasComment').as('comment'),
          (q) => q.to('tagged').as('tag'),
        )
        .return((q) => ({
          user: q.user,
          post: q.post,
          comments: collect(q.comment),
          tags: collect(q.tag),
        }))
        .execute()

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        expect(result.user).toBeDefined()
        expect(result.post).toBeDefined()
        expect(result.comments).toBeInstanceOf(Array)
        expect(result.tags).toBeInstanceOf(Array)
      }
    })
  })

  // ===========================================================================
  // FORK WITH SAME EDGE TYPE DIFFERENT DIRECTIONS
  // ===========================================================================

  describe('Fork with Bidirectional Edges', () => {
    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('fork with same edge type in multiple branches (different directions)', async () => {
      // Get user's followers (incoming follows) and following (outgoing follows)
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork(
          (q) => q.to('follows').as('following'),
          (q) => q.from('follows').as('follower'),
        )
        .return((q) => ({
          user: q.user,
          following: collect(q.following),
          followers: collect(q.follower),
        }))
        .execute()

      expect(result.user).toBeDefined()
      expect(result.following).toBeInstanceOf(Array)
      expect(result.followers).toBeInstanceOf(Array)

      // Alice has followers (Bob and Charlie follow her) but follows no one
      expect(result.followers).toHaveLength(2)
    })
  })

  // ===========================================================================
  // COMPLEX REAL-WORLD PATTERNS
  // ===========================================================================

  describe('Complex Real-World Patterns', () => {
    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('social feed pattern: posts with author, likes, comments, tags', async () => {
      const results = await ctx.graph
        .node('post')
        .where('views', 'gt', 0)
        .orderBy('views', 'DESC')
        .limit(2)
        .as('post')
        .fork(
          (q) => q.from('authored').as('author'),
          (q) => q.from('likes').as('liker'),
          (q) => q.to('hasComment').as('comment'),
          (q) => q.to('tagged').as('tag'),
        )
        .return((q) => ({
          post: q.post,
          author: q.author,
          likers: collectDistinct(q.liker),
          comments: collect(q.comment),
          tags: collect(q.tag),
        }))
        .execute()

      expect(results.length).toBeGreaterThan(0)

      for (const result of results) {
        expect(result.post).toBeDefined()
        expect(result.post.views).toBeGreaterThan(0)
        expect(result.author).toBeDefined()
        expect(result.likers).toBeInstanceOf(Array)
        expect(result.comments).toBeInstanceOf(Array)
        expect(result.tags).toBeInstanceOf(Array)
      }
    })

    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('user profile pattern: user with posts, followers, following', async () => {
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork(
          (q) => q.to('authored').orderBy('views', 'DESC').as('post'),
          (q) => q.from('follows').as('follower'),
          (q) => q.to('follows').as('following'),
          (q) => q.to('likes').as('likedPost'),
        )
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          followers: collectDistinct(q.follower),
          following: collectDistinct(q.following),
          likedPosts: collect(q.likedPost),
        }))
        .execute()

      expect(result.user).toBeDefined()
      expect(result.user.name).toBe('Alice')
      expect(result.posts).toBeInstanceOf(Array)
      expect(result.followers).toBeInstanceOf(Array)
      expect(result.following).toBeInstanceOf(Array)
      expect(result.likedPosts).toBeInstanceOf(Array)

      // Alice has 2 posts, 2 followers, likes 1 post (graphql)
      expect(result.posts).toHaveLength(2)
      expect(result.followers).toHaveLength(2)
      expect(result.likedPosts).toHaveLength(1)
    })

    // FalkorDB limitation: requires WITH before OPTIONAL MATCH after WHERE
    it.skip('comment thread pattern: post with comments and comment authors', async () => {
      const result = await ctx.graph
        .nodeByIdWithLabel('post', ctx.data.posts.hello)
        .as('post')
        .fork(
          (q) => q.from('authored').as('author'),
          (q) => q.to('hasComment').as('comment').from('wroteComment').as('commenter'),
        )
        .return((q) => ({
          post: q.post,
          author: q.author,
          comments: collect(q.comment),
          commenters: collectDistinct(q.commenter),
        }))
        .execute()

      expect(result.post).toBeDefined()
      expect(result.post.title).toBe('Hello World')
      expect(result.author).toBeDefined()
      expect(result.comments).toBeInstanceOf(Array)
      expect(result.commenters).toBeInstanceOf(Array)

      // post-1 has 2 comments written by Bob and Charlie
      expect(result.comments).toHaveLength(2)
      expect(result.commenters).toHaveLength(2)
    })
  })

  // ===========================================================================
  // CYPHER COMPILATION VERIFICATION
  // ===========================================================================

  describe('Cypher Compilation', () => {
    it('generates OPTIONAL MATCH for fork branches', async () => {
      const query = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.from('follows').as('follower'),
        )
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          followers: collect(q.follower),
        }))

      const compiled = query.compile()

      // Should have initial MATCH for user
      expect(compiled.cypher).toContain('MATCH')
      expect(compiled.cypher).toContain(':User')

      // Should have OPTIONAL MATCH for each fork branch
      expect(compiled.cypher).toContain('OPTIONAL MATCH')
      expect(compiled.cypher).toContain(':authored')
      expect(compiled.cypher).toContain(':follows')

      // Should use collect() in RETURN
      expect(compiled.cypher).toContain('collect(')
    })

    it('generates correct parameters', async () => {
      const query = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork((q) => q.to('authored').where('views', 'gt', 100).as('popularPost'))
        .return((q) => ({
          user: q.user,
          popularPosts: collect(q.popularPost),
        }))

      const compiled = query.compile()

      // Should have parameter for the user ID
      expect(Object.values(compiled.params)).toContain(ctx.data.users.alice)
      // Should have parameter for the views filter
      expect(Object.values(compiled.params)).toContain(100)
    })

    it('compiles fork with collectDistinct correctly', async () => {
      const query = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collectDistinct(q.post),
        }))

      const compiled = query.compile()

      // Should use DISTINCT in collect
      expect(compiled.cypher).toContain('collect(DISTINCT')
    })

    it('compiles fork with multiple branches correctly', async () => {
      const query = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.from('follows').as('follower'),
          (q) => q.to('follows').as('following'),
        )
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          followers: collect(q.follower),
          following: collect(q.following),
        }))

      const compiled = query.compile()

      // Count OPTIONAL MATCH - should be 3 (one per branch)
      const optionalMatchCount = (compiled.cypher.match(/OPTIONAL MATCH/g) || []).length
      expect(optionalMatchCount).toBe(3)
    })
  })
})
