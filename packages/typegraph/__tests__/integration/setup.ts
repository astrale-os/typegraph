/**
 * Integration Test Setup
 *
 * Provides utilities for testing against a real Memgraph instance.
 */

import { z } from "zod"
import { defineSchema, node, edge } from "../../src/schema/builders"
import { ConnectionManager } from "../../src/executor/connection"
import { QueryExecutor } from "../../src/executor/executor"
import { type GraphQuery, createGraph } from "../../src/query/entry"
import type { MutationExecutor, TransactionRunner } from "../../src/mutation/mutations"

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
        status: z.enum(["active", "inactive"]).default("active"),
        createdAt: z.date().optional(),
      },
      indexes: ["email"],
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
      from: "user",
      to: "post",
      cardinality: { outbound: "many", inbound: "one" },
      properties: {
        role: z.enum(["author", "coauthor"]).default("author"),
      },
    }),
    likes: edge({
      from: "user",
      to: "post",
      cardinality: { outbound: "many", inbound: "many" },
    }),
    follows: edge({
      from: "user",
      to: "user",
      cardinality: { outbound: "many", inbound: "many" },
    }),
    hasComment: edge({
      from: "post",
      to: "comment",
      cardinality: { outbound: "many", inbound: "one" },
    }),
    wroteComment: edge({
      from: "user",
      to: "comment",
      cardinality: { outbound: "many", inbound: "one" },
    }),
    hasParent: edge({
      from: "folder",
      to: "folder",
      cardinality: { outbound: "optional", inbound: "many" },
    }),
    tagged: edge({
      from: "post",
      to: "tag",
      cardinality: { outbound: "many", inbound: "many" },
    }),
  },
  hierarchy: {
    defaultEdge: "hasParent",
    direction: "up",
  },
})

export type TestSchema = typeof testSchema

// =============================================================================
// TEST CONNECTION
// =============================================================================

const MEMGRAPH_URI = process.env.MEMGRAPH_URI ?? "bolt://localhost:7687"
const MEMGRAPH_USER = process.env.MEMGRAPH_USER ?? ""
const MEMGRAPH_PASSWORD = process.env.MEMGRAPH_PASSWORD ?? ""

export function createTestConnection(): ConnectionManager {
  return new ConnectionManager({
    uri: MEMGRAPH_URI,
    auth: MEMGRAPH_USER ? { username: MEMGRAPH_USER, password: MEMGRAPH_PASSWORD } : undefined,
  })
}

export function createTestExecutor(connection: ConnectionManager): QueryExecutor {
  return new QueryExecutor(connection)
}

// =============================================================================
// MUTATION EXECUTOR ADAPTER
// =============================================================================

/**
 * Transform Neo4j Node objects to plain objects with properties extracted.
 * Neo4j returns Node { identity, labels, properties, elementId } but we want just the properties.
 */
function transformNeo4jResult<T>(record: Record<string, unknown>): T {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === "object" && "properties" in value && "labels" in value) {
      // This is a Neo4j Node - extract properties
      result[key] = (value as { properties: Record<string, unknown> }).properties
    } else if (value && typeof value === "object" && "properties" in value && "type" in value) {
      // This is a Neo4j Relationship - extract properties
      result[key] = (value as { properties: Record<string, unknown> }).properties
    } else if (value && typeof value === "object" && "low" in value && "high" in value) {
      // This is a Neo4j Integer
      const intValue = value as { toNumber?: () => number; low: number; high: number }
      result[key] = typeof intValue.toNumber === "function" ? intValue.toNumber() : intValue.low
    } else {
      result[key] = value
    }
  }

  return result as T
}

export function createMutationExecutor(connection: ConnectionManager): MutationExecutor {
  return {
    async run<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
      const { records } = await connection.run<Record<string, unknown>>(query, params)
      return records.map((r) => transformNeo4jResult<T>(r))
    },

    async runInTransaction<T>(fn: (tx: TransactionRunner) => Promise<T>): Promise<T> {
      return connection.transaction(async (ctx) => {
        const runner: TransactionRunner = {
          async run<R>(query: string, params: Record<string, unknown>): Promise<R[]> {
            const records = await ctx.run<Record<string, unknown>>(query, params)
            return records.map((r) => transformNeo4jResult<R>(r))
          },
        }
        return fn(runner)
      })
    },
  }
}

// =============================================================================
// RAW QUERY EXECUTOR
// =============================================================================

