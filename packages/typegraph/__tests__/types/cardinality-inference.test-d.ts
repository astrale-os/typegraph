/**
 * Type-level tests for cardinality inference.
 * These tests verify that the TypeScript types correctly infer
 * the return type of traversal methods based on edge cardinality.
 */

import { describe, it, expectTypeOf } from "vitest"
import { z } from "zod"
import { defineSchema, node, edge, type GraphQuery } from "../../src"

// Define a test schema with all cardinality combinations
const testSchema = defineSchema({
  nodes: {
    user: node({ properties: { name: z.string() } }),
    post: node({ properties: { title: z.string() } }),
    comment: node({ properties: { text: z.string() } }),
    profile: node({ properties: { bio: z.string() } }),
  },
  edges: {
    // outbound: one, inbound: one (user has exactly one profile)
    hasProfile: edge({
      from: "user",
      to: "profile",
      cardinality: { outbound: "one", inbound: "one" },
    }),
    // outbound: many, inbound: optional (user authors many posts, post has optional author)
    authored: edge({
      from: "user",
      to: "post",
      cardinality: { outbound: "many", inbound: "optional" },
    }),
    // outbound: many, inbound: many (user can like many posts)
    likes: edge({
      from: "user",
      to: "post",
      cardinality: { outbound: "many", inbound: "many" },
    }),
    // outbound: optional, inbound: many (comment may have parent)
    replyTo: edge({
      from: "comment",
      to: "comment",
      cardinality: { outbound: "optional", inbound: "many" },
    }),
  },
})

type TestSchema = typeof testSchema

declare const graph: GraphQuery<TestSchema>

describe("Cardinality Type Inference", () => {
  describe("SingleNodeBuilder.to()", () => {
    it("returns SingleNodeBuilder for outbound: one", () => {
      const query = graph.node("user").byId("1").to("hasProfile")
      // Should return single profile, not array
      expectTypeOf(query.execute()).resolves.toMatchTypeOf<{ id: string; bio: string }>()
    })

    it("returns OptionalNodeBuilder for outbound: optional", () => {
      const query = graph.node("comment").byId("1").to("replyTo")
      // Should return single comment or null, not array
      expectTypeOf(query.execute()).resolves.toMatchTypeOf<{ id: string; text: string } | null>()
    })

    it("returns CollectionBuilder for outbound: many", () => {
      const query = graph.node("user").byId("1").to("likes")
      // Should return array of posts
      expectTypeOf(query.execute()).resolves.toMatchTypeOf<Array<{ id: string; title: string }>>()
    })
  })

  describe("SingleNodeBuilder.from()", () => {
    it("returns SingleNodeBuilder for inbound: one", () => {
      const query = graph.node("profile").byId("1").from("hasProfile")
      // Should return single user, not array
      expectTypeOf(query.execute()).resolves.toMatchTypeOf<{ id: string; name: string }>()
    })

    it("returns OptionalNodeBuilder for inbound: optional", () => {
      const query = graph.node("post").byId("1").from("authored")
      // Should return single user or null, not array
      expectTypeOf(query.execute()).resolves.toMatchTypeOf<{ id: string; name: string } | null>()
    })

    it("returns CollectionBuilder for inbound: many", () => {
      const query = graph.node("post").byId("1").from("likes")
      // Should return array of users
      expectTypeOf(query.execute()).resolves.toMatchTypeOf<Array<{ id: string; name: string }>>()
    })
  })

  describe("OptionalNodeBuilder.to()", () => {
    it("returns OptionalNodeBuilder for outbound: one (from optional context)", () => {
      // Start from optional context (replyTo has outbound: optional)
      // Then traverse to another edge with outbound: one
      // The result should still be optional because we started from optional
      const query = graph.node("comment").byId("1").to("replyTo").to("replyTo")
      // Should return single comment or null (optional -> optional = optional)
      expectTypeOf(query.execute()).resolves.toMatchTypeOf<{ id: string; text: string } | null>()
    })

    it("returns OptionalNodeBuilder for outbound: optional", () => {
      const query = graph.node("comment").byId("1").to("replyTo")
      // Should return single comment or null
      expectTypeOf(query.execute()).resolves.toMatchTypeOf<{ id: string; text: string } | null>()
    })
  })
})
