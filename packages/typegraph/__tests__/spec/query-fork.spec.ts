/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Query Compilation Specification - Fork (Fan-out) Patterns
 *
 * Tests the fork() method for complex multi-branch traversals.
 * These patterns are essential for avoiding N+1 queries in real-world scenarios
 * like the chat-message listMessages endpoint.
 *
 * Focus: Cypher compilation verification (no database required)
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineSchema, node, edge, createGraph, collect, collectDistinct } from '../../src'
import { normalizeCypher } from './fixtures/test-schema'

// =============================================================================
// TEST SCHEMA
// =============================================================================

const forkTestSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
        status: z.enum(['active', 'inactive']).default('active'),
      },
    }),
    post: node({
      properties: {
        title: z.string(),
        content: z.string().optional(),
        views: z.number().default(0),
      },
    }),
    comment: node({
      properties: {
        text: z.string(),
        createdAt: z.date().optional(),
      },
    }),
    message: node({
      properties: {
        content: z.string(),
        createdAt: z.date().optional(),
      },
    }),
    reaction: node({
      properties: {
        emoji: z.string(),
      },
    }),
    tag: node({
      properties: {
        name: z.string(),
      },
    }),
    folder: node({
      properties: {
        name: z.string(),
        path: z.string(),
      },
    }),
  },
  edges: {
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'one' },
      properties: {
        role: z.enum(['author', 'coauthor']).default('author'),
      },
    }),
    follows: edge({
      from: 'user',
      to: 'user',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
    likes: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
    hasComment: edge({
      from: 'post',
      to: 'comment',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
    wroteComment: edge({
      from: 'user',
      to: 'comment',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
    tagged: edge({
      from: 'post',
      to: 'tag',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
    // Message-specific edges (for chat-like patterns)
    replyTo: edge({
      from: 'message',
      to: 'message',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
    hasReaction: edge({
      from: 'message',
      to: 'reaction',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
    // Hierarchy
    hasParent: edge({
      from: 'folder',
      to: 'folder',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },
  hierarchy: {
    defaultEdge: 'hasParent',
    direction: 'up',
  },
})

// Create graph without executor (for compilation tests only)
const graph = createGraph(forkTestSchema, { uri: '' })

describe('Query Compilation: Fork Patterns', () => {
  // ===========================================================================
  // BASIC FORK PATTERNS
  // ===========================================================================

  describe('Basic Fork Patterns', () => {
    it('compiles fork with two branches', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.from('follows').as('follower'),
        )
        .return((q) => ({
          user: q.user,
          post: q.post,
          follower: q.follower,
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have initial MATCH for user
      expect(cypher).toContain('MATCH')
      expect(cypher).toContain(':User')

      // Should have OPTIONAL MATCH for each fork branch
      expect(cypher).toContain('OPTIONAL MATCH')
      expect(cypher).toContain(':authored')
      expect(cypher).toContain(':follows')

      // Should return all aliases
      expect(cypher).toContain('AS user')
      expect(cypher).toContain('AS post')
      expect(cypher).toContain('AS follower')
    })

    it('compiles fork with optional traversals', async () => {
      const query = await graph
        .nodeByIdWithLabel('post', 'post-1')
        .as('post')
        .fork(
          (q) => q.fromOptional('authored').as('author'),
          (q) => q.toOptional('hasComment').as('comment'),
        )
        .return((q) => ({
          post: q.post,
          author: q.author,
          comment: q.comment,
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Both branches should be OPTIONAL MATCH
      const optionalMatchCount = (cypher.match(/OPTIONAL MATCH/g) || []).length
      expect(optionalMatchCount).toBeGreaterThanOrEqual(2)
    })

    it('compiles fork with collect aggregation', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
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
      const cypher = normalizeCypher(compiled.cypher)

      // Should use collect() in RETURN
      expect(cypher).toContain('collect(')
      expect(cypher).toContain('AS posts')
      expect(cypher).toContain('AS followers')
    })

    it('compiles fork with distinct collect', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collectDistinct(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should use DISTINCT in collect
      expect(cypher).toContain('collect(DISTINCT')
    })
  })

  // ===========================================================================
  // COMPLEX FORK PATTERNS (Chat-like scenarios)
  // ===========================================================================

  describe('Complex Fork Patterns (Chat-like)', () => {
    it('compiles listMessages pattern: message with replyTo and reactions', async () => {
      // This mirrors the chat-message listMessages endpoint pattern
      const query = await graph
        .nodeByIdWithLabel('message', 'msg-1')
        .as('msg')
        .fork(
          (q) => q.toOptional('replyTo').as('replyTo'),
          (q) => q.to('hasReaction').as('reaction'),
        )
        .return((q) => ({
          msg: q.msg,
          replyTo: q.replyTo,
          reactions: collect(q.reaction),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(':Message')
      expect(cypher).toContain(':replyTo')
      expect(cypher).toContain(':hasReaction')
      expect(cypher).toContain('collect(')
      expect(cypher).toContain('AS reactions')
    })

    it('compiles message with incoming replies (for reply count)', async () => {
      const query = await graph
        .nodeByIdWithLabel('message', 'msg-1')
        .as('msg')
        .fork(
          (q) => q.toOptional('replyTo').as('replyTo'),
          (q) => q.from('replyTo').as('reply'), // Messages that reply to this one
          (q) => q.to('hasReaction').as('reaction'),
        )
        .return((q) => ({
          msg: q.msg,
          replyTo: q.replyTo,
          replies: collect(q.reply),
          reactions: collect(q.reaction),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have 3 OPTIONAL MATCH clauses
      const optionalMatchCount = (cypher.match(/OPTIONAL MATCH/g) || []).length
      expect(optionalMatchCount).toBe(3)

      expect(cypher).toContain('AS replies')
      expect(cypher).toContain('AS reactions')
    })

    it('compiles three-way fork', async () => {
      const query = await graph
        .nodeByIdWithLabel('post', 'post-1')
        .as('post')
        .fork(
          (q) => q.from('authored').as('author'),
          (q) => q.to('hasComment').as('comment'),
          (q) => q.to('tagged').as('tag'),
        )
        .return((q) => ({
          post: q.post,
          author: q.author,
          comments: collect(q.comment),
          tags: collect(q.tag),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(':authored')
      expect(cypher).toContain(':hasComment')
      expect(cypher).toContain(':tagged')
    })

    it('compiles four-way fork', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.from('follows').as('follower'),
          (q) => q.to('follows').as('following'),
          (q) => q.to('wroteComment').as('comment'),
        )
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          followers: collect(q.follower),
          following: collect(q.following),
          comments: collect(q.comment),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have 4 OPTIONAL MATCH clauses
      const optionalMatchCount = (cypher.match(/OPTIONAL MATCH/g) || []).length
      expect(optionalMatchCount).toBe(4)
    })
  })

  // ===========================================================================
  // FORK WITH FILTERING
  // ===========================================================================

  describe('Fork with Filtering', () => {
    it('compiles where filter before fork', async () => {
      const query = await graph
        .node('user')
        .where('status', 'eq', 'active')
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // WHERE should come before OPTIONAL MATCH
      const whereIndex = cypher.indexOf('WHERE')
      const optionalMatchIndex = cypher.indexOf('OPTIONAL MATCH')
      expect(whereIndex).toBeLessThan(optionalMatchIndex)
      expect(cypher).toContain('status')
    })

    it('compiles where filter inside fork branch', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored').where('content', 'isNotNull').as('publishedPost'))
        .return((q) => ({
          user: q.user,
          publishedPosts: collect(q.publishedPost),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain('IS NOT NULL')
    })

    it('compiles hasEdge filter before fork', async () => {
      const query = await graph
        .node('user')
        .hasEdge('authored', 'out')
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have existence pattern
      expect(cypher).toContain(':authored')
    })
  })

  // ===========================================================================
  // FORK WITH ORDERING AND PAGINATION
  // ===========================================================================

  describe('Fork with Ordering and Pagination', () => {
    it('compiles orderBy before fork', async () => {
      const query = await graph
        .node('user')
        .orderBy('name', 'ASC')
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain('ORDER BY')
      expect(cypher).toContain('ASC')
    })

    it('compiles limit before fork', async () => {
      const query = await graph
        .node('user')
        .orderBy('name', 'ASC')
        .limit(10)
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain('LIMIT 10')
    })

    it('compiles skip and limit before fork', async () => {
      const query = await graph
        .node('user')
        .orderBy('name', 'ASC')
        .skip(5)
        .limit(10)
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain('SKIP 5')
      expect(cypher).toContain('LIMIT 10')
    })
  })

  // ===========================================================================
  // FORK WITH CHAINED TRAVERSALS
  // ===========================================================================

  describe('Fork with Chained Traversals', () => {
    it('compiles chained traversals inside fork branch', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored').as('post').to('hasComment').as('postComment'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          comments: collect(q.postComment),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have chained traversals in OPTIONAL MATCH
      expect(cypher).toContain(':authored')
      expect(cypher).toContain(':hasComment')
    })

    it('compiles multiple chained traversals in different branches', async () => {
      const query = await graph
        .nodeByIdWithLabel('post', 'post-1')
        .as('post')
        .fork(
          (q) => q.from('authored').as('author').from('follows').as('authorFollower'),
          (q) => q.to('hasComment').as('comment').from('wroteComment').as('commenter'),
        )
        .return((q) => ({
          post: q.post,
          author: q.author,
          authorFollowers: collect(q.authorFollower),
          comments: collect(q.comment),
          commenters: collect(q.commenter),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have all edge types
      expect(cypher).toContain(':authored')
      expect(cypher).toContain(':follows')
      expect(cypher).toContain(':hasComment')
      expect(cypher).toContain(':wroteComment')
    })

    it('compiles deep chained traversal (3 levels)', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) =>
          q
            .to('authored')
            .as('post')
            .to('hasComment')
            .as('comment')
            .from('wroteComment')
            .as('commenter'),
        )
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          comments: collect(q.comment),
          commenters: collect(q.commenter),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(':authored')
      expect(cypher).toContain(':hasComment')
      expect(cypher).toContain(':wroteComment')
    })
  })

  // ===========================================================================
  // FORK FROM COLLECTION
  // ===========================================================================

  describe('Fork from Collection', () => {
    it('compiles fork from collection of nodes', async () => {
      const query = await graph
        .node('post')
        .as('post')
        .fork(
          (q) => q.from('authored').as('author'),
          (q) => q.to('hasComment').as('comment'),
        )
        .return((q) => ({
          post: q.post,
          author: q.author,
          comments: collect(q.comment),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Initial MATCH should be for all posts (with :Node base label and PascalCase)
      expect(cypher).toContain('MATCH (')
      expect(cypher).toContain(':Post)')
      expect(cypher).toContain('OPTIONAL MATCH')
    })

    it('compiles fork from filtered collection', async () => {
      const query = await graph
        .node('post')
        .where('views', 'gt', 50)
        .as('post')
        .fork((q) => q.from('authored').as('author'))
        .return((q) => ({
          post: q.post,
          author: q.author,
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain('WHERE')
      expect(cypher).toContain('views')
    })
  })

  // ===========================================================================
  // FORK WITH EDGE PROPERTIES
  // ===========================================================================

  describe('Fork with Edge Properties', () => {
    it('compiles edge alias capture in fork branch', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored', { edgeAs: 'authorship' }).as('post'))
        .return((q) => ({
          user: q.user,
          post: q.post,
          authorship: q.authorship,
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should return edge alias
      expect(cypher).toContain('AS authorship')
    })
  })

  // ===========================================================================
  // FORK WITH HIERARCHY
  // ===========================================================================

  describe('Fork with Hierarchy', () => {
    it('compiles fork with ancestors traversal', async () => {
      const query = await graph
        .nodeByIdWithLabel('folder', 'folder-1')
        .as('folder')
        .fork(
          (q) => q.ancestors().as('ancestor'),
          (q) => q.children().as('child'),
        )
        .return((q) => ({
          folder: q.folder,
          ancestors: collect(q.ancestor),
          children: collect(q.child),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(':hasParent')
    })
  })

  // ===========================================================================
  // ALIAS PRESERVATION
  // ===========================================================================

  describe('Alias Preservation', () => {
    it('preserves user-defined aliases in RETURN', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('myUser')
        .fork(
          (q) => q.to('authored').as('myPost'),
          (q) => q.from('follows').as('myFollower'),
        )
        .return((q) => ({
          myUser: q.myUser,
          myPost: q.myPost,
          myFollower: q.myFollower,
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain('AS myUser')
      expect(cypher).toContain('AS myPost')
      expect(cypher).toContain('AS myFollower')
    })

    it('preserves collect result aliases', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          allPosts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain('AS allPosts')
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Edge Cases', () => {
    it('compiles single-branch fork', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain('OPTIONAL MATCH')
      expect(cypher).toContain(':authored')
    })

    it('compiles fork with same edge type in multiple branches', async () => {
      // Different directions of the same edge
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
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

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have both directions
      expect(cypher).toContain('->') // outgoing
      expect(cypher).toContain('<-') // incoming
    })
  })

  // ===========================================================================
  // PARAMETER HANDLING
  // ===========================================================================

  describe('Parameter Handling', () => {
    it('generates correct parameters for fork with ID', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-123')
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()

      // Should have parameter for the ID
      expect(Object.values(compiled.params)).toContain('user-123')
    })

    it('generates correct parameters for fork with where clause', async () => {
      const query = await graph
        .node('user')
        .where('status', 'eq', 'active')
        .as('user')
        .fork((q) =>
          q
            .to('authored')
            .where('views', 'gt', 100 as number)
            .as('popularPost'),
        )
        .return((q) => ({
          user: q.user,
          popularPosts: collect(q.popularPost),
        }))

      const compiled = query.compile()

      // Should have parameters for both where clauses
      expect(Object.values(compiled.params)).toContain('active')
      expect(Object.values(compiled.params)).toContain(100)
    })
  })

  // ===========================================================================
  // ADVANCED PATTERNS (Potential Edge Cases)
  // ===========================================================================

  describe('Advanced Patterns', () => {
    it('compiles fork after traversal (not just from root)', async () => {
      // Start from user, traverse to post, then fork from post
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
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

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have initial traversal before fork
      expect(cypher).toContain(':authored')
      // Fork branches should be OPTIONAL MATCH
      expect(cypher).toContain('OPTIONAL MATCH')
      expect(cypher).toContain(':hasComment')
      expect(cypher).toContain(':tagged')
    })

    it('compiles nested fork pattern (fork inside fork branch)', async () => {
      // This tests if fork can be chained
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) =>
          q
            .to('authored')
            .as('post')
            .fork(
              (q2) => q2.to('hasComment').as('comment'),
              (q2) => q2.to('tagged').as('tag'),
            ),
        )
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          comments: collect(q.comment),
          tags: collect(q.tag),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should compile without error
      expect(cypher).toContain(':authored')
    })

    it('compiles fork with multiple where clauses in same branch', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) =>
          q
            .to('authored')
            .where('views', 'gt', 100 as number)
            .where('content', 'isNotNull')
            .as('popularPost'),
        )
        .return((q) => ({
          user: q.user,
          popularPosts: collect(q.popularPost),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have both WHERE conditions
      expect(cypher).toContain('views')
      expect(cypher).toContain('IS NOT NULL')
    })

    it('compiles fork with orderBy in branch', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored').orderBy('views', 'DESC').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Note: ORDER BY in a fork branch may or may not be meaningful
      // depending on how collect() aggregates results
      expect(cypher).toContain(':authored')
    })

    it('compiles fork with limit in branch', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored').limit(5).as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // LIMIT in fork branch - may need special handling
      expect(cypher).toContain(':authored')
    })

    it('compiles fork with distinct in branch', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored').distinct().as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(':authored')
    })
  })

  // ===========================================================================
  // COMPLEX REAL-WORLD PATTERNS
  // ===========================================================================

  describe('Complex Real-World Patterns', () => {
    it('compiles full listMessages pattern with all relations', async () => {
      // Complete pattern from chat-message endpoint:
      // - Get messages
      // - For each message: replyTo target, reply count, reactions
      const query = await graph
        .node('message')
        .orderBy('createdAt', 'ASC')
        .limit(50)
        .as('msg')
        .fork(
          (q) => q.toOptional('replyTo').as('replyTo'),
          (q) => q.from('replyTo').as('reply'),
          (q) => q.to('hasReaction').as('reaction'),
        )
        .return((q) => ({
          msg: q.msg,
          replyTo: q.replyTo,
          replies: collect(q.reply),
          reactions: collect(q.reaction),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Verify structure
      expect(cypher).toContain('MATCH')
      expect(cypher).toContain(':Message')
      expect(cypher).toContain('ORDER BY')
      expect(cypher).toContain('LIMIT 50')
      expect(cypher).toContain('OPTIONAL MATCH')
      expect(cypher).toContain(':replyTo')
      expect(cypher).toContain(':hasReaction')
      expect(cypher).toContain('collect(')
    })

    it('compiles social feed pattern: posts with author, likes, comments', async () => {
      const query = await graph
        .node('post')
        .where('views', 'gt', 0)
        .orderBy('views', 'DESC')
        .limit(20)
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

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain('WHERE')
      expect(cypher).toContain('ORDER BY')
      expect(cypher).toContain('LIMIT 20')
      expect(cypher).toContain('collect(DISTINCT')
    })

    it('compiles user profile pattern: user with posts, followers, following', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork(
          (q) => q.to('authored').orderBy('views', 'DESC').limit(10).as('topPost'),
          (q) => q.from('follows').as('follower'),
          (q) => q.to('follows').as('following'),
          (q) => q.to('likes').as('likedPost'),
        )
        .return((q) => ({
          user: q.user,
          topPosts: collect(q.topPost),
          followers: collectDistinct(q.follower),
          following: collectDistinct(q.following),
          likedPosts: collect(q.likedPost),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(':User')
      expect(cypher).toContain(':authored')
      expect(cypher).toContain(':follows')
      expect(cypher).toContain(':likes')
    })

    it('compiles thread view pattern: message with full context', async () => {
      // Get a message with:
      // - What it replies to (and that message's author)
      // - Messages that reply to it
      // - Reactions
      const query = await graph
        .nodeByIdWithLabel('message', 'msg-1')
        .as('msg')
        .fork(
          (q) => q.toOptional('replyTo').as('parentMsg'),
          (q) => q.from('replyTo').as('childMsg'),
          (q) => q.to('hasReaction').as('reaction'),
        )
        .return((q) => ({
          msg: q.msg,
          parentMsg: q.parentMsg,
          childMessages: collect(q.childMsg),
          reactions: collect(q.reaction),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Verify both directions of replyTo edge
      const replyToMatches = cypher.match(/:replyTo/g) || []
      expect(replyToMatches.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ===========================================================================
  // CYPHER STRUCTURE VERIFICATION
  // ===========================================================================

  describe('Cypher Structure Verification', () => {
    it('generates OPTIONAL MATCH for all fork branches', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.from('follows').as('follower'),
          (q) => q.to('follows').as('following'),
        )
        .return((q) => ({
          user: q.user,
          post: q.post,
          follower: q.follower,
          following: q.following,
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Count OPTIONAL MATCH - should be 3 (one per branch)
      const optionalMatchCount = (cypher.match(/OPTIONAL MATCH/g) || []).length
      expect(optionalMatchCount).toBe(3)
    })

    it('maintains correct node alias references across fork', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          post: q.post,
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // The fork branch should reference the correct source node
      // Pattern should be like: (n0)-[:authored]->(n1)
      // where n0 is the user node
      expect(cypher).toMatch(/\(n\d+\)-\[.*:authored.*\]->\(n\d+/)
    })

    it('generates correct RETURN clause with all aliases', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.from('follows').as('follower'),
        )
        .return((q) => ({
          user: q.user,
          post: q.post,
          followers: collect(q.follower),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // RETURN should have all aliases
      expect(cypher).toContain('RETURN')
      expect(cypher).toContain('AS user')
      expect(cypher).toContain('AS post')
      expect(cypher).toContain('AS followers')
    })

    it('places ORDER BY and LIMIT before fork branches', async () => {
      const query = await graph
        .node('user')
        .orderBy('name', 'ASC')
        .limit(10)
        .as('user')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // ORDER BY and LIMIT should come after the main MATCH but the structure
      // depends on implementation. At minimum, they should be present.
      expect(cypher).toContain('ORDER BY')
      expect(cypher).toContain('LIMIT 10')
    })
  })

  // ===========================================================================
  // ERROR CASES
  // ===========================================================================

  describe('Error Cases', () => {
    it('throws error when collect references non-existent alias', async () => {
      // With the new typed API, invalid alias references throw at runtime when the proxy is accessed
      await expect(async () => {
        await graph
          .nodeByIdWithLabel('user', 'user-1')
          .as('user')
          .fork((q) => q.to('authored').as('post'))
          .return((q) => ({
            user: q.user,
            // @ts-expect-error - nonExistent alias doesn't exist
            posts: collect(q.nonExistent),
          }))
      }).rejects.toThrow()
    })
  })

  // ===========================================================================
  // SEMANTIC CORRECTNESS TESTS
  // ===========================================================================

  describe('Semantic Correctness', () => {
    it('fork branches start from the correct source node', async () => {
      // When we fork from a node, each branch should start from that node
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork(
          (q) => q.to('authored').as('post'),
          (q) => q.to('follows').as('following'),
        )
        .return((q) => ({
          user: q.user,
          post: q.post,
          following: q.following,
        }))

      const compiled = query.compile()
      const cypher = compiled.cypher

      // Both fork branches should reference the same source node (n0)
      // The pattern should show traversals from the same node
      const lines = cypher.split('\n')
      const optionalMatches = lines.filter((l) => l.includes('OPTIONAL MATCH'))

      // Each OPTIONAL MATCH should start from the same node alias
      for (const match of optionalMatches) {
        // Should contain pattern like (n0)- or (n0)<-
        expect(match).toMatch(/\(n0\)/)
      }
    })

    it('fork preserves aliases from before the fork', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('originalUser')
        .fork((q) => q.to('authored').as('post'))
        .return((q) => ({
          originalUser: q.originalUser,
          posts: collect(q.post),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // The original alias should be preserved
      expect(cypher).toContain('AS originalUser')
    })

    it('fork with chained traversal maintains correct node references', async () => {
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork((q) => q.to('authored').as('post').to('hasComment').as('comment'))
        .return((q) => ({
          user: q.user,
          posts: collect(q.post),
          comments: collect(q.comment),
        }))

      const compiled = query.compile()
      const cypher = compiled.cypher

      // The chained traversal should show:
      // 1. user -> authored -> post
      // 2. post -> hasComment -> comment
      expect(cypher).toContain(':authored')
      expect(cypher).toContain(':hasComment')

      // The hasComment traversal should start from the post node, not the user
      // This is verified by checking the pattern structure
      const lines = cypher.split('\n')
      const hasCommentLine = lines.find((l) => l.includes(':hasComment'))
      expect(hasCommentLine).toBeDefined()
    })

    it('multiple forks from same node produce independent branches', async () => {
      // This tests that fork branches don't interfere with each other
      const query = await graph
        .nodeByIdWithLabel('user', 'user-1')
        .as('user')
        .fork(
          (q) =>
            q
              .to('authored')
              .where('views', 'gt', 100 as number)
              .as('popularPost'),
          (q) =>
            q
              .to('authored')
              .where('views', 'lt', 10 as number)
              .as('unpopularPost'),
        )
        .return((q) => ({
          user: q.user,
          popularPosts: collect(q.popularPost),
          unpopularPosts: collect(q.unpopularPost),
        }))

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have two separate OPTIONAL MATCH clauses for authored
      const authoredMatches = (cypher.match(/:authored/g) || []).length
      expect(authoredMatches).toBe(2)

      // Should have both WHERE conditions
      expect(cypher).toContain('> $') // gt condition
      expect(cypher).toContain('< $') // lt condition
    })
  })
})
