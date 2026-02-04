/**
 * Basic usage example for FalkorDB adapter.
 */

import { defineSchema, node, edge } from '@astrale/typegraph'
import { createFalkorDBGraph } from '../src/index'
import { z } from 'zod'

// Define schema
const schema = defineSchema({
  nodes: {
    user: node({
      properties: {
        name: z.string(),
        email: z.string().email(),
        age: z.number().optional(),
      },
      indexes: ['email'],
    }),
    post: node({
      properties: {
        title: z.string(),
        content: z.string(),
        published: z.boolean().default(false),
      },
      indexes: ['title'],
    }),
  },
  edges: {
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
    follows: edge({
      from: 'user',
      to: 'user',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
  },
})

async function main() {
  // Create FalkorDB graph
  const { graph, close, healthCheck } = await createFalkorDBGraph(schema, {
    host: 'localhost',
    port: 6379,
    graphName: 'social-network',
  })

  // Check health
  const health = await healthCheck()
  console.log('Database healthy:', health.healthy, `(${health.latencyMs}ms)`)

  // Create users
  const alice = await graph.mutate.create('user', {
    name: 'Alice',
    email: 'alice@example.com',
    age: 30,
  })

  const bob = await graph.mutate.create('user', {
    name: 'Bob',
    email: 'bob@example.com',
  })

  console.log('Created users:', { alice: alice.data.name, bob: bob.data.name })

  // Create posts
  const post = await graph.mutate.create('post', {
    title: 'Hello FalkorDB',
    content: 'FalkorDB is awesome!',
    published: true,
  })

  console.log('Created post:', post.data.title)

  // Link nodes
  await graph.mutate.link('authored', alice.id, post.id)
  await graph.mutate.link('follows', alice.id, bob.id)

  // Query all users
  const users = await graph.node('user').execute()
  console.log('All users:', users.length)

  // Query with filters
  const publishedPosts = await graph.node('post').where('published', 'eq', true).execute()
  console.log('Published posts:', publishedPosts.length)

  // Traverse edges
  const alicesPosts = await graph.nodeById(alice.id).to('authored').execute()
  console.log("Alice's posts:", alicesPosts.length)

  // Cleanup
  await close()
}

main().catch(console.error)
