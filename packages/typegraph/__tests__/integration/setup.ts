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
    const connection = this.connection
    return {
      async run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
        const { records } = await connection.run(cypher, params ?? {})
        return records.map((r: Record<string, unknown>) => transformNeo4jResult<T>(r))
      },
    }
  }

  createMutationExecutor(): MutationExecutor {
    if (!this.connection) throw new Error('Not connected')
    const connection = this.connection

    return {
      async run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
        const { records } = await connection.run(cypher, params ?? {})
        return records.map((r: Record<string, unknown>) => transformNeo4jResult<T>(r))
      },

      async runInTransaction<T>(fn: (tx: TransactionRunner) => Promise<T>): Promise<T> {
        return connection.transaction(async (ctx: any) => {
          const runner: TransactionRunner = {
            async run<R>(cypher: string, params: Record<string, unknown>): Promise<R[]> {
              const records = await ctx.run(cypher, params)
              return records.map((r: Record<string, unknown>) => transformNeo4jResult<R>(r))
            },
          }
          return fn(runner)
        })
      },
    }
  }
}

// =============================================================================
// FALKORDB ADAPTER (Using official @astrale/typegraph-adapter-falkordb)
// =============================================================================

class FalkorDBAdapter implements DatabaseAdapter {
  private instance: any = null

  async connect(): Promise<void> {
    // @ts-ignore - FalkorDB adapter doesn't have type declarations
    const { createFalkorDBGraph } = await import('@astrale/typegraph-adapter-falkordb')
    const host = process.env.FALKORDB_HOST ?? 'localhost'
    const port = parseInt(process.env.FALKORDB_PORT ?? '6379')
    const graphName = process.env.FALKORDB_GRAPH ?? 'test'

    this.instance = await createFalkorDBGraph(testSchema, {
      host,
      port,
      graphName,
    })
  }

  async close(): Promise<void> {
    if (this.instance) {
      await this.instance.close()
    }
  }

  async clearDatabase(): Promise<void> {
    if (!this.instance) throw new Error('Not connected')
    await this.instance.driver.graph.query('MATCH (n) DETACH DELETE n')
  }

  createQueryExecutor(): QueryExecutor {
    if (!this.instance) throw new Error('Not connected')
    const graph = this.instance.driver.graph

    return {
      async run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
        const result = await graph.roQuery(cypher, params ? { params } : undefined)
        return transformFalkorDBResults(result.data) as T[]
      },
    }
  }

  createMutationExecutor(): MutationExecutor {
    if (!this.instance) throw new Error('Not connected')
    const graph = this.instance.driver.graph

    return {
      async run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
        const result = await graph.query(cypher, params ? { params } : undefined)
        return transformFalkorDBResults(result.data) as T[]
      },

      async runInTransaction<T>(fn: (tx: TransactionRunner) => Promise<T>): Promise<T> {
        // FalkorDB doesn't have explicit transactions, run sequentially
        const runner: TransactionRunner = {
          async run<R>(cypher: string, params: Record<string, unknown>): Promise<R[]> {
            const result = await graph.query(cypher, { params })
            return transformFalkorDBResults(result.data) as R[]
          },
        }
        return fn(runner)
      },
    }
  }
}

/**
 * Extract properties from a FalkorDB Node or Edge object.
 * FalkorDB returns properties as a Map or plain object.
 */
function extractFalkorDBProperties(val: unknown): Record<string, unknown> {
  if (!val || typeof val !== 'object') return val as Record<string, unknown>

  const obj = val as Record<string, unknown>

  // Check if it's a FalkorDB Node/Edge with properties
  const props = obj.properties
  if (props !== undefined) {
    // FalkorDB returns properties as a Map
    if (props instanceof Map) {
      const result: Record<string, unknown> = {}
      props.forEach((value, key) => {
        result[key] = value
      })
      return result
    }
    // In case properties is already a plain object
    if (typeof props === 'object' && props !== null) {
      return props as Record<string, unknown>
    }
  }

  return val as Record<string, unknown>
}

/**
 * Transform FalkorDB results to plain objects.
 * FalkorDB returns arrays where each element is a row object with internal aliases as keys.
 * We need to extract properties from Node/Edge objects in each row.
 */
