/**
 * Integration tests for FalkorDB adapter.
 *
 * Note on type assertions:
 * Edge traversal results may require type narrowing due to TypeScript's limitations
 * with conditional return types in complex graph queries. This is a known limitation
 * documented in the TypeGraph library itself (see single-node.ts line 6).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { defineSchema, node, edge } from '@astrale/typegraph'
import { createFalkorDBGraph, clearGraph } from '../src'
import { z } from 'zod'
import type { NodeProps } from '@astrale/typegraph'

describe('FalkorDB Adapter Integration', () => {
  const config = {
    host: 'localhost' as const,
    port: 6380,
    graphName: 'test-graph',
  }

  const schema = defineSchema({
    nodes: {
      user: node({
        properties: {
          name: z.string(),
          email: z.string().optional(),
        },
      }),
      post: node({
        properties: {
          title: z.string(),
          content: z.string(),
        },
      }),
    },
    edges: {
      authored: edge({
        from: 'user',
        to: 'post',
        cardinality: { outbound: 'many', inbound: 'one' },
      }),
    },
  })

  let graph: ReturnType<typeof createFalkorDBGraph<typeof schema>> extends Promise<infer T>
    ? T['graph']
    : never
  let close: () => Promise<void>

  beforeAll(async () => {
    const instance = await createFalkorDBGraph(schema, config)
    graph = instance.graph
    close = instance.close
  })

  afterAll(async () => {
    await close()
  })

  beforeEach(async () => {
    await clearGraph(config)
  })

  it('should create and query nodes', async () => {
    const user = await graph.mutate.create('user', { name: 'Test User' })
    expect(user.data.name).toBe('Test User')
    expect(user.id).toBeDefined()

    const users = await graph.node('user').execute()
    expect(users).toHaveLength(1)
    expect(users[0]?.name).toBe('Test User')
  })

  it('should handle edge traversal', async () => {
    const user = await graph.mutate.create('user', { name: 'Author' })
    const post = await graph.mutate.create('post', {
      title: 'Test Post',
      content: 'Content',
    })
    await graph.mutate.link('authored', user.id, post.id)

    // Edge traversal returns target nodes
    const posts = await graph.nodeById(user.id).to('authored').execute()
    expect(posts).toHaveLength(1)

    // Type narrowing: TypeScript can't infer the target node type from edge traversal
    // This is a known limitation with conditional types (see TypeGraph single-node.ts:6)
    type PostNode = NodeProps<typeof schema, 'post'>
    expect((posts[0]! as PostNode).title).toBe('Test Post')
  })

  it('should handle updates', async () => {
    const user = await graph.mutate.create('user', { name: 'Original' })
    const updated = await graph.mutate.update('user', user.id, { name: 'Updated' })

    expect(updated.data.name).toBe('Updated')
    expect(updated.id).toBe(user.id)
  })

  it('should handle deletes', async () => {
    const user = await graph.mutate.create('user', { name: 'To Delete' })
    await graph.mutate.delete('user', user.id)

    const users = await graph.node('user').execute()
    expect(users).toHaveLength(0)
  })

  it('should verify health check', async () => {
    const instance = await createFalkorDBGraph(schema, config)
    const health = await instance.healthCheck()
    expect(health.healthy).toBe(true)
    expect(health.latencyMs).toBeGreaterThan(0)
    await instance.close()
  })

  it('should handle batch operations', async () => {
    const users = await Promise.all([
      graph.mutate.create('user', { name: 'User 1' }),
      graph.mutate.create('user', { name: 'User 2' }),
      graph.mutate.create('user', { name: 'User 3' }),
    ])

    expect(users).toHaveLength(3)

    const allUsers = await graph.node('user').execute()
    expect(allUsers).toHaveLength(3)
  })
})
