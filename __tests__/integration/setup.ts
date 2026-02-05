/**
 * Integration Test Setup
 *
 * Uses the unified GraphAdapter architecture for database-agnostic testing.
 * Supports FalkorDB (and Neo4j/Memgraph via their respective adapters).
 */

import { z } from 'zod'
import { defineSchema, node, edge } from '@astrale/typegraph-core'
import { createGraph, type Graph, type GraphAdapter } from '@astrale/typegraph'
import { falkordb, deleteGraph } from '@astrale/typegraph-adapter-falkordb'

// =============================================================================
// GRAPH NAME GENERATION (for test isolation)
// =============================================================================

/**
 * Get a unique graph name for this test worker.
 *
 * Uses VITEST_POOL_ID (available in fork/thread pool modes) to ensure each
 * parallel test file gets its own isolated graph. Falls back to random ID
 * if not running under vitest.
 */
function getTestGraphName(): string {
  const poolId = process.env.VITEST_POOL_ID ?? Math.random().toString(36).slice(2, 8)
  return `test_worker_${poolId}`
}

let currentGraphName: string | null = null

// =============================================================================
// TEST SCHEMA
// =============================================================================

export const testSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string().min(1),
        age: z.number().int().positive().optional(),
        status: z.enum(['active', 'inactive']).default('active'),
        createdAt: z.date().optional(),
      },
      indexes: ['email'],
    }),
    post: node({
      properties: {
        title: z.string().min(1),
        content: z.string().optional(),
        publishedAt: z.date().optional(),
        views: z.number().int().default(0),
      },
    }),
    comment: node({
      properties: {
        text: z.string().min(1),
        createdAt: z.date().optional(),
      },
    }),
    folder: node({
      properties: {
        name: z.string(),
        path: z.string(),
      },
    }),
    tag: node({
      properties: {
        name: z.string(),
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
    likes: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
    follows: edge({
      from: 'user',
      to: 'user',
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
    hasParent: edge({
      from: 'folder',
      to: 'folder',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
    tagged: edge({
      from: 'post',
      to: 'tag',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
  },
  hierarchy: {
    defaultEdge: 'hasParent',
    direction: 'up',
  },
})

export type TestSchema = typeof testSchema

// =============================================================================
// DATABASE ADAPTER FACTORY
// =============================================================================

type DatabaseType = 'neo4j' | 'memgraph' | 'falkordb'

const DB_TYPE = (process.env.TEST_DB_TYPE as DatabaseType) || 'falkordb'

export function createTestAdapter(): GraphAdapter {
  switch (DB_TYPE) {
    case 'falkordb':
      // Use env var if set, otherwise generate unique name per worker
      currentGraphName = process.env.FALKORDB_GRAPH ?? getTestGraphName()
      return falkordb({
        graphName: currentGraphName,
        host: process.env.FALKORDB_HOST ?? 'localhost',
        port: parseInt(process.env.FALKORDB_PORT ?? '6380'),
      })
    case 'neo4j':
    case 'memgraph':
      // TODO: Add neo4j adapter when available
      throw new Error(`${DB_TYPE} adapter not yet implemented. Use falkordb for now.`)
    default:
      throw new Error(`Unknown database type: ${DB_TYPE}`)
  }
}

/**
 * Clear all data from the database.
 * Handles the case where the graph doesn't exist yet (FalkorDB throws "Invalid graph operation on empty key").
 */
export async function clearDatabase(adapter: GraphAdapter): Promise<void> {
  try {
    await adapter.mutate('MATCH (n) DETACH DELETE n')
  } catch (error) {
    // FalkorDB throws this error when the graph key doesn't exist yet - that's fine, nothing to clear
    if (error instanceof Error && error.message.includes('Invalid graph operation on empty key')) {
      return
    }
    throw error
  }
}

// =============================================================================
// TEST DATA SEEDING
// =============================================================================

export interface TestData {
  users: { alice: string; bob: string; charlie: string }
  posts: { hello: string; graphql: string; draft: string }
  comments: { great: string; thanks: string }
  tags: { tech: string; tutorial: string }
  folders: { root: string; docs: string; work: string }
}

export async function seedTestData(
  graph: Graph<TestSchema>,
  adapter: GraphAdapter,
): Promise<TestData> {
  // Helper to run write queries via the adapter
  const write = async <T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> => {
    return adapter.mutate<T>(cypher, params)
  }

  // Create users
  const [user1] = await write<{ id: string }>(
    `CREATE (u:User {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`,
    { id: 'user-1', email: 'alice@example.com', name: 'Alice', status: 'active' },
  )
  const [user2] = await write<{ id: string }>(
    `CREATE (u:User {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`,
    { id: 'user-2', email: 'bob@example.com', name: 'Bob', status: 'active' },
  )
  const [user3] = await write<{ id: string }>(
    `CREATE (u:User {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`,
    { id: 'user-3', email: 'charlie@example.com', name: 'Charlie', status: 'inactive' },
  )

  // Create posts
  const [post1] = await write<{ id: string }>(
    `CREATE (p:Post {id: $id, title: $title, content: $content, views: $views}) RETURN p.id as id`,
    { id: 'post-1', title: 'Hello World', content: 'My first post', views: 100 },
  )
  const [post2] = await write<{ id: string }>(
    `CREATE (p:Post {id: $id, title: $title, content: $content, views: $views}) RETURN p.id as id`,
    { id: 'post-2', title: 'GraphQL vs REST', content: 'A comparison', views: 250 },
  )
  const [post3] = await write<{ id: string }>(
    `CREATE (p:Post {id: $id, title: $title, views: $views}) RETURN p.id as id`,
    { id: 'post-3', title: 'Draft Post', views: 0 },
  )

  // Create comments
  const [comment1] = await write<{ id: string }>(
    `CREATE (c:Comment {id: $id, text: $text}) RETURN c.id as id`,
    { id: 'comment-1', text: 'Great post!' },
  )
  const [comment2] = await write<{ id: string }>(
    `CREATE (c:Comment {id: $id, text: $text}) RETURN c.id as id`,
    { id: 'comment-2', text: 'Thanks for sharing' },
  )

  // Create tags
  const [tag1] = await write<{ id: string }>(
    `CREATE (t:Tag {id: $id, name: $name}) RETURN t.id as id`,
    { id: 'tag-1', name: 'tech' },
  )
  const [tag2] = await write<{ id: string }>(
    `CREATE (t:Tag {id: $id, name: $name}) RETURN t.id as id`,
    { id: 'tag-2', name: 'tutorial' },
  )

  // Create folders (hierarchy)
  await write(
    `CREATE (f:Folder {id: $id, name: $name, path: $path}) RETURN f.id as id`,
    { id: 'folder-root', name: 'Root', path: '/' },
  )
  await write(
    `CREATE (f:Folder {id: $id, name: $name, path: $path}) RETURN f.id as id`,
    { id: 'folder-docs', name: 'Documents', path: '/documents' },
  )
  await write(
    `CREATE (f:Folder {id: $id, name: $name, path: $path}) RETURN f.id as id`,
    { id: 'folder-work', name: 'Work', path: '/documents/work' },
  )

  // Create relationships
  // User -> authored -> Post
  await write(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: 'user-1', postId: 'post-1' },
  )
  await write(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: 'user-1', postId: 'post-2' },
  )
  await write(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: 'user-2', postId: 'post-3' },
  )

  // User -> likes -> Post
  await write(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:likes]->(p)`,
    { userId: 'user-2', postId: 'post-1' },
  )
  await write(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:likes]->(p)`,
    { userId: 'user-3', postId: 'post-1' },
  )
  await write(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:likes]->(p)`,
    { userId: 'user-1', postId: 'post-2' },
  )

  // User -> follows -> User
  await write(
    `MATCH (u1:User {id: $fromId}), (u2:User {id: $toId}) CREATE (u1)-[:follows]->(u2)`,
    { fromId: 'user-2', toId: 'user-1' },
  )
  await write(
    `MATCH (u1:User {id: $fromId}), (u2:User {id: $toId}) CREATE (u1)-[:follows]->(u2)`,
    { fromId: 'user-3', toId: 'user-1' },
  )

  // Post -> hasComment -> Comment
  await write(
    `MATCH (p:Post {id: $postId}), (c:Comment {id: $commentId}) CREATE (p)-[:hasComment]->(c)`,
    { postId: 'post-1', commentId: 'comment-1' },
  )
  await write(
    `MATCH (p:Post {id: $postId}), (c:Comment {id: $commentId}) CREATE (p)-[:hasComment]->(c)`,
    { postId: 'post-1', commentId: 'comment-2' },
  )

  // User -> wroteComment -> Comment
  await write(
    `MATCH (u:User {id: $userId}), (c:Comment {id: $commentId}) CREATE (u)-[:wroteComment]->(c)`,
    { userId: 'user-2', commentId: 'comment-1' },
  )
  await write(
    `MATCH (u:User {id: $userId}), (c:Comment {id: $commentId}) CREATE (u)-[:wroteComment]->(c)`,
    { userId: 'user-3', commentId: 'comment-2' },
  )

  // Post -> tagged -> Tag
  await write(
    `MATCH (p:Post {id: $postId}), (t:Tag {id: $tagId}) CREATE (p)-[:Tagged]->(t)`,
    { postId: 'post-1', tagId: 'tag-1' },
  )
  await write(
    `MATCH (p:Post {id: $postId}), (t:Tag {id: $tagId}) CREATE (p)-[:Tagged]->(t)`,
    { postId: 'post-2', tagId: 'tag-1' },
  )
  await write(
    `MATCH (p:Post {id: $postId}), (t:Tag {id: $tagId}) CREATE (p)-[:Tagged]->(t)`,
    { postId: 'post-2', tagId: 'tag-2' },
  )

  // Folder hierarchy
  await write(
    `MATCH (child:Folder {id: $childId}), (parent:Folder {id: $parentId}) CREATE (child)-[:hasParent]->(parent)`,
    { childId: 'folder-docs', parentId: 'folder-root' },
  )
  await write(
    `MATCH (child:Folder {id: $childId}), (parent:Folder {id: $parentId}) CREATE (child)-[:hasParent]->(parent)`,
    { childId: 'folder-work', parentId: 'folder-docs' },
  )

  return {
    users: { alice: user1!.id, bob: user2!.id, charlie: user3!.id },
    posts: { hello: post1!.id, graphql: post2!.id, draft: post3!.id },
    comments: { great: comment1!.id, thanks: comment2!.id },
    tags: { tech: tag1!.id, tutorial: tag2!.id },
    folders: { root: 'folder-root', docs: 'folder-docs', work: 'folder-work' },
  }
}

// =============================================================================
// VITEST HOOKS
// =============================================================================

export interface TestContext {
  adapter: GraphAdapter
  graph: Graph<TestSchema>
  data: TestData
}

export async function setupIntegrationTest(): Promise<TestContext> {
  const adapter = createTestAdapter()
  await adapter.connect()
  const graph = await createGraph(testSchema, { adapter })

  await clearDatabase(adapter)
  const data = await seedTestData(graph, adapter)

  return { adapter, graph, data }
}

export async function teardownIntegrationTest(ctx: TestContext): Promise<void> {
  if (ctx?.adapter) {
    // Close the graph connection first
    await ctx.graph.close()

    // Delete the graph entirely to clean up (following authz-v2 pattern)
    if (currentGraphName && !process.env.FALKORDB_GRAPH) {
      try {
        await deleteGraph({
          graphName: currentGraphName,
          host: process.env.FALKORDB_HOST ?? 'localhost',
          port: parseInt(process.env.FALKORDB_PORT ?? '6380'),
        })
      } catch {
        // Graph might not exist or already deleted, ignore
      }
    }
  }
}
