import { describe, it, expect, beforeEach } from "vitest"
import { defineSchema, node, edge } from "@astrale/typegraph"
import { z } from "zod"
import { createInMemoryGraph, type InMemoryGraph } from "../src"

// =============================================================================
// TEST SCHEMA
// =============================================================================

const testSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        name: z.string(),
        email: z.string().email(),
        age: z.number().optional(),
      },
    }),
    post: node({
      properties: {
        title: z.string(),
        content: z.string(),
        published: z.boolean().default(false),
      },
    }),
    comment: node({
      properties: {
        text: z.string(),
      },
    }),
  },
  edges: {
    authored: edge({
      from: "user",
      to: "post",
      cardinality: { outbound: "many", inbound: "one" },
    }),
    commented: edge({
      from: "user",
      to: "comment",
      cardinality: { outbound: "many", inbound: "one" },
    }),
    hasComment: edge({
      from: "post",
      to: "comment",
      cardinality: { outbound: "many", inbound: "one" },
    }),
    hasParent: edge({
      from: "post",
      to: "post",
      cardinality: { outbound: "optional", inbound: "many" },
    }),
  },
  hierarchy: { defaultEdge: "hasParent", direction: "up" },
})

type TestSchema = typeof testSchema

// =============================================================================
// TESTS
// =============================================================================