export function createRawExecutor(connection: ConnectionManager) {
  return {
    async run<T>(query: string, params?: Record<string, unknown>): Promise<T[]> {
      const { records } = await connection.run<Record<string, unknown>>(query, params ?? {})
      return records.map((r) => transformNeo4jResult<T>(r))
    },
  }
}

// =============================================================================
// TEST GRAPH INSTANCE
// =============================================================================

export function createTestGraph(connection: ConnectionManager): GraphQuery<TestSchema> {
  const mutationExecutor = createMutationExecutor(connection)
  const rawExecutor = createRawExecutor(connection)

  // Type assertion needed because createGraph has a generic constraint
  // that doesn't perfectly match our concrete schema type
  return createGraph(testSchema, {
    uri: MEMGRAPH_URI,
    mutationExecutor,
    rawExecutor,
  }) as unknown as GraphQuery<TestSchema>
}

// =============================================================================
// TEST UTILITIES
// =============================================================================

export async function clearDatabase(connection: ConnectionManager): Promise<void> {
  await connection.run("MATCH (n) DETACH DELETE n", {})
}

export async function seedTestData(connection: ConnectionManager): Promise<TestData> {
  // Create users
  const [user1] = await connection
    .run<{
      id: string
    }>(`CREATE (u:user {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`, {
      id: "user-1",
      email: "alice@example.com",
      name: "Alice",
      status: "active",
    })
    .then((r) => r.records)

  const [user2] = await connection
    .run<{
      id: string
    }>(`CREATE (u:user {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`, {
      id: "user-2",
      email: "bob@example.com",
      name: "Bob",
      status: "active",
    })
    .then((r) => r.records)

  const [user3] = await connection
    .run<{
      id: string
    }>(`CREATE (u:user {id: $id, email: $email, name: $name, status: $status}) RETURN u.id as id`, {
      id: "user-3",
      email: "charlie@example.com",
      name: "Charlie",
      status: "inactive",
    })
    .then((r) => r.records)

  // Create posts
  const [post1] = await connection
    .run<{
      id: string
    }>(`CREATE (p:post {id: $id, title: $title, content: $content, views: $views}) RETURN p.id as id`, {
      id: "post-1",
      title: "Hello World",
      content: "My first post",
      views: 100,
    })
    .then((r) => r.records)

  const [post2] = await connection
    .run<{
      id: string
    }>(`CREATE (p:post {id: $id, title: $title, content: $content, views: $views}) RETURN p.id as id`, {
      id: "post-2",
      title: "GraphQL vs REST",
      content: "A comparison",
      views: 250,
    })
    .then((r) => r.records)

  const [post3] = await connection
    .run<{
      id: string
    }>(`CREATE (p:post {id: $id, title: $title, views: $views}) RETURN p.id as id`, {
      id: "post-3",
      title: "Draft Post",
      views: 0,
    })
    .then((r) => r.records)

  // Create comments
  const [comment1] = await connection
    .run<{
      id: string
    }>(`CREATE (c:comment {id: $id, text: $text}) RETURN c.id as id`, { id: "comment-1", text: "Great post!" })
    .then((r) => r.records)

  const [comment2] = await connection
    .run<{
      id: string
    }>(`CREATE (c:comment {id: $id, text: $text}) RETURN c.id as id`, { id: "comment-2", text: "Thanks for sharing" })
    .then((r) => r.records)

  // Create tags
  const [tag1] = await connection
    .run<{ id: string }>(`CREATE (t:tag {id: $id, name: $name}) RETURN t.id as id`, { id: "tag-1", name: "tech" })
    .then((r) => r.records)

  const [tag2] = await connection
    .run<{ id: string }>(`CREATE (t:tag {id: $id, name: $name}) RETURN t.id as id`, { id: "tag-2", name: "tutorial" })
    .then((r) => r.records)

  // Create folders (hierarchy)
  await connection.run(`CREATE (f:folder {id: $id, name: $name, path: $path}) RETURN f.id as id`, {
    id: "folder-root",
    name: "Root",
    path: "/",
  })

  await connection.run(`CREATE (f:folder {id: $id, name: $name, path: $path}) RETURN f.id as id`, {
    id: "folder-docs",
    name: "Documents",
    path: "/documents",
  })

  await connection.run(`CREATE (f:folder {id: $id, name: $name, path: $path}) RETURN f.id as id`, {
    id: "folder-work",
    name: "Work",
    path: "/documents/work",
  })

  // Create relationships
  // User -> authored -> Post
  await connection.run(
    `MATCH (u:user {id: $userId}), (p:post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: "user-1", postId: "post-1" },
  )
  await connection.run(
    `MATCH (u:user {id: $userId}), (p:post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: "user-1", postId: "post-2" },
  )
  await connection.run(
    `MATCH (u:user {id: $userId}), (p:post {id: $postId}) CREATE (u)-[:authored {role: 'author'}]->(p)`,
    { userId: "user-2", postId: "post-3" },
  )

  // User -> likes -> Post
  await connection.run(`MATCH (u:user {id: $userId}), (p:post {id: $postId}) CREATE (u)-[:likes]->(p)`, {
    userId: "user-2",
    postId: "post-1",
  })
  await connection.run(`MATCH (u:user {id: $userId}), (p:post {id: $postId}) CREATE (u)-[:likes]->(p)`, {
    userId: "user-3",
    postId: "post-1",
  })
  await connection.run(`MATCH (u:user {id: $userId}), (p:post {id: $postId}) CREATE (u)-[:likes]->(p)`, {
    userId: "user-1",
    postId: "post-2",
  })

  // User -> follows -> User
  await connection.run(`MATCH (u1:user {id: $fromId}), (u2:user {id: $toId}) CREATE (u1)-[:follows]->(u2)`, {
    fromId: "user-2",
    toId: "user-1",
  })
  await connection.run(`MATCH (u1:user {id: $fromId}), (u2:user {id: $toId}) CREATE (u1)-[:follows]->(u2)`, {
    fromId: "user-3",
    toId: "user-1",
  })

  // Post -> hasComment -> Comment
  await connection.run(`MATCH (p:post {id: $postId}), (c:comment {id: $commentId}) CREATE (p)-[:hasComment]->(c)`, {
    postId: "post-1",
    commentId: "comment-1",
  })
  await connection.run(`MATCH (p:post {id: $postId}), (c:comment {id: $commentId}) CREATE (p)-[:hasComment]->(c)`, {
    postId: "post-1",
    commentId: "comment-2",
  })

  // User -> wroteComment -> Comment
  await connection.run(`MATCH (u:user {id: $userId}), (c:comment {id: $commentId}) CREATE (u)-[:wroteComment]->(c)`, {
    userId: "user-2",
    commentId: "comment-1",
  })
  await connection.run(`MATCH (u:user {id: $userId}), (c:comment {id: $commentId}) CREATE (u)-[:wroteComment]->(c)`, {
    userId: "user-3",
    commentId: "comment-2",
  })

  // Post -> tagged -> Tag
  await connection.run(`MATCH (p:post {id: $postId}), (t:tag {id: $tagId}) CREATE (p)-[:tagged]->(t)`, {
    postId: "post-1",
    tagId: "tag-1",
  })
  await connection.run(`MATCH (p:post {id: $postId}), (t:tag {id: $tagId}) CREATE (p)-[:tagged]->(t)`, {
    postId: "post-2",
    tagId: "tag-1",
  })
  await connection.run(`MATCH (p:post {id: $postId}), (t:tag {id: $tagId}) CREATE (p)-[:tagged]->(t)`, {
    postId: "post-2",
    tagId: "tag-2",
  })

  // Folder hierarchy
  await connection.run(
    `MATCH (child:folder {id: $childId}), (parent:folder {id: $parentId}) CREATE (child)-[:hasParent]->(parent)`,
    { childId: "folder-docs", parentId: "folder-root" },
  )
  await connection.run(
    `MATCH (child:folder {id: $childId}), (parent:folder {id: $parentId}) CREATE (child)-[:hasParent]->(parent)`,
    { childId: "folder-work", parentId: "folder-docs" },
  )

  return {
    users: { alice: user1!.id, bob: user2!.id, charlie: user3!.id },
    posts: { hello: post1!.id, graphql: post2!.id, draft: post3!.id },
    comments: { great: comment1!.id, thanks: comment2!.id },
    tags: { tech: tag1!.id, tutorial: tag2!.id },
    folders: { root: "folder-root", docs: "folder-docs", work: "folder-work" },
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
  connection: ConnectionManager
  executor: QueryExecutor
  graph: GraphQuery<TestSchema>
  data: TestData
}

export async function setupIntegrationTest(): Promise<TestContext> {
  const connection = createTestConnection()
  await connection.connect()

  await clearDatabase(connection)
  const data = await seedTestData(connection)

  const executor = createTestExecutor(connection)
  const graph = createTestGraph(connection)

  return { connection, executor, graph, data }
}

export async function teardownIntegrationTest(ctx: TestContext): Promise<void> {
  await clearDatabase(ctx.connection)
  await ctx.connection.close()
}