function transformFalkorDBResults(data: unknown[]): Record<string, unknown>[] {
  if (!data || data.length === 0) return []

  return data.map((row) => {
    // Handle case where row is already a plain object (FalkorDB format)
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      const result: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(row as Record<string, unknown>)) {
        result[key] = extractFalkorDBProperties(val)
      }
      return result
    }

    // Handle legacy array format
    if (Array.isArray(row)) {
      if (row.length === 1) {
        return extractFalkorDBProperties(row[0])
      }
      const result: Record<string, unknown> = {}
      row.forEach((val, idx) => {
        result[`col${idx}`] = extractFalkorDBProperties(val)
      })
      return result
    }

    return row as Record<string, unknown>
  })
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

// FalkorDB result transformation is handled by @astrale/typegraph-adapter-falkordb

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
    queryExecutor,
    mutationExecutor,
    rawExecutor: queryExecutor,
  }) as unknown as GraphQuery<TestSchema>
}

// =============================================================================
// TEST UTILITIES
// =============================================================================

export async function seedTestData(executor: MutationExecutor): Promise<TestData> {
  // Create users
  const [user1] = await executor.run<{ id: string }>(
    `CREATE (u:User {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`,
    {
      id: 'user-1',
      email: 'alice@example.com',
      name: 'Alice',
      status: 'active',
    },
  )

  const [user2] = await executor.run<{ id: string }>(
    `CREATE (u:User {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`,
    {
      id: 'user-2',
      email: 'bob@example.com',
      name: 'Bob',
      status: 'active',
    },
  )

  const [user3] = await executor.run<{ id: string }>(
    `CREATE (u:User {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`,
    {
      id: 'user-3',
      email: 'charlie@example.com',
      name: 'Charlie',
      status: 'inactive',
    },
  )

  // Create posts
  const [post1] = await executor.run<{ id: string }>(
    `CREATE (p:Post {id: $id, title: $title, content: $content, views: $views}) RETURN p.id as id`,
    {
      id: 'post-1',
      title: 'Hello World',
      content: 'My first post',
      views: 100,
    },
  )

  const [post2] = await executor.run<{ id: string }>(
    `CREATE (p:Post {id: $id, title: $title, content: $content, views: $views}) RETURN p.id as id`,
    {
      id: 'post-2',
      title: 'GraphQL vs REST',
      content: 'A comparison',
      views: 250,
    },
  )

  const [post3] = await executor.run<{ id: string }>(
    `CREATE (p:Post {id: $id, title: $title, views: $views}) RETURN p.id as id`,
    {
      id: 'post-3',
      title: 'Draft Post',
      views: 0,
    },
  )

  // Create comments
  const [comment1] = await executor.run<{ id: string }>(
    `CREATE (c:Comment {id: $id, text: $text}) RETURN c.id as id`,
    {
      id: 'comment-1',
      text: 'Great post!',
    },
  )

  const [comment2] = await executor.run<{ id: string }>(
    `CREATE (c:Comment {id: $id, text: $text}) RETURN c.id as id`,
    {
      id: 'comment-2',
      text: 'Thanks for sharing',
    },
  )

  // Create tags
  const [tag1] = await executor.run<{ id: string }>(
    `CREATE (t:Tag {id: $id, name: $name}) RETURN t.id as id`,
    {
      id: 'tag-1',
      name: 'tech',
    },
  )

  const [tag2] = await executor.run<{ id: string }>(
    `CREATE (t:Tag {id: $id, name: $name}) RETURN t.id as id`,
    {
      id: 'tag-2',
      name: 'tutorial',
    },
  )

  // Create folders (hierarchy)
  await executor.run(
    `CREATE (f:Folder {id: $id, name: $name, path: $path}) RETURN f.id as id`,
    { id: 'folder-root', name: 'Root', path: '/' },
  )

  await executor.run(
    `CREATE (f:Folder {id: $id, name: $name, path: $path}) RETURN f.id as id`,
    { id: 'folder-docs', name: 'Documents', path: '/documents' },
  )

  await executor.run(
    `CREATE (f:Folder {id: $id, name: $name, path: $path}) RETURN f.id as id`,
    { id: 'folder-work', name: 'Work', path: '/documents/work' },
  )

  // Create relationships
  // User -> authored -> Post
  await executor.run(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: 'user-1', postId: 'post-1' },
  )
  await executor.run(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: 'user-1', postId: 'post-2' },
  )
  await executor.run(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: 'user-2', postId: 'post-3' },
  )

  // User -> likes -> Post
  await executor.run(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:likes]->(p)`,
    { userId: 'user-2', postId: 'post-1' },
  )
  await executor.run(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:likes]->(p)`,
    { userId: 'user-3', postId: 'post-1' },
  )
  await executor.run(
    `MATCH (u:User {id: $userId}), (p:Post {id: $postId}) CREATE (u)-[:likes]->(p)`,
    { userId: 'user-1', postId: 'post-2' },
  )

  // User -> follows -> User
  await executor.run(
    `MATCH (u1:User {id: $fromId}), (u2:User {id: $toId}) CREATE (u1)-[:follows]->(u2)`,
    { fromId: 'user-2', toId: 'user-1' },
  )
  await executor.run(
    `MATCH (u1:User {id: $fromId}), (u2:User {id: $toId}) CREATE (u1)-[:follows]->(u2)`,
    { fromId: 'user-3', toId: 'user-1' },
  )

  // Post -> hasComment -> Comment
  await executor.run(
    `MATCH (p:Post {id: $postId}), (c:Comment {id: $commentId}) CREATE (p)-[:hasComment]->(c)`,
    { postId: 'post-1', commentId: 'comment-1' },
  )
  await executor.run(
    `MATCH (p:Post {id: $postId}), (c:Comment {id: $commentId}) CREATE (p)-[:hasComment]->(c)`,
    { postId: 'post-1', commentId: 'comment-2' },
  )

  // User -> wroteComment -> Comment
  await executor.run(
    `MATCH (u:User {id: $userId}), (c:Comment {id: $commentId}) CREATE (u)-[:wroteComment]->(c)`,
    { userId: 'user-2', commentId: 'comment-1' },
  )
  await executor.run(
    `MATCH (u:User {id: $userId}), (c:Comment {id: $commentId}) CREATE (u)-[:wroteComment]->(c)`,
    { userId: 'user-3', commentId: 'comment-2' },
  )

  // Post -> tagged -> Tag
  await executor.run(
    `MATCH (p:Post {id: $postId}), (t:Tag {id: $tagId}) CREATE (p)-[:tagged]->(t)`,
    { postId: 'post-1', tagId: 'tag-1' },
  )
  await executor.run(
    `MATCH (p:Post {id: $postId}), (t:Tag {id: $tagId}) CREATE (p)-[:tagged]->(t)`,
    { postId: 'post-2', tagId: 'tag-1' },
  )
  await executor.run(
    `MATCH (p:Post {id: $postId}), (t:Tag {id: $tagId}) CREATE (p)-[:tagged]->(t)`,
    { postId: 'post-2', tagId: 'tag-2' },
  )

  // Folder hierarchy
  await executor.run(
    `MATCH (child:Folder {id: $childId}), (parent:Folder {id: $parentId}) CREATE (child)-[:hasParent]->(parent)`,
    { childId: 'folder-docs', parentId: 'folder-root' },
  )
  await executor.run(
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
  /** Raw connection for direct Cypher queries (escape hatch) */
  connection: MutationExecutor
  graph: GraphQuery<TestSchema>
  data: TestData
}

export async function setupIntegrationTest(): Promise<TestContext> {
  const adapter = await createDatabaseAdapter()
  await adapter.connect()

  await adapter.clearDatabase()
  const mutationExecutor = adapter.createMutationExecutor()
  const queryExecutor = adapter.createQueryExecutor()
  const data = await seedTestData(mutationExecutor)

  const graph = createTestGraph(adapter)

  return { adapter, executor: queryExecutor, connection: mutationExecutor, graph, data }
}

export async function teardownIntegrationTest(ctx: TestContext): Promise<void> {
  await ctx.adapter.clearDatabase()
  await ctx.adapter.close()
}

export async function clearDatabase(adapter: DatabaseAdapter): Promise<void> {
  await adapter.clearDatabase()
}
