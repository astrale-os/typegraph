/**
 * Integration Test Setup
 *
 * Database-agnostic test utilities that work with any executor adapter.
 * Supports Neo4j, Memgraph, FalkorDB, and other graph databases.
 */

import { z } from 'zod'
import { defineSchema, node, edge } from '@astrale/typegraph-core'
import { type GraphQuery, createGraph } from '../../src/query/entry'

// =============================================================================
// EXECUTOR INTERFACES (Database-Agnostic)
// =============================================================================

export interface QueryExecutor {
  run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>
}

export interface MutationExecutor {
  run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>
  runInTransaction<T>(fn: (tx: TransactionRunner) => Promise<T>): Promise<T>
}

export interface TransactionRunner {
  run<R>(cypher: string, params: Record<string, unknown>): Promise<R[]>
}

export interface DatabaseAdapter {
  connect(): Promise<void>
  close(): Promise<void>
  clearDatabase(): Promise<void>
  createQueryExecutor(): QueryExecutor
  createMutationExecutor(): MutationExecutor
}

// =============================================================================
// TEST SCHEMA
// =============================================================================

export const testSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
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
// DATABASE ADAPTER SELECTION
// =============================================================================

type DatabaseType = 'neo4j' | 'memgraph' | 'falkordb'

const DB_TYPE = (process.env.TEST_DB_TYPE as DatabaseType) || 'memgraph'

// =============================================================================
// NEO4J/MEMGRAPH ADAPTER (Bolt Protocol)
// =============================================================================

class Neo4jAdapter implements DatabaseAdapter {
  private connection: any = null

  async connect(): Promise<void> {
    const { ConnectionManager } = await import('../../src/executor/connection')
    const uri = process.env.MEMGRAPH_URI ?? 'bolt://localhost:7687'
    const user = process.env.MEMGRAPH_USER ?? ''
    const password = process.env.MEMGRAPH_PASSWORD ?? ''

    this.connection = new ConnectionManager({
      uri,
      auth: user ? { username: user, password } : undefined,
    })
    await this.connection.connect()
  }

  async close(): Promise<void> {
    if (this.connection) {
      await this.connection.close()
    }
  }

  async clearDatabase(): Promise<void> {
    if (!this.connection) throw new Error('Not connected')
    await this.connection.run('MATCH (n) DETACH DELETE n', {})
  }

  createQueryExecutor(): QueryExecutor {
    if (!this.connection) throw new Error('Not connected')
    return {
      async run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
        const { records } = await this.connection.run<Record<string, unknown>>(
          cypher,
          params ?? {},
        )
        return records.map((r) => transformNeo4jResult<T>(r))
      },
    }
  }

  createMutationExecutor(): MutationExecutor {
    if (!this.connection) throw new Error('Not connected')
    const connection = this.connection

    return {
      async run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
        const { records } = await connection.run<Record<string, unknown>>(cypher, params ?? {})
        return records.map((r) => transformNeo4jResult<T>(r))
      },

      async runInTransaction<T>(fn: (tx: TransactionRunner) => Promise<T>): Promise<T> {
        return connection.transaction(async (ctx: any) => {
          const runner: TransactionRunner = {
            async run<R>(cypher: string, params: Record<string, unknown>): Promise<R[]> {
              const records = await ctx.run<Record<string, unknown>>(cypher, params)
              return records.map((r) => transformNeo4jResult<R>(r))
            },
          }
          return fn(runner)
        })
      },
    }
  }
}

// =============================================================================
// FALKORDB ADAPTER (Redis Protocol)
// =============================================================================

class FalkorDBAdapter implements DatabaseAdapter {
  private client: any = null
  private graph: any = null

