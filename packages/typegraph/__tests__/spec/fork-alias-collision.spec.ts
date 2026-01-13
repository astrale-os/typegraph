/**
 * Fork Alias Collision Regression Tests
 *
 * These tests verify the fix for a bug where fork branches would use
 * the same alias counter, causing alias collisions.
 *
 * The bug: When two branches each create a traversal, they would both get
 * the same internal alias (e.g., "n1"), causing the second branch's
 * userAlias mapping to overwrite the first branch's mapping.
 *
 * The fix: Each branch now gets an offset alias counter (10 per branch)
 * to ensure unique aliases across all branches.
 */

import { describe, it, expect } from "vitest"
import { defineSchema, node, edge, createGraph } from "../../src"
import { z } from "zod"

const testSchema = defineSchema({
  nodes: {
    message: node({
      properties: {
        content: z.string(),
      },
    }),
    reaction: node({
      properties: {
        emoji: z.string(),
      },
    }),
  },
  edges: {
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
  },
})

describe("Fork Alias Collision Regression", () => {
  const graph = createGraph(testSchema, { uri: "bolt://localhost:7687" })

  it("should assign unique internal aliases to each fork branch", () => {
    const query = graph
      .nodeByIdWithLabel("message", "msg-1")
      .as("msg")
      .fork(
        (q) => q.toOptional("replyTo").as("replyTo"),
        (q) => q.to("hasReaction").as("reaction"),
      )
      .returning("msg", "replyTo", { reactions: { collect: "reaction" } })

    const ast = (query as any)._ast
    const replyToInternal = ast.resolveUserAlias("replyTo")
    const reactionInternal = ast.resolveUserAlias("reaction")

    // Each branch should have a unique internal alias
    expect(replyToInternal).not.toBe(reactionInternal)
  })

  it("should have unique toAlias in each branch's traversal step", () => {
    const query = graph
      .nodeByIdWithLabel("message", "msg-1")
      .as("msg")
      .fork(
        (q) => q.toOptional("replyTo").as("replyTo"),
        (q) => q.to("hasReaction").as("reaction"),
      )
      .returning("msg", "replyTo", { reactions: { collect: "reaction" } })

    const ast = (query as any)._ast
    const forkStep = ast.steps.find((s: any) => s.type === "fork")
    expect(forkStep).toBeDefined()

    const branch1Traversal = forkStep.branches[0].steps.find((s: any) => s.type === "traversal")
    const branch2Traversal = forkStep.branches[1].steps.find((s: any) => s.type === "traversal")

    // Each branch should have a unique toAlias
    expect(branch1Traversal?.toAlias).not.toBe(branch2Traversal?.toAlias)
  })

  it("should have unique userAliases mappings in each branch", () => {
    const query = graph
      .nodeByIdWithLabel("message", "msg-1")
      .as("msg")
      .fork(
        (q) => q.toOptional("replyTo").as("replyTo"),
        (q) => q.to("hasReaction").as("reaction"),
      )
      .returning("msg", "replyTo", { reactions: { collect: "reaction" } })

    const ast = (query as any)._ast
    const forkStep = ast.steps.find((s: any) => s.type === "fork")
    expect(forkStep).toBeDefined()

    const branch1UserAliases = forkStep.branches[0].userAliases
    const branch2UserAliases = forkStep.branches[1].userAliases

    const replyToInternal = branch1UserAliases["replyTo"]
    const reactionInternal = branch2UserAliases["reaction"]

    // Each branch should map to a unique internal alias
    expect(replyToInternal).not.toBe(reactionInternal)
  })

  it("should use offset alias counters for branches", () => {
    const query = graph.nodeByIdWithLabel("message", "msg-1").as("msg")
    const astBeforeFork = (query as any)._ast
    const counterBeforeFork = astBeforeFork._aliasCounter

    const forkedQuery = query.fork(
      (q) => q.toOptional("replyTo").as("replyTo"),
      (q) => q.to("hasReaction").as("reaction"),
    )

    const astAfterFork = (forkedQuery as any)._ast
    const counterAfterFork = astAfterFork._aliasCounter

    // The counter should be at least counterBeforeFork + 10 (offset for branch 1)
    expect(counterAfterFork).toBeGreaterThan(counterBeforeFork + 10)
  })
})
