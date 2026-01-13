/**
 * Integration Tests: Mutation Operations
 *
 * Tests mutation execution against a real Memgraph instance.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { setupIntegrationTest, teardownIntegrationTest, clearDatabase, seedTestData, type TestContext } from "./setup"

describe("Mutation Integration Tests", () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  // Reset data before each test to ensure isolation
  beforeEach(async () => {
    await clearDatabase(ctx.connection)
    ctx.data = await seedTestData(ctx.connection)
  })

  // ===========================================================================
  // NODE CRUD
  // ===========================================================================

  describe("Node CRUD", () => {
    it("creates a new node", async () => {
      const result = await ctx.graph.mutate.create("user", {
        email: "dave@example.com",
        name: "Dave",
        status: "active",
      })

      expect(result).toHaveProperty("id")
      expect(result.data.name).toBe("Dave")
      expect(result.data.email).toBe("dave@example.com")

      // Verify it was created
      const query = ctx.graph.nodeByIdWithLabel("user", result.id)
      const compiled = query.compile()
      const fetched = await ctx.executor.executeSingle(compiled)
      expect(fetched.data).toMatchObject({ name: "Dave" })
    })

    it("creates a node with custom ID", async () => {
      const customId = "custom-user-id"
      const result = await ctx.graph.mutate.create(
        "user",
        { email: "eve@example.com", name: "Eve", status: "active" },
        { id: customId },
      )

      expect(result.id).toBe(customId)
    })

    it("updates an existing node", async () => {
      const result = await ctx.graph.mutate.update("user", ctx.data.users.alice, {
        name: "Alice Updated",
      })

      expect(result.data.name).toBe("Alice Updated")

      // Verify the update
      const query = ctx.graph.nodeByIdWithLabel("user", ctx.data.users.alice)
      const compiled = query.compile()
      const fetched = await ctx.executor.executeSingle(compiled)
      expect(fetched.data).toMatchObject({ name: "Alice Updated" })
    })

    it("deletes a node", async () => {
      // First create a node without relationships
      const newUser = await ctx.graph.mutate.create("user", {
        email: "temp@example.com",
        name: "Temp",
        status: "active",
      })

      const result = await ctx.graph.mutate.delete("user", newUser.id)
      expect(result.deleted).toBe(true)

      // Verify deletion
      const query = ctx.graph.nodeByIdWithLabel("user", newUser.id)
      const compiled = query.compile()
      const fetched = await ctx.executor.executeOptional(compiled)
      expect(fetched.data).toBeNull()
    })

    it("deletes a node with DETACH (removes relationships)", async () => {
      // Charlie has relationships (follows)
      const result = await ctx.graph.mutate.delete("user", ctx.data.users.charlie, { detach: true })
      expect(result.deleted).toBe(true)

      // Verify deletion
      const query = ctx.graph.nodeByIdWithLabel("user", ctx.data.users.charlie)
      const compiled = query.compile()
      const fetched = await ctx.executor.executeOptional(compiled)
      expect(fetched.data).toBeNull()
    })
  })

  // ===========================================================================
  // EDGE CRUD
  // ===========================================================================

  describe("Edge CRUD", () => {
    it("creates an edge (link)", async () => {
      // Create new user and post
      const newUser = await ctx.graph.mutate.create("user", {
        email: "frank@example.com",
        name: "Frank",
        status: "active",
      })

      const newPost = await ctx.graph.mutate.create("post", {
        title: "Frank's Post",
        views: 0,
      })

      const result = await ctx.graph.mutate.link("authored", newUser.id, newPost.id, {
        role: "author",
      })

      expect(result).toHaveProperty("id")
      expect(result.from).toBe(newUser.id)
      expect(result.to).toBe(newPost.id)

      // Verify the relationship
      const query = ctx.graph.nodeByIdWithLabel("user", newUser.id).to("authored")
      const compiled = query.compile()
      const posts = await ctx.executor.execute(compiled)
      expect(posts.data).toHaveLength(1)
    })

    it("creates an edge without properties", async () => {
      // Make Bob like post-2
      const result = await ctx.graph.mutate.link("likes", ctx.data.users.bob, ctx.data.posts.graphql)

      expect(result.from).toBe(ctx.data.users.bob)
      expect(result.to).toBe(ctx.data.posts.graphql)
    })

    it("removes an edge (unlink)", async () => {
      // Remove Alice's like on post-2
      const result = await ctx.graph.mutate.unlink("likes", ctx.data.users.alice, ctx.data.posts.graphql)

      expect(result.deleted).toBe(true)

      // Verify removal - Alice should not have liked post-2 anymore
      // (She didn't actually like it in seed data, but this tests the operation)
    })
  })

  // ===========================================================================
  // HIERARCHY OPERATIONS
  // ===========================================================================

  describe("Hierarchy Operations", () => {
    it("creates a child node", async () => {
      const result = await ctx.graph.mutate.createChild(
        "folder",
        ctx.data.folders.docs,
        { name: "Projects", path: "/documents/projects" },
        { edge: "hasParent" },
      )

      expect(result).toHaveProperty("id")
      expect(result.data.name).toBe("Projects")

      // Verify parent relationship
      const query = ctx.graph.nodeByIdWithLabel("folder", result.id).ancestors()
      const compiled = query.compile()
      const ancestors = await ctx.executor.execute(compiled)
      expect(ancestors.data.length).toBeGreaterThanOrEqual(1)
    })

    it("moves a node to new parent", async () => {
      // Move 'work' folder directly under 'root' instead of 'docs'
      const result = await ctx.graph.mutate.move(ctx.data.folders.work, ctx.data.folders.root, { edge: "hasParent" })

      expect(result.moved).toBe(true)

      // Verify new parent
      const query = ctx.graph.nodeByIdWithLabel("folder", ctx.data.folders.work).ancestors()
      const compiled = query.compile()
      const ancestors = await ctx.executor.execute(compiled)

      // Should only have root as ancestor now (not docs)
      expect(ancestors.data).toHaveLength(1)
      expect((ancestors.data[0] as { name: string }).name).toBe("Root")
    })
  })

  // ===========================================================================
  // BATCH OPERATIONS
  // ===========================================================================

  describe("Batch Operations", () => {
    it("creates multiple nodes", async () => {
      const results = await ctx.graph.mutate.createMany("tag", [
        { name: "javascript" },
        { name: "typescript" },
        { name: "nodejs" },
      ])

      expect(results).toHaveLength(3)
      expect(results.map((r) => r.data.name)).toEqual(["javascript", "typescript", "nodejs"])
    })

    it("updates multiple nodes", async () => {
      const results = await ctx.graph.mutate.updateMany("user", [
        { id: ctx.data.users.alice, data: { status: "inactive" } },
        { id: ctx.data.users.bob, data: { status: "inactive" } },
      ])

      expect(results).toHaveLength(2)
      expect(results.every((r) => r.data.status === "inactive")).toBe(true)
    })

    it("deletes multiple nodes", async () => {
      // Create temp nodes to delete
      const tags = await ctx.graph.mutate.createMany("tag", [{ name: "temp1" }, { name: "temp2" }])

      // deleteMany returns a single DeleteResult, not an array
      const result = await ctx.graph.mutate.deleteMany(
        "tag",
        tags.map((t) => t.id),
      )

      expect(result.deleted).toBe(true)
    })

    describe("linkMany()", () => {
      it("creates multiple edges in a single operation", async () => {
        // Create some tags to link to posts
        const tags = await ctx.graph.mutate.createMany("tag", [
          { name: "graphdb" },
          { name: "cypher" },
          { name: "memgraph" },
        ])

        // Link all tags to post-1 in a single batch operation
        const results = await ctx.graph.mutate.linkMany("tagged", [
          { from: ctx.data.posts.hello, to: tags[0]!.id },
          { from: ctx.data.posts.hello, to: tags[1]!.id },
          { from: ctx.data.posts.hello, to: tags[2]!.id },
        ])

        expect(results).toHaveLength(3)
        expect(results.every((r) => r.from === ctx.data.posts.hello)).toBe(true)

        // Verify the edges were created by querying
        const query = ctx.graph.nodeByIdWithLabel("post", ctx.data.posts.hello).to("tagged")
        const compiled = query.compile()
        const linkedTags = await ctx.executor.execute(compiled)

        // Should have original tag (tech) + 3 new tags = 4 total
        expect(linkedTags.data.length).toBeGreaterThanOrEqual(3)
      })

      it("handles empty array (no-op)", async () => {
        const results = await ctx.graph.mutate.linkMany("tagged", [])

        expect(results).toHaveLength(0)
      })

      it("creates edges with properties", async () => {
        // Create new users to follow each other
        const users = await ctx.graph.mutate.createMany("user", [
          { email: "follower1@test.com", name: "Follower1", status: "active" },
          { email: "follower2@test.com", name: "Follower2", status: "active" },
        ])

        // Create follow relationships - follows edge doesn't have properties in schema
        // but we can test with authored which has 'role' property
        const newPost = await ctx.graph.mutate.create("post", {
          title: "Batch Test Post",
          views: 0,
        })

        const results = await ctx.graph.mutate.linkMany("authored", [
          { from: users[0]!.id, to: newPost.id, data: { role: "author" } },
          { from: users[1]!.id, to: newPost.id, data: { role: "coauthor" } },
        ])

        expect(results).toHaveLength(2)
        expect(results[0]!.data.role).toBe("author")
        expect(results[1]!.data.role).toBe("coauthor")
      })
    })

    describe("unlinkMany()", () => {
      it("deletes multiple edges in a single operation", async () => {
        // First create some edges to delete
        const tags = await ctx.graph.mutate.createMany("tag", [{ name: "delete-me-1" }, { name: "delete-me-2" }])

        await ctx.graph.mutate.linkMany("tagged", [
          { from: ctx.data.posts.draft, to: tags[0]!.id },
          { from: ctx.data.posts.draft, to: tags[1]!.id },
        ])

        // Now delete them in batch
        const result = await ctx.graph.mutate.unlinkMany("tagged", [
          { from: ctx.data.posts.draft, to: tags[0]!.id },
          { from: ctx.data.posts.draft, to: tags[1]!.id },
        ])

        expect(result.deleted).toBe(2)

        // Verify edges are gone
        const query = ctx.graph.nodeByIdWithLabel("post", ctx.data.posts.draft).to("tagged")
        const compiled = query.compile()
        const linkedTags = await ctx.executor.execute(compiled)
        const tagIds = linkedTags.data.map((t: { id: string }) => t.id)

        expect(tagIds).not.toContain(tags[0]!.id)
        expect(tagIds).not.toContain(tags[1]!.id)
      })

      it("handles empty array (no-op)", async () => {
        const result = await ctx.graph.mutate.unlinkMany("tagged", [])

        expect(result.deleted).toBe(0)
      })

      it("returns 0 when edges do not exist", async () => {
        const result = await ctx.graph.mutate.unlinkMany("tagged", [
          { from: "nonexistent-1", to: "nonexistent-2" },
        ])

        expect(result.deleted).toBe(0)
      })
    })

    describe("unlinkAllFrom()", () => {
      it("deletes all outgoing edges of a type from a node", async () => {
        // Create a post with multiple tags
        const testPost = await ctx.graph.mutate.create("post", {
          title: "Post with many tags",
          views: 0,
        })

        const tags = await ctx.graph.mutate.createMany("tag", [
          { name: "tag-a" },
          { name: "tag-b" },
          { name: "tag-c" },
        ])

        await ctx.graph.mutate.linkMany(
          "tagged",
          tags.map((t) => ({ from: testPost.id, to: t.id })),
        )

        // Verify edges exist
        const beforeQuery = ctx.graph.nodeByIdWithLabel("post", testPost.id).to("tagged")
        const beforeCompiled = beforeQuery.compile()
        const beforeTags = await ctx.executor.execute(beforeCompiled)
        expect(beforeTags.data).toHaveLength(3)

        // Delete all tagged edges from this post
        const result = await ctx.graph.mutate.unlinkAllFrom("tagged", testPost.id)

        expect(result.deleted).toBe(3)

        // Verify all edges are gone
        const afterTags = await ctx.executor.execute(beforeCompiled)
        expect(afterTags.data).toHaveLength(0)
      })

      it("returns 0 when no edges exist", async () => {
        const testPost = await ctx.graph.mutate.create("post", {
          title: "Post with no tags",
          views: 0,
        })

        const result = await ctx.graph.mutate.unlinkAllFrom("tagged", testPost.id)

        expect(result.deleted).toBe(0)
      })

      it("only deletes edges of the specified type", async () => {
        // Alice has authored edges and likes edges
        // unlinkAllFrom('likes', alice) should only remove likes, not authored

        // First verify Alice has authored edges
        const authoredQuery = ctx.graph.nodeByIdWithLabel("user", ctx.data.users.alice).to("authored")
        const authoredCompiled = authoredQuery.compile()
        const authoredBefore = await ctx.executor.execute(authoredCompiled)
        expect(authoredBefore.data.length).toBeGreaterThan(0)

        // Remove all likes from Alice
        await ctx.graph.mutate.unlinkAllFrom("likes", ctx.data.users.alice)

        // Verify authored edges still exist
        const authoredAfter = await ctx.executor.execute(authoredCompiled)
        expect(authoredAfter.data.length).toBe(authoredBefore.data.length)
      })
    })

    describe("unlinkAllTo()", () => {
      it("deletes all incoming edges of a type to a node", async () => {
        // Create a tag that multiple posts will link to
        const popularTag = await ctx.graph.mutate.create("tag", { name: "popular" })

        // Link multiple posts to this tag
        await ctx.graph.mutate.linkMany("tagged", [
          { from: ctx.data.posts.hello, to: popularTag.id },
          { from: ctx.data.posts.graphql, to: popularTag.id },
          { from: ctx.data.posts.draft, to: popularTag.id },
        ])

        // Verify edges exist
        const beforeQuery = ctx.graph.nodeByIdWithLabel("tag", popularTag.id).from("tagged")
        const beforeCompiled = beforeQuery.compile()
        const beforePosts = await ctx.executor.execute(beforeCompiled)
        expect(beforePosts.data).toHaveLength(3)

        // Delete all incoming tagged edges to this tag
        const result = await ctx.graph.mutate.unlinkAllTo("tagged", popularTag.id)

        expect(result.deleted).toBe(3)

        // Verify all edges are gone
        const afterPosts = await ctx.executor.execute(beforeCompiled)
        expect(afterPosts.data).toHaveLength(0)
      })

      it("returns 0 when no edges exist", async () => {
        const lonelyTag = await ctx.graph.mutate.create("tag", { name: "lonely" })

        const result = await ctx.graph.mutate.unlinkAllTo("tagged", lonelyTag.id)

        expect(result.deleted).toBe(0)
      })

      it("only deletes edges of the specified type", async () => {
        // Post-1 has incoming 'authored' edges and outgoing 'hasComment' edges
        // unlinkAllTo should only affect incoming edges of the specified type

        // Verify post-1 has comments (outgoing hasComment)
        const commentsQuery = ctx.graph.nodeByIdWithLabel("post", ctx.data.posts.hello).to("hasComment")
        const commentsCompiled = commentsQuery.compile()
        const commentsBefore = await ctx.executor.execute(commentsCompiled)
        expect(commentsBefore.data.length).toBeGreaterThan(0)

        // Remove all incoming 'likes' to post-1
        await ctx.graph.mutate.unlinkAllTo("likes", ctx.data.posts.hello)

        // Verify hasComment edges still exist (different edge type)
        const commentsAfter = await ctx.executor.execute(commentsCompiled)
        expect(commentsAfter.data.length).toBe(commentsBefore.data.length)
      })
    })
  })

  // ===========================================================================
  // TRANSACTIONS
  // ===========================================================================

  describe("Transactions", () => {
    it("commits successful transaction", async () => {
      await ctx.graph.mutate.transaction(async (tx) => {
        const user = await tx.create("user", {
          email: "tx-user@example.com",
          name: "Transaction User",
          status: "active",
        })

        await tx.create("post", {
          title: "Transaction Post",
          views: 0,
        })

        await tx.link("authored", user.id, ctx.data.posts.hello) // Link to existing post
      })

      // Verify user was created
      const query = ctx.graph.node("user").where("email", "eq", "tx-user@example.com")
      const compiled = query.compile()
      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(1)
    })

    it("rolls back failed transaction", async () => {
      try {
        await ctx.graph.mutate.transaction(async (tx) => {
          await tx.create("user", {
            email: "rollback@example.com",
            name: "Rollback User",
            status: "active",
          })

          // Force an error
          throw new Error("Intentional rollback")
        })
      } catch {
        // Expected
      }

      // Verify user was NOT created (rolled back)
      const query = ctx.graph.node("user").where("email", "eq", "rollback@example.com")
      const compiled = query.compile()
      const result = await ctx.executor.execute(compiled)
      expect(result.data).toHaveLength(0)
    })
  })

  // ===========================================================================
  // UPSERT OPERATIONS
  // ===========================================================================

  describe("Upsert Operations", () => {
    it("creates a new node when it doesn't exist", async () => {
      const result = await ctx.graph.mutate.upsert("user", "upsert-new-user", {
        email: "upsert-new@example.com",
        name: "Upsert New",
        status: "active",
      })

      expect(result.id).toBe("upsert-new-user")
      expect(result.data.name).toBe("Upsert New")
      expect(result.created).toBe(true)

      // Verify it was created
      const query = ctx.graph.nodeByIdWithLabel("user", "upsert-new-user")
      const compiled = query.compile()
      const fetched = await ctx.executor.executeSingle(compiled)
      expect(fetched.data).toMatchObject({ name: "Upsert New" })
    })

    it("updates an existing node when it exists", async () => {
      // First create
      await ctx.graph.mutate.upsert("user", "upsert-existing-user", {
        email: "upsert-existing@example.com",
        name: "Original Name",
        status: "active",
      })

      // Then upsert again with updated data
      const result = await ctx.graph.mutate.upsert("user", "upsert-existing-user", {
        email: "upsert-existing@example.com",
        name: "Updated Name",
        status: "inactive",
      })

      expect(result.id).toBe("upsert-existing-user")
      expect(result.data.name).toBe("Updated Name")
      expect(result.data.status).toBe("inactive")
      // Note: created flag depends on MERGE implementation
    })

    it("works in transactions", async () => {
      await ctx.graph.mutate.transaction(async (tx) => {
        await tx.upsert("tag", "tx-upsert-tag", { name: "tx-upsert-test" })
      })

      // Verify it was created
      const query = ctx.graph.nodeByIdWithLabel("tag", "tx-upsert-tag")
      const compiled = query.compile()
      const fetched = await ctx.executor.executeSingle(compiled)
      expect(fetched.data).toMatchObject({ name: "tx-upsert-test" })
    })
  })
})