  async connect(): Promise<void> {
    const { FalkorDB } = await import('falkordb')
    const host = process.env.FALKORDB_HOST ?? 'localhost'
    const port = parseInt(process.env.FALKORDB_PORT ?? '6379')

    this.client = await FalkorDB.connect({ socket: { host, port } })
    const graphName = process.env.FALKORDB_GRAPH ?? 'test'
    this.graph = this.client.selectGraph(graphName)
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close()
    }
  }

  async clearDatabase(): Promise<void> {
    if (!this.graph) throw new Error('Not connected')
    // Delete all nodes and edges
    await this.graph.query('MATCH (n) DETACH DELETE n')
  }

  createQueryExecutor(): QueryExecutor {
    if (!this.graph) throw new Error('Not connected')
    const graph = this.graph

    return {
      async run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
        const result = await graph.roQuery(
          cypher,
          params ? { params: params as any } : undefined,
        )
        return transformFalkorDBResults(result.data) as T[]
      },
    }
  }

  createMutationExecutor(): MutationExecutor {
    if (!this.graph) throw new Error('Not connected')
    const graph = this.graph

    return {
      async run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
        const result = await graph.query(cypher, params ? { params: params as any } : undefined)
        return transformFalkorDBResults(result.data) as T[]
      },

      async runInTransaction<T>(fn: (tx: TransactionRunner) => Promise<T>): Promise<T> {
        // FalkorDB doesn't have explicit transactions
        const runner: TransactionRunner = {
          async run<R>(cypher: string, params: Record<string, unknown>): Promise<R[]> {
            const result = await graph.query(cypher, { params: params as any })
            return transformFalkorDBResults(result.data) as R[]
          },
        }
        return fn(runner)
      },
    }
  }
}

// =============================================================================
// ADAPTER FACTORY
// =============================================================================

export async function createDatabaseAdapter(): Promise<DatabaseAdapter> {
  switch (DB_TYPE) {
    case 'neo4j':
    case 'memgraph':
      return new Neo4jAdapter()
    case 'falkordb':
      return new FalkorDBAdapter()
    default:
      throw new Error(`Unknown database type: ${DB_TYPE}`)
  }
}

// =============================================================================
// RESULT TRANSFORMERS
// =============================================================================

/**
 * Transform Neo4j Node objects to plain objects with properties extracted.
 * Neo4j returns Node { identity, labels, properties, elementId } but we want just the properties.
 */
function transformNeo4jResult<T>(record: Record<string, unknown>): T {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === 'object' && 'properties' in value && 'labels' in value) {
      // This is a Neo4j Node - extract properties
      result[key] = (value as { properties: Record<string, unknown> }).properties
    } else if (value && typeof value === 'object' && 'properties' in value && 'type' in value) {
      // This is a Neo4j Relationship - extract properties
      result[key] = (value as { properties: Record<string, unknown> }).properties
    } else if (value && typeof value === 'object' && 'low' in value && 'high' in value) {
      // This is a Neo4j Integer
      const intValue = value as { toNumber?: () => number; low: number; high: number }
      result[key] = typeof intValue.toNumber === 'function' ? intValue.toNumber() : intValue.low
    } else {
      result[key] = value
    }
  }

  return result as T
}

/**
 * Transform FalkorDB results to plain objects.
 * FalkorDB returns arrays of values that need to be mapped to header names.
 */
function transformFalkorDBResults(data: any): any[] {
  if (!Array.isArray(data)) return []

  return data.map((row: any) => {
    if (Array.isArray(row)) {
      // Row is an array of values, map to object
      return row.reduce((acc: any, val: any, idx: number) => {
        acc[`col${idx}`] = extractFalkorDBValue(val)
        return acc
      }, {})
    }
    return extractFalkorDBValue(row)
  })
}

function extractFalkorDBValue(val: any): any {
  if (val === null || val === undefined) return val
  if (typeof val !== 'object') return val

  // Handle FalkorDB Node
  if (val.properties) {
    return val.properties
  }

  // Handle FalkorDB Edge
  if (val.relationship && val.relationship.properties) {
    return val.relationship.properties
  }

  return val
}

// =============================================================================
// TEST GRAPH INSTANCE
// =============================================================================

export function createTestGraph(adapter: DatabaseAdapter): GraphQuery<TestSchema> {
  const mutationExecutor = adapter.createMutationExecutor()
  const queryExecutor = adapter.createQueryExecutor()

  // Type assertion needed because createGraph has a generic constraint
  // that doesn't perfectly match our concrete schema type
  return createGraph(testSchema, {
    uri: 'test://database', // Dummy URI since we provide executors
    mutationExecutor,
    rawExecutor: queryExecutor,
  }) as unknown as GraphQuery<TestSchema>
}

// =============================================================================
// TEST UTILITIES
// =============================================================================

