/**
 * Integration Tests: Query Operations
 *
 * Tests query compilation and execution against a real Memgraph instance.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from "./setup"
import { CypherCompiler } from "../../src/compiler"
import { testSchema } from "./setup"

describe("Query Integration Tests", () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  // ===========================================================================
  // BASIC NODE QUERIES
  // ===========================================================================

  describe("Basic Node Queries", () => {
    it("fetches all nodes of a type", async () => {
      const query = ctx.graph.node("user")
      const compiled = query.compile()

      expect(compiled.cypher).toContain("MATCH")
      expect(compiled.cypher).toContain(":user")

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(3)
    })

    it("fetches node by ID", async () => {
      const query = ctx.graph.nodeByIdWithLabel("user", ctx.data.users.alice)
      const compiled = query.compile()

      expect(compiled.cypher).toContain("WHERE")
      expect(compiled.cypher).toContain("id")

      const result = await ctx.executor.executeSingle(compiled)
      expect(result.data).toMatchObject({
        id: ctx.data.users.alice,
        name: "Alice",
        email: "alice@example.com",
      })
    })

    it("returns null for non-existent node", async () => {
      const query = ctx.graph.nodeByIdWithLabel("user", "non-existent-id")
      const compiled = query.compile()

      const result = await ctx.executor.executeOptional(compiled)
      expect(result.data).toBeNull()
    })
  })

  // ===========================================================================
  // WHERE FILTERING
  // ===========================================================================

  describe("WHERE Filtering", () => {
    it("filters by equality", async () => {
      const query = ctx.graph.node("user").where("status", "eq", "active")
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2)
      expect(result.data.every((u: { status: string }) => u.status === "active")).toBe(true)
    })

    it("filters by inequality", async () => {
      const query = ctx.graph.node("user").where("status", "neq", "inactive")
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2)
    })

    it("filters by greater than", async () => {
      const query = ctx.graph.node("post").where("views", "gt", 50)
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2)
      expect(result.data.every((p: { views: number }) => p.views > 50)).toBe(true)
    })

    it("filters by IN list", async () => {
      const query = ctx.graph.node("user").where("name", "in", ["Alice", "Bob"])
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2)
    })

    it("filters by CONTAINS", async () => {
      const query = ctx.graph.node("post").where("title", "contains", "World")
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(1)
      expect((result.data[0] as { title: string }).title).toBe("Hello World")
    })

    it("filters by STARTS WITH", async () => {
      const query = ctx.graph.node("post").where("title", "startsWith", "Graph")
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(1)
    })

    it("filters by IS NULL", async () => {
      const query = ctx.graph.node("post").where("content", "isNull")
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(1)
      expect((result.data[0] as { title: string }).title).toBe("Draft Post")
    })

    it("filters by IS NOT NULL", async () => {
      const query = ctx.graph.node("post").where("content", "isNotNull")
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2)
    })
  })

  // ===========================================================================
  // TRAVERSALS
  // ===========================================================================

  describe("Traversals", () => {
    it("traverses outgoing edge", async () => {
      const query = ctx.graph.nodeByIdWithLabel("user", ctx.data.users.alice).to("authored")
      const compiled = query.compile()

      // Edge pattern includes alias like -[e0:authored]->
      expect(compiled.cypher).toContain(":authored")
      expect(compiled.cypher).toContain("->")

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2)
    })

    it("traverses incoming edge", async () => {
      const query = ctx.graph.nodeByIdWithLabel("post", ctx.data.posts.hello).from("authored")
      const compiled = query.compile()

      // Edge pattern includes alias like <-[e0:authored]-
      expect(compiled.cypher).toContain(":authored")
      expect(compiled.cypher).toContain("<-")

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(1)
      expect((result.data[0] as { name: string }).name).toBe("Alice")
    })

    it("chains multiple traversals", async () => {
      // User -> authored -> Post -> hasComment -> Comment
      const query = ctx.graph.nodeByIdWithLabel("user", ctx.data.users.alice).to("authored").to("hasComment")

      const compiled = query.compile()
      const result = await ctx.executor.execute(compiled)

      expect(result.data).toHaveLength(2) // 2 comments on Alice's posts
    })

    it("traverses with edge filter", async () => {
      // This would filter edges by properties - simplified test
      const query = ctx.graph.nodeByIdWithLabel("user", ctx.data.users.alice).to("authored")
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data.length).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // ORDERING AND PAGINATION
  // ===========================================================================

  describe("Ordering and Pagination", () => {
    it("orders by field ascending", async () => {
      const query = ctx.graph.node("user").orderBy("name", "ASC")
      const compiled = query.compile()

      expect(compiled.cypher).toContain("ORDER BY")
      expect(compiled.cypher).toContain("ASC")

      const result = await ctx.executor.execute(compiled)
      const names = result.data.map((u: { name: string }) => u.name)
      expect(names).toEqual(["Alice", "Bob", "Charlie"])
    })

    it("orders by field descending", async () => {
      const query = ctx.graph.node("post").orderBy("views", "DESC")
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      const views = result.data.map((p: { views: number }) => p.views)
      expect(views).toEqual([250, 100, 0])
    })

    it("applies LIMIT", async () => {
      const query = ctx.graph.node("user").limit(2)
      const compiled = query.compile()

      expect(compiled.cypher).toContain("LIMIT 2")

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2)
    })

    it("applies SKIP", async () => {
      const query = ctx.graph.node("user").orderBy("name", "ASC").skip(1)
      const compiled = query.compile()

      expect(compiled.cypher).toContain("SKIP 1")

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2)
      expect((result.data[0] as { name: string }).name).toBe("Bob")
    })

    it("applies pagination", async () => {
      const query = ctx.graph.node("user").orderBy("name", "ASC").paginate({ page: 2, pageSize: 1 })
      const compiled = query.compile()

      expect(compiled.cypher).toContain("SKIP 1")
      expect(compiled.cypher).toContain("LIMIT 1")

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(1)
      expect((result.data[0] as { name: string }).name).toBe("Bob")
    })
  })

  // ===========================================================================
  // EDGE EXISTENCE
  // ===========================================================================

  describe("Edge Existence Filtering", () => {
    it("filters by hasEdge", async () => {
      const query = ctx.graph.node("user").hasEdge("authored", "out")
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2) // Alice and Bob have authored posts
    })

    it("filters by hasNoEdge", async () => {
      const query = ctx.graph.node("user").hasNoEdge("authored", "out")
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(1) // Charlie has no posts
      expect((result.data[0] as { name: string }).name).toBe("Charlie")
    })
  })

  // ===========================================================================
  // COUNT AND EXISTS
  // ===========================================================================

  describe("Aggregations", () => {
    it("counts nodes", async () => {
      const query = ctx.graph.node("user")
      const ast = query["_ast"].setCountProjection()
      const compiler = new CypherCompiler(testSchema)
      const compiled = compiler.compile(ast)

      const count = await ctx.executor.executeCount(compiled)
      expect(count).toBe(3)
    })

    it("checks existence - true", async () => {
      const query = ctx.graph.node("user").where("name", "eq", "Alice")
      const ast = query["_ast"].setExistsProjection()
      const compiler = new CypherCompiler(testSchema)
      const compiled = compiler.compile(ast)

      const exists = await ctx.executor.executeExists(compiled)
      expect(exists).toBe(true)
    })

    it("checks existence - false", async () => {
      const query = ctx.graph.node("user").where("name", "eq", "NonExistent")
      const ast = query["_ast"].setExistsProjection()
      const compiler = new CypherCompiler(testSchema)
      const compiled = compiler.compile(ast)

      const exists = await ctx.executor.executeExists(compiled)
      expect(exists).toBe(false)
    })
  })

  // ===========================================================================
  // MULTI-NODE RETURN
  // ===========================================================================

  describe("Multi-Node Return", () => {
    it("returns multiple aliased nodes", async () => {
      const query = ctx.graph
        .nodeByIdWithLabel("user", ctx.data.users.alice)
        .as("author")
        .to("authored")
        .as("post")
        .returning("author", "post")

      const compiled = query.compile()

      expect(compiled.cypher).toContain("AS author")
      expect(compiled.cypher).toContain("AS post")

      const result = await ctx.executor.executeMultiNode(compiled)
      expect(result.data.length).toBeGreaterThan(0)

      const first = result.data[0]!
      expect(first).toHaveProperty("author")
      expect(first).toHaveProperty("post")
    })
  })

  // ===========================================================================
  // HIERARCHY QUERIES
  // ===========================================================================

  describe("Hierarchy Queries", () => {
    it("gets ancestors", async () => {
      const query = ctx.graph.nodeByIdWithLabel("folder", ctx.data.folders.work).ancestors()
      const compiled = query.compile()

      expect(compiled.cypher).toContain(":hasParent")

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2) // docs and root
    })

    it("gets descendants", async () => {
      const query = ctx.graph.nodeByIdWithLabel("folder", ctx.data.folders.root).descendants()
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(2) // docs and work
    })

    it("gets children", async () => {
      const query = ctx.graph.nodeByIdWithLabel("folder", ctx.data.folders.root).children()
      const compiled = query.compile()

      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(1) // just docs
      expect((result.data[0] as { name: string }).name).toBe("Documents")
    })
  })

  // ===========================================================================
  // DISTINCT
  // ===========================================================================

  describe("Distinct", () => {
    it("returns distinct results", async () => {
      // Get all users who liked any post (some might like multiple)
      const query = ctx.graph.node("post").from("likes").distinct()
      const compiled = query.compile()

      expect(compiled.cypher).toContain("DISTINCT")

      const result = await ctx.executor.execute(compiled)
      // Should have distinct users
      const ids = result.data.map((u: { id: string }) => u.id)
      const uniqueIds = [...new Set(ids)]
      expect(ids.length).toBe(uniqueIds.length)
    })
  })

  // ===========================================================================
  // RAW QUERIES
  // ===========================================================================

  describe("Raw Queries", () => {
    it("executes a raw Cypher query", async () => {
      const results = await ctx.graph.raw<{ name: string; email: string }>(
        `MATCH (u:user) WHERE u.status = $status RETURN u.name as name, u.email as email ORDER BY u.name`,
        { status: "active" },
      )

      expect(results).toHaveLength(2) // Alice and Bob are active
      expect(results[0]?.name).toBe("Alice")
      expect(results[1]?.name).toBe("Bob")
    })

    it("executes a raw query with aggregation", async () => {
      const results = await ctx.graph.raw<{ status: string; count: number }>(
        `MATCH (u:user) RETURN u.status as status, count(u) as count ORDER BY status`,
        {},
      )

      expect(results).toHaveLength(2)
      expect(results.find((r) => r.status === "active")?.count).toBe(2)
      expect(results.find((r) => r.status === "inactive")?.count).toBe(1)
    })

    it("executes a raw query with relationships", async () => {
      const results = await ctx.graph.raw<{ author: string; postCount: number }>(
        `MATCH (u:user)-[:authored]->(p:post)
         RETURN u.name as author, count(p) as postCount
         ORDER BY postCount DESC`,
        {},
      )

      expect(results.length).toBeGreaterThan(0)
      // Alice authored 2 posts
      const alice = results.find((r) => r.author === "Alice")
      expect(alice?.postCount).toBe(2)
    })

    it("returns empty array for no matches", async () => {
      const results = await ctx.graph.raw<{ id: string }>(`MATCH (u:user {id: $id}) RETURN u.id as id`, {
        id: "non-existent-id",
      })

      expect(results).toHaveLength(0)
    })
  })
})
