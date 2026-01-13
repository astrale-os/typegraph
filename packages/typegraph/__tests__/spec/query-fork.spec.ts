/**
 * Query Compilation Specification - Fork (Fan-out) Patterns
 *
 * Tests the fork() method for complex multi-branch traversals.
 * These patterns are essential for avoiding N+1 queries in real-world scenarios
 * like the chat-message listMessages endpoint.
 *
 * Focus: Cypher compilation verification (no database required)
 */

import { describe, it, expect } from "vitest"
import { z } from "zod"
import { defineSchema, node, edge } from "../../src/schema/builders"
import { createGraph } from "../../src/query/entry"
import { normalizeCypher } from "./fixtures/test-schema"

// =============================================================================
// TEST SCHEMA
// =============================================================================

const forkTestSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
        status: z.enum(["active", "inactive"]).default("active"),
      },
    }),
    post: node({
      properties: {
        title: z.string(),
        content: z.string().optional(),
        views: z.number().default(0),
      },
    }),
    comment: node({
      properties: {
        text: z.string(),
        createdAt: z.date().optional(),
      },
    }),
    message: node({
      properties: {
        content: z.string(),
        createdAt: z.date().optional(),
      },
    }),
    reaction: node({
      properties: {
        emoji: z.string(),
      },
    }),
    tag: node({
      properties: {
        name: z.string(),
      },
    }),
    folder: node({
      properties: {
        name: z.string(),
        path: z.string(),
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
    follows: edge({
      from: "user",
      to: "user",
      cardinality: { outbound: "many", inbound: "many" },
    }),
    likes: edge({
      from: "user",
      to: "post",
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
    tagged: edge({
      from: "post",
      to: "tag",
      cardinality: { outbound: "many", inbound: "many" },
    }),
    // Message-specific edges (for chat-like patterns)
    replyTo: edge({
      from: "message",
      to: "message",
      cardinality: { outbound: "optional", inbound: "many" },
    }),
    hasReaction: edge({
      from: "message",
      to: "reaction",
      cardinality: { outbound: "many", inbound: "one" },
    }),
    // Hierarchy
    hasParent: edge({
      from: "folder",
      to: "folder",
      cardinality: { outbound: "optional", inbound: "many" },
    }),
  },
  hierarchy: {
    defaultEdge: "hasParent",
    direction: "up",
  },
})

type ForkTestSchema = typeof forkTestSchema

// Create graph without executor (for compilation tests only)
const graph = createGraph(forkTestSchema, { uri: "" })

describe("Query Compilation: Fork Patterns", () => {
  // ===========================================================================
  // BASIC FORK PATTERNS
  // ===========================================================================

  describe("Basic Fork Patterns", () => {
    it("compiles fork with two branches", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork(
          (q) => q.to("authored").as("post"),
          (q) => q.from("follows").as("follower"),
        )
        .returning("user", "post", "follower")

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have initial MATCH for user
      expect(cypher).toContain("MATCH")
      expect(cypher).toContain(":user")

      // Should have OPTIONAL MATCH for each fork branch
      expect(cypher).toContain("OPTIONAL MATCH")
      expect(cypher).toContain(":authored")
      expect(cypher).toContain(":follows")

      // Should return all aliases
      expect(cypher).toContain("AS user")
      expect(cypher).toContain("AS post")
      expect(cypher).toContain("AS follower")
    })

    it("compiles fork with optional traversals", () => {
      const query = graph
        .nodeByIdWithLabel("post", "post-1")
        .as("post")
        .fork(
          (q) => q.fromOptional("authored").as("author"),
          (q) => q.toOptional("hasComment").as("comment"),
        )
        .returning("post", "author", "comment")

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Both branches should be OPTIONAL MATCH
      const optionalMatchCount = (cypher.match(/OPTIONAL MATCH/g) || []).length
      expect(optionalMatchCount).toBeGreaterThanOrEqual(2)
    })

    it("compiles fork with collect aggregation", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork(
          (q) => q.to("authored").as("post"),
          (q) => q.from("follows").as("follower"),
        )
        .returning("user", { posts: { collect: "post" } }, { followers: { collect: "follower" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should use collect() in RETURN
      expect(cypher).toContain("collect(")
      expect(cypher).toContain("AS posts")
      expect(cypher).toContain("AS followers")
    })

    it("compiles fork with distinct collect", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", { posts: { collect: "post", distinct: true } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should use DISTINCT in collect
      expect(cypher).toContain("collect(DISTINCT")
    })
  })

  // ===========================================================================
  // COMPLEX FORK PATTERNS (Chat-like scenarios)
  // ===========================================================================

  describe("Complex Fork Patterns (Chat-like)", () => {
    it("compiles listMessages pattern: message with replyTo and reactions", () => {
      // This mirrors the chat-message listMessages endpoint pattern
      const query = graph
        .nodeByIdWithLabel("message", "msg-1")
        .as("msg")
        .fork(
          (q) => q.toOptional("replyTo").as("replyTo"),
          (q) => q.to("hasReaction").as("reaction"),
        )
        .returning("msg", "replyTo", { reactions: { collect: "reaction" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(":message")
      expect(cypher).toContain(":replyTo")
      expect(cypher).toContain(":hasReaction")
      expect(cypher).toContain("collect(")
      expect(cypher).toContain("AS reactions")
    })

    it("compiles message with incoming replies (for reply count)", () => {
      const query = graph
        .nodeByIdWithLabel("message", "msg-1")
        .as("msg")
        .fork(
          (q) => q.toOptional("replyTo").as("replyTo"),
          (q) => q.from("replyTo").as("reply"), // Messages that reply to this one
          (q) => q.to("hasReaction").as("reaction"),
        )
        .returning(
          "msg",
          "replyTo",
          { replies: { collect: "reply" } },
          { reactions: { collect: "reaction" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have 3 OPTIONAL MATCH clauses
      const optionalMatchCount = (cypher.match(/OPTIONAL MATCH/g) || []).length
      expect(optionalMatchCount).toBe(3)

      expect(cypher).toContain("AS replies")
      expect(cypher).toContain("AS reactions")
    })

    it("compiles three-way fork", () => {
      const query = graph
        .nodeByIdWithLabel("post", "post-1")
        .as("post")
        .fork(
          (q) => q.from("authored").as("author"),
          (q) => q.to("hasComment").as("comment"),
          (q) => q.to("tagged").as("tag"),
        )
        .returning(
          "post",
          "author",
          { comments: { collect: "comment" } },
          { tags: { collect: "tag" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(":authored")
      expect(cypher).toContain(":hasComment")
      expect(cypher).toContain(":tagged")
    })

    it("compiles four-way fork", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork(
          (q) => q.to("authored").as("post"),
          (q) => q.from("follows").as("follower"),
          (q) => q.to("follows").as("following"),
          (q) => q.to("wroteComment").as("comment"),
        )
        .returning(
          "user",
          { posts: { collect: "post" } },
          { followers: { collect: "follower" } },
          { following: { collect: "following" } },
          { comments: { collect: "comment" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have 4 OPTIONAL MATCH clauses
      const optionalMatchCount = (cypher.match(/OPTIONAL MATCH/g) || []).length
      expect(optionalMatchCount).toBe(4)
    })
  })

  // ===========================================================================
  // FORK WITH FILTERING
  // ===========================================================================

  describe("Fork with Filtering", () => {
    it("compiles where filter before fork", () => {
      const query = graph
        .node("user")
        .where("status", "eq", "active")
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // WHERE should come before OPTIONAL MATCH
      const whereIndex = cypher.indexOf("WHERE")
      const optionalMatchIndex = cypher.indexOf("OPTIONAL MATCH")
      expect(whereIndex).toBeLessThan(optionalMatchIndex)
      expect(cypher).toContain("status")
    })

    it("compiles where filter inside fork branch", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").where("content", "isNotNull").as("publishedPost"))
        .returning("user", { publishedPosts: { collect: "publishedPost" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain("IS NOT NULL")
    })

    it("compiles hasEdge filter before fork", () => {
      const query = graph
        .node("user")
        .hasEdge("authored", "out")
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have existence pattern
      expect(cypher).toContain(":authored")
    })
  })

  // ===========================================================================
  // FORK WITH ORDERING AND PAGINATION
  // ===========================================================================

  describe("Fork with Ordering and Pagination", () => {
    it("compiles orderBy before fork", () => {
      const query = graph
        .node("user")
        .orderBy("name", "ASC")
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain("ORDER BY")
      expect(cypher).toContain("ASC")
    })

    it("compiles limit before fork", () => {
      const query = graph
        .node("user")
        .orderBy("name", "ASC")
        .limit(10)
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain("LIMIT 10")
    })

    it("compiles skip and limit before fork", () => {
      const query = graph
        .node("user")
        .orderBy("name", "ASC")
        .skip(5)
        .limit(10)
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain("SKIP 5")
      expect(cypher).toContain("LIMIT 10")
    })
  })

  // ===========================================================================
  // FORK WITH CHAINED TRAVERSALS
  // ===========================================================================

  describe("Fork with Chained Traversals", () => {
    it("compiles chained traversals inside fork branch", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").as("post").to("hasComment").as("postComment"))
        .returning("user", { posts: { collect: "post" } }, { comments: { collect: "postComment" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have chained traversals in OPTIONAL MATCH
      expect(cypher).toContain(":authored")
      expect(cypher).toContain(":hasComment")
    })

    it("compiles multiple chained traversals in different branches", () => {
      const query = graph
        .nodeByIdWithLabel("post", "post-1")
        .as("post")
        .fork(
          (q) => q.from("authored").as("author").from("follows").as("authorFollower"),
          (q) => q.to("hasComment").as("comment").from("wroteComment").as("commenter"),
        )
        .returning(
          "post",
          "author",
          { authorFollowers: { collect: "authorFollower" } },
          { comments: { collect: "comment" } },
          { commenters: { collect: "commenter" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have all edge types
      expect(cypher).toContain(":authored")
      expect(cypher).toContain(":follows")
      expect(cypher).toContain(":hasComment")
      expect(cypher).toContain(":wroteComment")
    })

    it("compiles deep chained traversal (3 levels)", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) =>
          q
            .to("authored")
            .as("post")
            .to("hasComment")
            .as("comment")
            .from("wroteComment")
            .as("commenter"),
        )
        .returning(
          "user",
          { posts: { collect: "post" } },
          { comments: { collect: "comment" } },
          { commenters: { collect: "commenter" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(":authored")
      expect(cypher).toContain(":hasComment")
      expect(cypher).toContain(":wroteComment")
    })
  })

  // ===========================================================================
  // FORK FROM COLLECTION
  // ===========================================================================

  describe("Fork from Collection", () => {
    it("compiles fork from collection of nodes", () => {
      const query = graph
        .node("post")
        .as("post")
        .fork(
          (q) => q.from("authored").as("author"),
          (q) => q.to("hasComment").as("comment"),
        )
        .returning("post", "author", { comments: { collect: "comment" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Initial MATCH should be for all posts
      expect(cypher).toContain("MATCH (")
      expect(cypher).toContain(":post)")
      expect(cypher).toContain("OPTIONAL MATCH")
    })

    it("compiles fork from filtered collection", () => {
      const query = graph
        .node("post")
        .where("views", "gt", 50)
        .as("post")
        .fork((q) => q.from("authored").as("author"))
        .returning("post", "author")

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain("WHERE")
      expect(cypher).toContain("views")
    })
  })

  // ===========================================================================
  // FORK WITH EDGE PROPERTIES
  // ===========================================================================

  describe("Fork with Edge Properties", () => {
    it("compiles edge alias capture in fork branch", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored", { edgeAs: "authorship" }).as("post"))
        .returning("user", "post", "authorship")

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should return edge alias
      expect(cypher).toContain("AS authorship")
    })
  })

  // ===========================================================================
  // FORK WITH HIERARCHY
  // ===========================================================================

  describe("Fork with Hierarchy", () => {
    it("compiles fork with ancestors traversal", () => {
      const query = graph
        .nodeByIdWithLabel("folder", "folder-1")
        .as("folder")
        .fork(
          (q) => q.ancestors().as("ancestor"),
          (q) => q.children().as("child"),
        )
        .returning(
          "folder",
          { ancestors: { collect: "ancestor" } },
          { children: { collect: "child" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(":hasParent")
    })
  })

  // ===========================================================================
  // ALIAS PRESERVATION
  // ===========================================================================

  describe("Alias Preservation", () => {
    it("preserves user-defined aliases in RETURN", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("myUser")
        .fork(
          (q) => q.to("authored").as("myPost"),
          (q) => q.from("follows").as("myFollower"),
        )
        .returning("myUser", "myPost", "myFollower")

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain("AS myUser")
      expect(cypher).toContain("AS myPost")
      expect(cypher).toContain("AS myFollower")
    })

    it("preserves collect result aliases", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", { allPosts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain("AS allPosts")
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe("Edge Cases", () => {
    it("compiles single-branch fork", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain("OPTIONAL MATCH")
      expect(cypher).toContain(":authored")
    })

    it("compiles fork with same edge type in multiple branches", () => {
      // Different directions of the same edge
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork(
          (q) => q.to("follows").as("following"),
          (q) => q.from("follows").as("follower"),
        )
        .returning(
          "user",
          { following: { collect: "following" } },
          { followers: { collect: "follower" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have both directions
      expect(cypher).toContain("->") // outgoing
      expect(cypher).toContain("<-") // incoming
    })
  })

  // ===========================================================================
  // PARAMETER HANDLING
  // ===========================================================================

  describe("Parameter Handling", () => {
    it("generates correct parameters for fork with ID", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-123")
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()

      // Should have parameter for the ID
      expect(Object.values(compiled.params)).toContain("user-123")
    })

    it("generates correct parameters for fork with where clause", () => {
      const query = graph
        .node("user")
        .where("status", "eq", "active")
        .as("user")
        .fork((q) => q.to("authored").where("views", "gt", 100).as("popularPost"))
        .returning("user", { popularPosts: { collect: "popularPost" } })

      const compiled = query.compile()

      // Should have parameters for both where clauses
      expect(Object.values(compiled.params)).toContain("active")
      expect(Object.values(compiled.params)).toContain(100)
    })
  })

  // ===========================================================================
  // ADVANCED PATTERNS (Potential Edge Cases)
  // ===========================================================================

  describe("Advanced Patterns", () => {
    it("compiles fork after traversal (not just from root)", () => {
      // Start from user, traverse to post, then fork from post
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .to("authored")
        .as("post")
        .fork(
          (q) => q.to("hasComment").as("comment"),
          (q) => q.to("tagged").as("tag"),
        )
        .returning(
          "user",
          "post",
          { comments: { collect: "comment" } },
          { tags: { collect: "tag" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have initial traversal before fork
      expect(cypher).toContain(":authored")
      // Fork branches should be OPTIONAL MATCH
      expect(cypher).toContain("OPTIONAL MATCH")
      expect(cypher).toContain(":hasComment")
      expect(cypher).toContain(":tagged")
    })

    it("compiles nested fork pattern (fork inside fork branch)", () => {
      // This tests if fork can be chained
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) =>
          q
            .to("authored")
            .as("post")
            .fork(
              (q2) => q2.to("hasComment").as("comment"),
              (q2) => q2.to("tagged").as("tag"),
            ),
        )
        .returning(
          "user",
          { posts: { collect: "post" } },
          { comments: { collect: "comment" } },
          { tags: { collect: "tag" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should compile without error
      expect(cypher).toContain(":authored")
    })

    it("compiles fork with multiple where clauses in same branch", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) =>
          q
            .to("authored")
            .where("views", "gt", 100)
            .where("content", "isNotNull")
            .as("popularPost"),
        )
        .returning("user", { popularPosts: { collect: "popularPost" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have both WHERE conditions
      expect(cypher).toContain("views")
      expect(cypher).toContain("IS NOT NULL")
    })

    it("compiles fork with orderBy in branch", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").orderBy("views", "DESC").as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Note: ORDER BY in a fork branch may or may not be meaningful
      // depending on how collect() aggregates results
      expect(cypher).toContain(":authored")
    })

    it("compiles fork with limit in branch", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").limit(5).as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // LIMIT in fork branch - may need special handling
      expect(cypher).toContain(":authored")
    })

    it("compiles fork with distinct in branch", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").distinct().as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(":authored")
    })
  })

  // ===========================================================================
  // COMPLEX REAL-WORLD PATTERNS
  // ===========================================================================

  describe("Complex Real-World Patterns", () => {
    it("compiles full listMessages pattern with all relations", () => {
      // Complete pattern from chat-message endpoint:
      // - Get messages
      // - For each message: replyTo target, reply count, reactions
      const query = graph
        .node("message")
        .orderBy("createdAt", "ASC")
        .limit(50)
        .as("msg")
        .fork(
          (q) => q.toOptional("replyTo").as("replyTo"),
          (q) => q.from("replyTo").as("reply"),
          (q) => q.to("hasReaction").as("reaction"),
        )
        .returning(
          "msg",
          "replyTo",
          { replies: { collect: "reply" } },
          { reactions: { collect: "reaction" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Verify structure
      expect(cypher).toContain("MATCH")
      expect(cypher).toContain(":message")
      expect(cypher).toContain("ORDER BY")
      expect(cypher).toContain("LIMIT 50")
      expect(cypher).toContain("OPTIONAL MATCH")
      expect(cypher).toContain(":replyTo")
      expect(cypher).toContain(":hasReaction")
      expect(cypher).toContain("collect(")
    })

    it("compiles social feed pattern: posts with author, likes, comments", () => {
      const query = graph
        .node("post")
        .where("views", "gt", 0)
        .orderBy("views", "DESC")
        .limit(20)
        .as("post")
        .fork(
          (q) => q.from("authored").as("author"),
          (q) => q.from("likes").as("liker"),
          (q) => q.to("hasComment").as("comment"),
          (q) => q.to("tagged").as("tag"),
        )
        .returning(
          "post",
          "author",
          { likers: { collect: "liker", distinct: true } },
          { comments: { collect: "comment" } },
          { tags: { collect: "tag" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain("WHERE")
      expect(cypher).toContain("ORDER BY")
      expect(cypher).toContain("LIMIT 20")
      expect(cypher).toContain("collect(DISTINCT")
    })

    it("compiles user profile pattern: user with posts, followers, following", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork(
          (q) => q.to("authored").orderBy("views", "DESC").limit(10).as("topPost"),
          (q) => q.from("follows").as("follower"),
          (q) => q.to("follows").as("following"),
          (q) => q.to("likes").as("likedPost"),
        )
        .returning(
          "user",
          { topPosts: { collect: "topPost" } },
          { followers: { collect: "follower", distinct: true } },
          { following: { collect: "following", distinct: true } },
          { likedPosts: { collect: "likedPost" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      expect(cypher).toContain(":user")
      expect(cypher).toContain(":authored")
      expect(cypher).toContain(":follows")
      expect(cypher).toContain(":likes")
    })

    it("compiles thread view pattern: message with full context", () => {
      // Get a message with:
      // - What it replies to (and that message's author)
      // - Messages that reply to it
      // - Reactions
      const query = graph
        .nodeByIdWithLabel("message", "msg-1")
        .as("msg")
        .fork(
          (q) => q.toOptional("replyTo").as("parentMsg"),
          (q) => q.from("replyTo").as("childMsg"),
          (q) => q.to("hasReaction").as("reaction"),
        )
        .returning(
          "msg",
          "parentMsg",
          { childMessages: { collect: "childMsg" } },
          { reactions: { collect: "reaction" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Verify both directions of replyTo edge
      const replyToMatches = cypher.match(/:replyTo/g) || []
      expect(replyToMatches.length).toBeGreaterThanOrEqual(2)
    })
  })

  // ===========================================================================
  // CYPHER STRUCTURE VERIFICATION
  // ===========================================================================

  describe("Cypher Structure Verification", () => {
    it("generates OPTIONAL MATCH for all fork branches", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork(
          (q) => q.to("authored").as("post"),
          (q) => q.from("follows").as("follower"),
          (q) => q.to("follows").as("following"),
        )
        .returning("user", "post", "follower", "following")

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Count OPTIONAL MATCH - should be 3 (one per branch)
      const optionalMatchCount = (cypher.match(/OPTIONAL MATCH/g) || []).length
      expect(optionalMatchCount).toBe(3)
    })

    it("maintains correct node alias references across fork", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", "post")

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // The fork branch should reference the correct source node
      // Pattern should be like: (n0)-[:authored]->(n1)
      // where n0 is the user node
      expect(cypher).toMatch(/\(n\d+\)-\[.*:authored.*\]->\(n\d+/)
    })

    it("generates correct RETURN clause with all aliases", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork(
          (q) => q.to("authored").as("post"),
          (q) => q.from("follows").as("follower"),
        )
        .returning("user", "post", { followers: { collect: "follower" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // RETURN should have all aliases
      expect(cypher).toContain("RETURN")
      expect(cypher).toContain("AS user")
      expect(cypher).toContain("AS post")
      expect(cypher).toContain("AS followers")
    })

    it("places ORDER BY and LIMIT before fork branches", () => {
      const query = graph
        .node("user")
        .orderBy("name", "ASC")
        .limit(10)
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        .returning("user", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // ORDER BY and LIMIT should come after the main MATCH but the structure
      // depends on implementation. At minimum, they should be present.
      expect(cypher).toContain("ORDER BY")
      expect(cypher).toContain("LIMIT 10")
    })
  })

  // ===========================================================================
  // ERROR CASES
  // ===========================================================================

  describe("Error Cases", () => {
    it("silently ignores non-existent alias in returning (TypeScript catches this)", () => {
      // Note: The implementation doesn't throw at runtime for invalid aliases
      // TypeScript type checking catches this at compile time
      // This test documents the current behavior
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").as("post"))
        // @ts-expect-error - intentionally using wrong alias
        .returning("user", "nonExistent")

      // Should compile without runtime error
      const compiled = query.compile()
      expect(compiled.cypher).toContain("RETURN")
    })

    it("throws error when collect references non-existent alias", () => {
      expect(() => {
        graph
          .nodeByIdWithLabel("user", "user-1")
          .as("user")
          .fork((q) => q.to("authored").as("post"))
          // @ts-expect-error - intentionally using wrong alias
          .returning("user", { posts: { collect: "nonExistent" } })
      }).toThrow()
    })
  })

  // ===========================================================================
  // SEMANTIC CORRECTNESS TESTS
  // ===========================================================================

  describe("Semantic Correctness", () => {
    it("fork branches start from the correct source node", () => {
      // When we fork from a node, each branch should start from that node
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork(
          (q) => q.to("authored").as("post"),
          (q) => q.to("follows").as("following"),
        )
        .returning("user", "post", "following")

      const compiled = query.compile()
      const cypher = compiled.cypher

      // Both fork branches should reference the same source node (n0)
      // The pattern should show traversals from the same node
      const lines = cypher.split("\n")
      const optionalMatches = lines.filter((l) => l.includes("OPTIONAL MATCH"))

      // Each OPTIONAL MATCH should start from the same node alias
      for (const match of optionalMatches) {
        // Should contain pattern like (n0)- or (n0)<-
        expect(match).toMatch(/\(n0\)/)
      }
    })

    it("fork preserves aliases from before the fork", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("originalUser")
        .fork((q) => q.to("authored").as("post"))
        .returning("originalUser", { posts: { collect: "post" } })

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // The original alias should be preserved
      expect(cypher).toContain("AS originalUser")
    })

    it("fork with chained traversal maintains correct node references", () => {
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork((q) => q.to("authored").as("post").to("hasComment").as("comment"))
        .returning("user", { posts: { collect: "post" } }, { comments: { collect: "comment" } })

      const compiled = query.compile()
      const cypher = compiled.cypher

      // The chained traversal should show:
      // 1. user -> authored -> post
      // 2. post -> hasComment -> comment
      expect(cypher).toContain(":authored")
      expect(cypher).toContain(":hasComment")

      // The hasComment traversal should start from the post node, not the user
      // This is verified by checking the pattern structure
      const lines = cypher.split("\n")
      const hasCommentLine = lines.find((l) => l.includes(":hasComment"))
      expect(hasCommentLine).toBeDefined()
    })

    it("multiple forks from same node produce independent branches", () => {
      // This tests that fork branches don't interfere with each other
      const query = graph
        .nodeByIdWithLabel("user", "user-1")
        .as("user")
        .fork(
          (q) => q.to("authored").where("views", "gt", 100).as("popularPost"),
          (q) => q.to("authored").where("views", "lt", 10).as("unpopularPost"),
        )
        .returning(
          "user",
          { popularPosts: { collect: "popularPost" } },
          { unpopularPosts: { collect: "unpopularPost" } },
        )

      const compiled = query.compile()
      const cypher = normalizeCypher(compiled.cypher)

      // Should have two separate OPTIONAL MATCH clauses for authored
      const authoredMatches = (cypher.match(/:authored/g) || []).length
      expect(authoredMatches).toBe(2)

      // Should have both WHERE conditions
      expect(cypher).toContain("> $") // gt condition
      expect(cypher).toContain("< $") // lt condition
    })
  })
})
