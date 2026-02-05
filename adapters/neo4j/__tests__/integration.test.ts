/**
 * Integration tests for Neo4j adapter.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { defineSchema, node, edge, createGraph, type Graph } from '@astrale/typegraph'
import { Neo4jAdapter } from '../src'
import { z } from 'zod'

describe('Neo4j Adapter Integration', () => {
  const config = {
    uri: 'bolt://localhost:7688',
    auth: { username: 'neo4j', password: 'testpassword' },
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

  let graph: Graph<typeof schema>
  let adapter: Neo4jAdapter

  beforeAll(async () => {
    adapter = new Neo4jAdapter(config)
    graph = await createGraph(schema, { adapter })
  })

  afterAll(async () => {
    await graph.close()
  })

  beforeEach(async () => {
    // Use adapter.mutate for write operations (DELETE requires write mode)
    await adapter.mutate('MATCH (n) DETACH DELETE n')
  })

  it('should connect and verify connection', async () => {
    const connected = await graph.isConnected()
    expect(connected).toBe(true)
  })

  it('should create and query nodes', async () => {
    const user = await graph.mutate.create('user', { name: 'Test User' })
    expect(user.data.name).toBe('Test User')
    expect(user.id).toBeDefined()

    const users = await graph.node('user').execute()
    expect(users).toHaveLength(1)
    expect(users[0]?.name).toBe('Test User')
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

  it('should handle edge creation and traversal', async () => {
    const user = await graph.mutate.create('user', { name: 'Author' })
    const post = await graph.mutate.create('post', { title: 'Test Post', content: 'Content' })
    await graph.mutate.link('authored', user.id, post.id)

    const posts = await graph.nodeById(user.id).to('authored').execute()
    expect(posts).toHaveLength(1)
  })
})
