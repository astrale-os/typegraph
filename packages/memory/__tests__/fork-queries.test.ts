/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Fork (Fan-out) Pattern Tests
 *
 * End-to-end tests for the fork() method with in-memory graph.
 * These tests model real-world patterns like the chat-message listMessages endpoint.
 *
 * Test approach: Insert data manually, then verify fork queries work correctly.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { defineSchema, node, edge } from '@astrale/typegraph'
import { z } from 'zod'
import { createInMemoryGraph, type InMemoryGraph } from '../src'

// =============================================================================
// CHAT-LIKE SCHEMA (models the chat-message app patterns)
// =============================================================================

const chatSchema = defineSchema({
  nodes: {
    thread: node({
      properties: {
        title: z.string(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
      },
    }),
    message: node({
      properties: {
        content: z.string(),
        role: z.enum(['user', 'assistant']).optional(),
        createdAt: z.string().optional(),
      },
    }),
    reaction: node({
      properties: {
        emoji: z.string(),
        createdAt: z.string().optional(),
      },
    }),
    user: node({
      properties: {
        name: z.string(),
        email: z.string(),
      },
    }),
    tag: node({
      properties: {
        name: z.string(),
      },
    }),
  },
  edges: {
    // Thread contains messages
    hasMessage: edge({
      from: 'thread',
      to: 'message',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
    // Message replies to another message (optional)
    replyTo: edge({
      from: 'message',
      to: 'message',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
    // Message has reactions
    hasReaction: edge({
      from: 'message',
      to: 'reaction',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
    // User authored message
    authored: edge({
      from: 'user',
      to: 'message',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
    // Message has tags
    tagged: edge({
      from: 'message',
      to: 'tag',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
    // User follows user
    follows: edge({
      from: 'user',
      to: 'user',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
  },
  hierarchy: {
    defaultEdge: 'hasMessage',
    direction: 'up',
  },
})

type ChatSchema = typeof chatSchema

// =============================================================================
// TEST HELPERS
// =============================================================================

interface TestData {
  thread: { id: string }
  messages: {
    msg1: { id: string }
    msg2: { id: string }
    msg3: { id: string }
    msg4: { id: string }
  }
  reactions: {
    r1: { id: string }
    r2: { id: string }
    r3: { id: string }
  }
  users: {
    alice: { id: string }
    bob: { id: string }
  }
  tags: {
    important: { id: string }
    question: { id: string }
  }
}

async function seedChatData(graph: InMemoryGraph<ChatSchema>): Promise<TestData> {
  // Create users
  const alice = await graph.mutate.create('user', { name: 'Alice', email: 'alice@example.com' })
  const bob = await graph.mutate.create('user', { name: 'Bob', email: 'bob@example.com' })

  // Alice follows Bob
  await graph.mutate.link('follows', alice.id, bob.id)

  // Create thread
  const thread = await graph.mutate.create('thread', {
    title: 'Discussion Thread',
    createdAt: '2024-01-01T00:00:00Z',
  })

  // Create messages
  // msg1: Alice's first message (no reply)
  const msg1 = await graph.mutate.create('message', {
    content: 'Hello everyone!',
    role: 'user',
    createdAt: '2024-01-01T10:00:00Z',
  })
  await graph.mutate.link('hasMessage', thread.id, msg1.id)
  await graph.mutate.link('authored', alice.id, msg1.id)

  // msg2: Bob's reply to msg1
  const msg2 = await graph.mutate.create('message', {
    content: 'Hi Alice!',
    role: 'user',
    createdAt: '2024-01-01T10:05:00Z',
  })
  await graph.mutate.link('hasMessage', thread.id, msg2.id)
  await graph.mutate.link('authored', bob.id, msg2.id)
  await graph.mutate.link('replyTo', msg2.id, msg1.id) // msg2 replies to msg1

  // msg3: Alice's reply to msg2
  const msg3 = await graph.mutate.create('message', {
    content: 'How are you?',
    role: 'user',
    createdAt: '2024-01-01T10:10:00Z',
  })
  await graph.mutate.link('hasMessage', thread.id, msg3.id)
  await graph.mutate.link('authored', alice.id, msg3.id)
  await graph.mutate.link('replyTo', msg3.id, msg2.id) // msg3 replies to msg2

  // msg4: Standalone message (no reply to anyone)
  const msg4 = await graph.mutate.create('message', {
    content: 'Just an update',
    role: 'assistant',
    createdAt: '2024-01-01T10:15:00Z',
  })
  await graph.mutate.link('hasMessage', thread.id, msg4.id)

  // Create reactions
  // msg1 has 2 reactions
  const r1 = await graph.mutate.create('reaction', {
    emoji: '👍',
    createdAt: '2024-01-01T10:01:00Z',
  })
  const r2 = await graph.mutate.create('reaction', {
    emoji: '❤️',
    createdAt: '2024-01-01T10:02:00Z',
  })
  await graph.mutate.link('hasReaction', msg1.id, r1.id)
  await graph.mutate.link('hasReaction', msg1.id, r2.id)

  // msg2 has 1 reaction
  const r3 = await graph.mutate.create('reaction', {
    emoji: '😊',
    createdAt: '2024-01-01T10:06:00Z',
  })
  await graph.mutate.link('hasReaction', msg2.id, r3.id)

  // Create tags
  const important = await graph.mutate.create('tag', { name: 'important' })
  const question = await graph.mutate.create('tag', { name: 'question' })

  // Tag some messages
  await graph.mutate.link('tagged', msg1.id, important.id)
  await graph.mutate.link('tagged', msg3.id, question.id)

  return {
    thread: { id: thread.id },
    messages: {
      msg1: { id: msg1.id },
      msg2: { id: msg2.id },
      msg3: { id: msg3.id },
      msg4: { id: msg4.id },
    },
    reactions: {
      r1: { id: r1.id },
      r2: { id: r2.id },
      r3: { id: r3.id },
    },
    users: {
      alice: { id: alice.id },
      bob: { id: bob.id },
    },
    tags: {
      important: { id: important.id },
      question: { id: question.id },
    },
  }
}

// =============================================================================
// TESTS
// =============================================================================

describe('Fork Queries with In-Memory Graph', () => {
  let graph: InMemoryGraph<ChatSchema>
  let data: TestData

  beforeEach(async () => {
    graph = createInMemoryGraph(chatSchema)
    data = await seedChatData(graph)
  })

  // ===========================================================================
  // BASIC FORK PATTERNS
  // ===========================================================================

  describe('Basic Fork Patterns', () => {
    it('should fork into two independent traversals', async () => {
      // Get a message with its replyTo target and reactions
      const query = graph
        .nodeByIdWithLabel('message', data.messages.msg2.id)
        .as('msg')
        .fork(
          (q) => q.toOptional('replyTo').as('replyTo'),
          (q) => q.to('hasReaction').as('reaction'),
        )
        .returning('msg', 'replyTo', { reactions: { collect: 'reaction' } })

      const results = await query.execute()

      // Debug output
      // console.log("Results:", JSON.stringify(results, null, 2))

      expect(results.length).toBeGreaterThan(0)
      // msg2 replies to msg1
      expect((results[0] as any).msg.id).toBe(data.messages.msg2.id)
      expect((results[0] as any).replyTo?.id).toBe(data.messages.msg1.id)
      // msg2 has 1 reaction
      expect((results[0] as any).reactions.length).toBe(1)
    })

    it('should handle fork with no matching results in one branch', async () => {
      // msg4 has no replyTo and no reactions
      const query = graph
        .nodeByIdWithLabel('message', data.messages.msg4.id)
        .as('msg')
        .fork(
          (q) => q.toOptional('replyTo').as('replyTo'),
          (q) => q.to('hasReaction').as('reaction'),
        )
        .returning('msg', 'replyTo', { reactions: { collect: 'reaction' } })

      const results = await query.execute()

      expect(results.length).toBeGreaterThan(0)
      expect((results[0] as any).msg.id).toBe(data.messages.msg4.id)
      // msg4 doesn't reply to anyone
      expect((results[0] as any).replyTo).toBeNull()
      // msg4 has no reactions
      expect((results[0] as any).reactions).toEqual([])
    })

    it('should fork with incoming edge traversal (from)', async () => {
      // Get msg1 with its replies (messages that reply TO msg1)
      const query = graph
        .nodeByIdWithLabel('message', data.messages.msg1.id)
        .as('msg')
        .fork(
          (q) => q.from('replyTo').as('reply'), // Messages that reply to this
          (q) => q.to('hasReaction').as('reaction'),
        )
        .returning(
          'msg',
          { replies: { collect: 'reply', distinct: true } },
          { reactions: { collect: 'reaction', distinct: true } },
        )

      const results = await query.execute()

      expect(results.length).toBeGreaterThan(0)
      // msg1 has 1 reply (msg2)
      expect((results[0] as any).replies.length).toBe(1)
      expect((results[0] as any).replies[0].id).toBe(data.messages.msg2.id)
      // msg1 has 2 reactions
      expect((results[0] as any).reactions.length).toBe(2)
    })
  })

  // ===========================================================================
  // COMPLEX FORK PATTERNS (Chat-like scenarios)
  // ===========================================================================

  describe('Complex Fork Patterns (listMessages-like)', () => {
    it('should model listMessages pattern: message with replyTo, replies, and reactions', async () => {
      // This mirrors the chat-message listMessages endpoint pattern
      const query = graph
        .nodeByIdWithLabel('message', data.messages.msg2.id)
        .as('msg')
        .fork(
          (q) => q.toOptional('replyTo').as('replyTo'), // What this message replies to
          (q) => q.from('replyTo').as('reply'), // Messages that reply to this
          (q) => q.to('hasReaction').as('reaction'), // Reactions on this message
        )
        .returning(
          'msg',
          'replyTo',
          { replies: { collect: 'reply' } },
          { reactions: { collect: 'reaction' } },
        )

      const results = await query.execute()

      expect(results.length).toBeGreaterThan(0)
      const result = results[0] as any

      // msg2 replies to msg1
      expect(result.replyTo?.id).toBe(data.messages.msg1.id)
      // msg2 has 1 reply (msg3)
      expect(result.replies.length).toBe(1)
      expect(result.replies[0].id).toBe(data.messages.msg3.id)
      // msg2 has 1 reaction
      expect(result.reactions.length).toBe(1)
    })

    it('should fork with four branches', async () => {
      // Get message with replyTo, replies, reactions, and tags
      const query = graph
        .nodeByIdWithLabel('message', data.messages.msg1.id)
        .as('msg')
        .fork(
          (q) => q.toOptional('replyTo').as('replyTo'),
          (q) => q.from('replyTo').as('reply'),
          (q) => q.to('hasReaction').as('reaction'),
          (q) => q.to('tagged').as('tag'),
        )
        .returning(
          'msg',
          'replyTo',
          { replies: { collect: 'reply', distinct: true } },
          { reactions: { collect: 'reaction', distinct: true } },
          { tags: { collect: 'tag', distinct: true } },
        )

      const results = await query.execute()

      expect(results.length).toBeGreaterThan(0)
      const result = results[0] as any

      // msg1 doesn't reply to anyone
      expect(result.replyTo).toBeNull()
      // msg1 has 1 reply (msg2)
      expect(result.replies.length).toBe(1)
      // msg1 has 2 reactions
      expect(result.reactions.length).toBe(2)
      // msg1 has 1 tag (important)
      expect(result.tags.length).toBe(1)
      expect(result.tags[0].name).toBe('important')
    })
  })

  // ===========================================================================
  // FORK FROM COLLECTION
  // ===========================================================================

  describe('Fork from Collection', () => {
    it('should fork from all messages in a thread', async () => {
      // Get all messages with their reactions
      const query = graph
        .node('message')
        .as('msg')
        .fork((q) => q.to('hasReaction').as('reaction'))
        .returning('msg', { reactions: { collect: 'reaction' } })

      const results = await query.execute()

      // Should have results for all 4 messages
      expect(results.length).toBe(4)

      // Each result should have the message and its reactions array
      for (const result of results) {
        expect((result as any).msg).toBeDefined()
        expect((result as any).reactions).toBeInstanceOf(Array)
      }
    })

    it('should fork from filtered collection', async () => {
      // Get only user messages (not assistant) with their reactions
      const query = graph
        .node('message')
        .where('role', 'eq', 'user')
        .as('msg')
        .fork((q) => q.to('hasReaction').as('reaction'))
        .returning('msg', { reactions: { collect: 'reaction' } })

      const results = await query.execute()

      // Should have results for 3 user messages (msg1, msg2, msg3)
      expect(results.length).toBe(3)

      // All messages should have role "user"
      for (const result of results) {
        expect((result as any).msg.role).toBe('user')
      }
    })
  })

  // ===========================================================================
  // FORK WITH CHAINED TRAVERSALS
  // ===========================================================================

  describe('Fork with Chained Traversals', () => {
    it('should chain traversals inside fork branch', async () => {
      // Get user with their authored messages and those messages' reactions
      const query = graph
        .nodeByIdWithLabel('user', data.users.alice.id)
        .as('user')
        .fork((q) => q.to('authored').as('msg').to('hasReaction').as('reaction'))
        .returning(
          'user',
          { messages: { collect: 'msg', distinct: true } },
          { reactions: { collect: 'reaction', distinct: true } },
        )

      const results = await query.execute()

      expect(results.length).toBeGreaterThan(0)
      const result = results[0] as any

      // Alice authored 2 messages (msg1, msg3)
      expect(result.messages.length).toBe(2)
      // msg1 has 2 reactions, msg3 has 0 reactions = 2 total
      expect(result.reactions.length).toBe(2)
    })

    it('should chain multiple traversals in different branches', async () => {
      // Get message with:
      // - Author and author's followers
      // - Reactions
      const query = graph
        .nodeByIdWithLabel('message', data.messages.msg1.id)
        .as('msg')
        .fork(
          (q) => q.from('authored').as('author').to('follows').as('following'),
          (q) => q.to('hasReaction').as('reaction'),
        )
        .returning(
          'msg',
          'author',
          { following: { collect: 'following', distinct: true } },
          { reactions: { collect: 'reaction', distinct: true } },
        )

      const results = await query.execute()

      expect(results.length).toBeGreaterThan(0)
      const result = results[0] as any

      // msg1 was authored by Alice
      expect(result.author?.name).toBe('Alice')
      // Alice follows Bob
      expect(result.following.length).toBe(1)
      expect(result.following[0].name).toBe('Bob')
      // msg1 has 2 reactions
      expect(result.reactions.length).toBe(2)
    })
  })

  // ===========================================================================
  // FORK WITH FILTERING
  // ===========================================================================

  describe('Fork with Filtering', () => {
    it('should apply where filter before fork', async () => {
      // Get user messages with their reactions
      const query = graph
        .node('message')
        .where('role', 'eq', 'user')
        .as('msg')
        .fork((q) => q.to('hasReaction').as('reaction'))
        .returning('msg', { reactions: { collect: 'reaction' } })

      const results = await query.execute()

      // Only user messages (3 of them)
      expect(results.length).toBe(3)

      for (const result of results) {
        expect((result as any).msg.role).toBe('user')
      }
    })
  })

  // ===========================================================================
  // FORK WITH ORDERING AND PAGINATION
  // ===========================================================================

  describe('Fork with Ordering and Pagination', () => {
    it('should apply orderBy before fork', async () => {
      // Get messages ordered by createdAt with their reactions
      const query = graph
        .node('message')
        .orderBy('createdAt', 'ASC')
        .as('msg')
        .fork((q) => q.to('hasReaction').as('reaction'))
        .returning('msg', { reactions: { collect: 'reaction' } })

      const results = await query.execute()

      expect(results.length).toBe(4)

      // Verify order
      const times = results.map((r: any) => r.msg.createdAt)
      for (let i = 1; i < times.length; i++) {
        expect(times[i]! >= times[i - 1]!).toBe(true)
      }
    })

    it('should apply limit before fork', async () => {
      // Get first 2 messages with their reactions
      const query = graph
        .node('message')
        .orderBy('createdAt', 'ASC')
        .limit(2)
        .as('msg')
        .fork((q) => q.to('hasReaction').as('reaction'))
        .returning('msg', { reactions: { collect: 'reaction' } })

      const results = await query.execute()

      // Should have at most 2 messages
      expect(results.length).toBeLessThanOrEqual(2)
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('Edge Cases', () => {
    it('should handle fork on non-existent node', async () => {
      const query = graph
        .nodeByIdWithLabel('message', 'non-existent-id')
        .as('msg')
        .fork((q) => q.to('hasReaction').as('reaction'))
        .returning('msg', { reactions: { collect: 'reaction' } })

      // Returns empty array when node doesn't exist
      const results = await query.execute()
      expect(results).toEqual([])
    })

    it('should handle single-branch fork', async () => {
      const query = graph
        .nodeByIdWithLabel('message', data.messages.msg1.id)
        .as('msg')
        .fork((q) => q.to('hasReaction').as('reaction'))
        .returning('msg', { reactions: { collect: 'reaction' } })

      const results = await query.execute()

      expect(results.length).toBeGreaterThan(0)
      expect((results[0] as any).reactions.length).toBe(2)
    })

    it('should handle fork with same edge type in multiple branches (different directions)', async () => {
      // Get message with both what it replies to AND what replies to it
      const query = graph
        .nodeByIdWithLabel('message', data.messages.msg2.id)
        .as('msg')
        .fork(
          (q) => q.toOptional('replyTo').as('replyToTarget'), // What msg2 replies to
          (q) => q.from('replyTo').as('replyFrom'), // What replies to msg2
        )
        .returning('msg', 'replyToTarget', { repliesFrom: { collect: 'replyFrom' } })

      const results = await query.execute()

      expect(results.length).toBeGreaterThan(0)
      const result = results[0] as any

      // msg2 replies to msg1
      expect(result.replyToTarget?.id).toBe(data.messages.msg1.id)
      // msg3 replies to msg2
      expect(result.repliesFrom.length).toBe(1)
      expect(result.repliesFrom[0].id).toBe(data.messages.msg3.id)
    })
  })

  // ===========================================================================
  // DISTINCT COLLECT
  // ===========================================================================

  describe('Distinct Collect', () => {
    it('should use distinct in collect', async () => {
      const query = graph
        .nodeByIdWithLabel('message', data.messages.msg1.id)
        .as('msg')
        .fork((q) => q.to('hasReaction').as('reaction'))
        .returning('msg', { reactions: { collect: 'reaction', distinct: true } })

      const results = await query.execute()

      expect(results.length).toBeGreaterThan(0)
      // msg1 has 2 distinct reactions
      expect((results[0] as any).reactions.length).toBe(2)
    })
  })

  // ===========================================================================
  // REAL-WORLD LISTMESSAGES SIMULATION
  // ===========================================================================

  describe('Real-world listMessages Simulation', () => {
    it('should fetch all messages in a thread with full relations', async () => {
      // This simulates the actual listMessages endpoint
      // For each message, get:
      // - The message itself
      // - What it replies to (optional)
      // - Messages that reply to it (for reply count)
      // - Reactions

      // First, get all messages in the thread
      const messagesQuery = graph
        .nodeByIdWithLabel('thread', data.thread.id)
        .to('hasMessage')
        .orderBy('createdAt', 'ASC')

      const messages = await messagesQuery.execute()
      expect(messages.length).toBe(4)

      // Now for each message, use fork to get relations
      // In a real implementation, this would be a single query with fork from collection
      const messageResults = []

      for (const msg of messages) {
        const query = graph
          .nodeByIdWithLabel('message', msg.id)
          .as('msg')
          .fork(
            (q) => q.toOptional('replyTo').as('replyTo'),
            (q) => q.from('replyTo').as('reply'),
            (q) => q.to('hasReaction').as('reaction'),
          )
          .returning(
            'msg',
            'replyTo',
            { replies: { collect: 'reply', distinct: true } },
            { reactions: { collect: 'reaction', distinct: true } },
          )

        const results = await query.execute()
        if (results.length > 0) {
          messageResults.push(results[0])
        }
      }

      expect(messageResults.length).toBe(4)

      // Verify msg1
      const msg1Result = messageResults.find((r: any) => r.msg.id === data.messages.msg1.id) as any
      expect(msg1Result.replyTo).toBeNull()
      expect(msg1Result.replies.length).toBe(1) // msg2 replies to msg1
      expect(msg1Result.reactions.length).toBe(2)

      // Verify msg2
      const msg2Result = messageResults.find((r: any) => r.msg.id === data.messages.msg2.id) as any
      expect(msg2Result.replyTo?.id).toBe(data.messages.msg1.id)
      expect(msg2Result.replies.length).toBe(1) // msg3 replies to msg2
      expect(msg2Result.reactions.length).toBe(1)

      // Verify msg3
      const msg3Result = messageResults.find((r: any) => r.msg.id === data.messages.msg3.id) as any
      expect(msg3Result.replyTo?.id).toBe(data.messages.msg2.id)
      expect(msg3Result.replies.length).toBe(0) // No one replies to msg3
      expect(msg3Result.reactions.length).toBe(0)

      // Verify msg4
      const msg4Result = messageResults.find((r: any) => r.msg.id === data.messages.msg4.id) as any
      expect(msg4Result.replyTo).toBeNull()
      expect(msg4Result.replies.length).toBe(0)
      expect(msg4Result.reactions.length).toBe(0)
    })
  })
})
