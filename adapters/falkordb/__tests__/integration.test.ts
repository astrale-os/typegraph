/**
 * Integration tests for FalkorDB adapter.
 *
 * Note on type assertions:
 * Edge traversal results may require type narrowing due to TypeScript's limitations
 * with conditional return types in complex graph queries. This is a known limitation
 * documented in the TypeGraph library itself (see single-node.ts line 6).
 */

import type { SchemaShape } from '@astrale/typegraph-client'

import { createGraph, type Graph } from '@astrale/typegraph-client'
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

import { falkordb, clearGraph } from '../src'

describe.skip('FalkorDB Adapter Integration', () => {
  const config = {
    host: 'localhost' as const,
    port: 6380,
    graphName: 'test-graph',
  }

  const schema = {
    nodes: {
      user: {
        abstract: false,
        attributes: ['name', 'email'],
      },
      post: {
        abstract: false,
        attributes: ['title', 'content'],
      },
    },
    edges: {
      authored: {
        endpoints: {
          user: { types: ['user'] },
          post: { types: ['post'], cardinality: { min: 0, max: 1 } },
        },
      },
    },
  } as const satisfies SchemaShape

  let graph: Graph<typeof schema>

  beforeAll(async () => {
    graph = await createGraph(schema, { adapter: falkordb(config) })
  })

  afterAll(async () => {
    await graph.close()
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

    expect((posts[0]! as Record<string, unknown>).title).toBe('Test Post')
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

  it('should verify connection status', async () => {
    const testGraph = await createGraph(schema, { adapter: falkordb(config) })
    const connected = await testGraph.isConnected()
    expect(connected).toBe(true)
    await testGraph.close()
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