export async function seedTestData(mutationExecutor: MutationExecutor): Promise<TestData> {
  // Create users
  const [user1] = await mutationExecutor.run<{ id: string }>(
    `CREATE (u:Node:User {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`,
    {
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      status: 'active',
    },
  )

  const [user2] = await executor
    .run<{
      id: string
    }>(
      `CREATE (u:Node:User {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`,
      {
        id: 'user-2',
        email: 'bob@example.com',
        name: 'Bob',
        status: 'active',
      },
    )
    

  const [user3] = await executor
    .run<{
      id: string
    }>(
      `CREATE (u:Node:User {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`,
      {
        id: 'user-3',
        email: 'charlie@example.com',
        name: 'Charlie',
        status: 'inactive',
      },
    )
    

  // Create posts
  const [post1] = await executor
    .run<{
      id: string
    }>(
      `CREATE (p:Node:Post {id: $id, title: $title, content: $content, views: $views}) RETURN p.id as id`,
      {
        id: 'post-1',
        title: 'Hello World',
        content: 'My first post',
        views: 100,
      },
    )
    

  const [post2] = await executor
    .run<{
      id: string
    }>(
      `CREATE (p:Node:Post {id: $id, title: $title, content: $content, views: $views}) RETURN p.id as id`,
      {
        id: 'post-2',
        title: 'GraphQL vs REST',
        content: 'A comparison',
        views: 250,
      },
    )
    

  const [post3] = await executor
    .run<{
      id: string
    }>(`CREATE (p:Node:Post {id: $id, title: $title, views: $views}) RETURN p.id as id`, {
      id: 'post-3',
      title: 'Draft Post',
      views: 0,
    })
    

  // Create comments
  const [comment1] = await executor
    .run<{
      id: string
    }>(`CREATE (c:Node:Comment {id: $id, text: $text}) RETURN c.id as id`, {
      id: 'comment-1',
      text: 'Great post!',
    })
    

  const [comment2] = await executor
    .run<{
      id: string
    }>(`CREATE (c:Node:Comment {id: $id, text: $text}) RETURN c.id as id`, {
      id: 'comment-2',
      text: 'Thanks for sharing',
    })
    

  // Create tags
  const [tag1] = await executor
    .run<{
      id: string
    }>(`CREATE (t:Node:Tag {id: $id, name: $name}) RETURN t.id as id`, {
      id: 'tag-1',
      name: 'tech',
    })
    

  const [tag2] = await executor
    .run<{
      id: string
    }>(`CREATE (t:Node:Tag {id: $id, name: $name}) RETURN t.id as id`, {
      id: 'tag-2',
      name: 'tutorial',
    })
    

  // Create folders (hierarchy)
  await executor.run(
    `CREATE (f:Node:Folder {id: $id, name: $name, path: $path}) RETURN f.id as id`,
    { id: 'folder-root', name: 'Root', path: '/' },
  )

  await executor.run(
    `CREATE (f:Node:Folder {id: $id, name: $name, path: $path}) RETURN f.id as id`,
    { id: 'folder-docs', name: 'Documents', path: '/documents' },
  )

  await executor.run(
    `CREATE (f:Node:Folder {id: $id, name: $name, path: $path}) RETURN f.id as id`,
    { id: 'folder-work', name: 'Work', path: '/documents/work' },
  )

  // Create relationships
  // User -> authored -> Post
  await executor.run(
    `MATCH (u:Node:User {id: $userId}), (p:Node:Post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: 'user-1', postId: 'post-1' },
  )
  await executor.run(
    `MATCH (u:Node:User {id: $userId}), (p:Node:Post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: 'user-1', postId: 'post-2' },
  )
  await executor.run(
    `MATCH (u:Node:User {id: $userId}), (p:Node:Post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: 'user-2', postId: 'post-3' },
  )

  // User -> likes -> Post
  await executor.run(
    `MATCH (u:Node:User {id: $userId}), (p:Node:Post {id: $postId}) CREATE (u)-[:likes]->(p)`,
    { userId: 'user-2', postId: 'post-1' },
  )
  await executor.run(
    `MATCH (u:Node:User {id: $userId}), (p:Node:Post {id: $postId}) CREATE (u)-[:likes]->(p)`,
    { userId: 'user-3', postId: 'post-1' },
  )
  await executor.run(
    `MATCH (u:Node:User {id: $userId}), (p:Node:Post {id: $postId}) CREATE (u)-[:likes]->(p)`,
    { userId: 'user-1', postId: 'post-2' },
  )

  // User -> follows -> User
  await executor.run(
    `MATCH (u1:Node:User {id: $fromId}), (u2:Node:User {id: $toId}) CREATE (u1)-[:follows]->(u2)`,
    { fromId: 'user-2', toId: 'user-1' },
  )
  await executor.run(
    `MATCH (u1:Node:User {id: $fromId}), (u2:Node:User {id: $toId}) CREATE (u1)-[:follows]->(u2)`,
    { fromId: 'user-3', toId: 'user-1' },
  )

  // Post -> hasComment -> Comment
  await executor.run(
    `MATCH (p:Node:Post {id: $postId}), (c:Node:Comment {id: $commentId}) CREATE (p)-[:hasComment]->(c)`,
    { postId: 'post-1', commentId: 'comment-1' },
  )
  await executor.run(
    `MATCH (p:Node:Post {id: $postId}), (c:Node:Comment {id: $commentId}) CREATE (p)-[:hasComment]->(c)`,
    { postId: 'post-1', commentId: 'comment-2' },
  )

  // User -> wroteComment -> Comment
  await executor.run(
    `MATCH (u:Node:User {id: $userId}), (c:Node:Comment {id: $commentId}) CREATE (u)-[:wroteComment]->(c)`,
    { userId: 'user-2', commentId: 'comment-1' },
  )
  await executor.run(
    `MATCH (u:Node:User {id: $userId}), (c:Node:Comment {id: $commentId}) CREATE (u)-[:wroteComment]->(c)`,
    { userId: 'user-3', commentId: 'comment-2' },
  )

  // Post -> tagged -> Tag
  await executor.run(
    `MATCH (p:Node:Post {id: $postId}), (t:Node:Tag {id: $tagId}) CREATE (p)-[:tagged]->(t)`,
    { postId: 'post-1', tagId: 'tag-1' },
  )
  await executor.run(
    `MATCH (p:Node:Post {id: $postId}), (t:Node:Tag {id: $tagId}) CREATE (p)-[:tagged]->(t)`,
    { postId: 'post-2', tagId: 'tag-1' },
  )
  await executor.run(
    `MATCH (p:Node:Post {id: $postId}), (t:Node:Tag {id: $tagId}) CREATE (p)-[:tagged]->(t)`,
    { postId: 'post-2', tagId: 'tag-2' },
  )

  // Folder hierarchy
  await executor.run(
    `MATCH (child:Node:Folder {id: $childId}), (parent:Node:Folder {id: $parentId}) CREATE (child)-[:hasParent]->(parent)`,
    { childId: 'folder-docs', parentId: 'folder-root' },
  )
  await executor.run(
    `MATCH (child:Node:Folder {id: $childId}), (parent:Node:Folder {id: $parentId}) CREATE (child)-[:hasParent]->(parent)`,
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

export interface TestData {
  users: { alice: string; bob: string; charlie: string }
  posts: { hello: string; graphql: string; draft: string }
  comments: { great: string; thanks: string }
  tags: { tech: string; tutorial: string }
  folders: { root: string; docs: string; work: string }
}

// =============================================================================
// VITEST HOOKS
// =============================================================================

export interface TestContext {
  adapter: DatabaseAdapter
  executor: QueryExecutor
  graph: GraphQuery<TestSchema>
  data: TestData
}

export async function setupIntegrationTest(): Promise<TestContext> {
  const adapter = await createDatabaseAdapter()
  await adapter.connect()

  await adapter.clearDatabase()
  const executor = adapter.createQueryExecutor()
  const data = await seedTestData(executor)

  const graph = createTestGraph(adapter)

  return { adapter, executor, graph, data }
}

export async function teardownIntegrationTest(ctx: TestContext): Promise<void> {
  await ctx.adapter.clearDatabase()
  await ctx.adapter.close()
}

export async function clearDatabase(adapter: DatabaseAdapter): Promise<void> {
  await adapter.clearDatabase()
}