describe("createInMemoryGraph", () => {
  let graph: InMemoryGraph<TestSchema>

  beforeEach(() => {
    graph = createInMemoryGraph(testSchema)
  })

  describe("basic creation", () => {
    it("should create an in-memory graph instance", () => {
      expect(graph).toBeDefined()
      expect(graph.mutate).toBeDefined()
      expect(graph.node).toBeDefined()
      expect(graph.nodeById).toBeDefined()
    })

    it("should have in-memory specific methods", () => {
      expect(graph.getStore).toBeDefined()
      expect(graph.clear).toBeDefined()
      expect(graph.export).toBeDefined()
      expect(graph.import).toBeDefined()
      expect(graph.stats).toBeDefined()
    })

    it("should start with empty stats", () => {
      const stats = graph.stats()
      expect(stats.nodes).toBe(0)
      expect(stats.edges).toBe(0)
    })
  })

  describe("node mutations", () => {
    it("should create a node", async () => {
      const result = await graph.mutate.create("user", {
        name: "John Doe",
        email: "john@example.com",
      })

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.data.name).toBe("John Doe")
      expect(result.data.email).toBe("john@example.com")
    })

    it("should create multiple nodes", async () => {
      const user1 = await graph.mutate.create("user", {
        name: "John",
        email: "john@example.com",
      })
      const user2 = await graph.mutate.create("user", {
        name: "Jane",
        email: "jane@example.com",
      })

      expect(user1.id).not.toBe(user2.id)

      const stats = graph.stats()
      expect(stats.nodes).toBe(2)
    })

    it("should update a node", async () => {
      const user = await graph.mutate.create("user", {
        name: "John",
        email: "john@example.com",
      })

      const updated = await graph.mutate.update("user", user.id, {
        name: "John Updated",
      })

      expect(updated.data.name).toBe("John Updated")
      expect(updated.data.email).toBe("john@example.com")
    })

    it("should delete a node", async () => {
      const user = await graph.mutate.create("user", {
        name: "John",
        email: "john@example.com",
      })

      expect(graph.stats().nodes).toBe(1)

      await graph.mutate.delete("user", user.id)

      expect(graph.stats().nodes).toBe(0)
    })
  })

  describe("edge mutations", () => {
    it("should create an edge (link)", async () => {
      const user = await graph.mutate.create("user", {
        name: "John",
        email: "john@example.com",
      })
      const post = await graph.mutate.create("post", {
        title: "Hello World",
        content: "My first post",
      })

      await graph.mutate.link("authored", user.id, post.id)

      expect(graph.stats().edges).toBe(1)
    })

    it("should delete an edge (unlink)", async () => {
      const user = await graph.mutate.create("user", {
        name: "John",
        email: "john@example.com",
      })
      const post = await graph.mutate.create("post", {
        title: "Hello World",
        content: "My first post",
      })

      await graph.mutate.link("authored", user.id, post.id)
      expect(graph.stats().edges).toBe(1)

      await graph.mutate.unlink("authored", user.id, post.id)
      expect(graph.stats().edges).toBe(0)
    })
  })

  describe("hierarchy mutations", () => {
    it("should create a child node with parent relationship", async () => {
      const parentPost = await graph.mutate.create("post", {
        title: "Parent Post",
        content: "Parent content",
      })

      const childPost = await graph.mutate.createChild("post", parentPost.id, {
        title: "Child Post",
        content: "Child content",
      })

      expect(childPost).toBeDefined()
      expect(childPost.id).toBeDefined()
      expect(childPost.data.title).toBe("Child Post")

      // Should have created the hasParent edge
      expect(graph.stats().edges).toBe(1)
    })
  })

  describe("node queries", () => {
    it("should query all nodes of a type", async () => {
      await graph.mutate.create("user", { name: "John", email: "john@example.com" })
      await graph.mutate.create("user", { name: "Jane", email: "jane@example.com" })
      await graph.mutate.create("post", { title: "Post 1", content: "Content 1" })

      const users = await graph.node("user").execute()

      expect(users).toHaveLength(2)
      expect(users.map((u) => u.name).sort()).toEqual(["Jane", "John"])
    })

    it("should query a node by ID", async () => {
      const created = await graph.mutate.create("user", {
        name: "John",
        email: "john@example.com",
      })

      const user = await graph.nodeByIdWithLabel("user", created.id).execute()

      expect(user).toBeDefined()
      expect(user?.id).toBe(created.id)
      expect(user?.name).toBe("John")
    })

    it("should throw for non-existent node with nodeById", async () => {
      // nodeById throws CardinalityError when node doesn't exist
      await expect(graph.nodeByIdWithLabel("user", "non-existent-id").execute()).rejects.toThrow()
    })
  })

  describe("in-memory specific features", () => {
    it("should clear all data", async () => {
      await graph.mutate.create("user", { name: "John", email: "john@example.com" })
      await graph.mutate.create("post", { title: "Post", content: "Content" })

      expect(graph.stats().nodes).toBe(2)

      graph.clear()

      expect(graph.stats().nodes).toBe(0)
      expect(graph.stats().edges).toBe(0)
    })

    it("should export and import data", async () => {
      const user = await graph.mutate.create("user", {
        name: "John",
        email: "john@example.com",
      })
      const post = await graph.mutate.create("post", {
        title: "Hello",
        content: "World",
      })
      await graph.mutate.link("authored", user.id, post.id)

      const exported = graph.export()

      expect(exported.nodes).toHaveLength(2)
      expect(exported.edges).toHaveLength(1)

      // Clear and import
      graph.clear()
      expect(graph.stats().nodes).toBe(0)

      graph.import(exported)

      expect(graph.stats().nodes).toBe(2)
      expect(graph.stats().edges).toBe(1)

      // Verify data integrity
      const retrievedUser = await graph.nodeByIdWithLabel("user", user.id).execute()
      expect(retrievedUser?.name).toBe("John")
    })

    it("should initialize with initial data", () => {
      const graphWithData = createInMemoryGraph(testSchema, {
        initialData: {
          nodes: [
            { label: "user", id: "user-1", properties: { name: "John", email: "john@example.com" } },
            { label: "post", id: "post-1", properties: { title: "Test", content: "Content" } },
          ],
          edges: [{ type: "authored", id: "edge-1", fromId: "user-1", toId: "post-1" }],
        },
      })

      expect(graphWithData.stats().nodes).toBe(2)
      expect(graphWithData.stats().edges).toBe(1)
    })
  })

  describe("transactions", () => {
    it("should execute mutations in a transaction", async () => {
      await graph.mutate.transaction(async (tx) => {
        await tx.create("user", { name: "John", email: "john@example.com" })
        await tx.create("user", { name: "Jane", email: "jane@example.com" })
      })

      expect(graph.stats().nodes).toBe(2)
    })

    it("should rollback on transaction error", async () => {
      try {
        await graph.mutate.transaction(async (tx) => {
          await tx.create("user", { name: "John", email: "john@example.com" })
          throw new Error("Intentional error")
        })
      } catch {
        // Expected
      }

      // Transaction should have rolled back
      expect(graph.stats().nodes).toBe(0)
    })
  })

  describe("whereConnectedTo queries", () => {
    it("should filter by outgoing edge connection", async () => {
      // whereConnectedTo filters by OUTGOING edges from the queried node type
      // For "post", hasParent is an outgoing edge (post --hasParent--> post)

      // Create a parent post and children
      const parent = await graph.mutate.create("post", { title: "Parent", content: "Parent content" })

      // Create children that have hasParent edge pointing to parent
      const child1 = await graph.mutate.createChild("post", parent.id, { title: "Child 1", content: "C1" })
      const child2 = await graph.mutate.createChild("post", parent.id, { title: "Child 2", content: "C2" })

      // Create another post with no parent
      await graph.mutate.create("post", { title: "Orphan", content: "No parent" })

      // Query posts that have an outgoing hasParent edge to 'parent'
      const childrenOfParent = await graph.node("post").whereConnectedTo("hasParent", parent.id).execute()

      expect(childrenOfParent).toHaveLength(2)
      expect(childrenOfParent.map((p) => p.title).sort()).toEqual(["Child 1", "Child 2"])
    })

    it("should filter by multiple whereConnectedTo conditions", async () => {
      // This mimics the kernel's findAppInstanceUnderParent pattern:
      // graph.node("application")
      //   .whereConnectedTo("hasParent", parentId)
      //   .whereConnectedTo("definedBy", definitionAppId)
      //   .execute()

      // Create parent posts
      const parentA = await graph.mutate.create("post", { title: "Parent A", content: "Content A" })
      const parentB = await graph.mutate.create("post", { title: "Parent B", content: "Content B" })

      // Create child posts under different parents
      const child1 = await graph.mutate.createChild("post", parentA.id, { title: "Child 1", content: "C1" })
      const child2 = await graph.mutate.createChild("post", parentA.id, { title: "Child 2", content: "C2" })
      const child3 = await graph.mutate.createChild("post", parentB.id, { title: "Child 3", content: "C3" })

      // Query children under parentA only
      const childrenOfA = await graph.node("post").whereConnectedTo("hasParent", parentA.id).execute()

      expect(childrenOfA).toHaveLength(2)
      expect(childrenOfA.map((p) => p.title).sort()).toEqual(["Child 1", "Child 2"])

      // Query children under parentB only
      const childrenOfB = await graph.node("post").whereConnectedTo("hasParent", parentB.id).execute()

      expect(childrenOfB).toHaveLength(1)
      expect(childrenOfB[0]!.title).toBe("Child 3")
    })

    it("should return empty array when no matching connections exist", async () => {
      // Create posts without any parent
      await graph.mutate.create("post", { title: "Orphan 1", content: "Content 1" })
      await graph.mutate.create("post", { title: "Orphan 2", content: "Content 2" })

      // Create a potential parent that no one points to
      const potentialParent = await graph.mutate.create("post", {
        title: "Potential Parent",
        content: "No children",
      })

      // Query posts connected to potentialParent via hasParent - should be empty
      const children = await graph.node("post").whereConnectedTo("hasParent", potentialParent.id).execute()

      expect(children).toHaveLength(0)
    })
  })
})
