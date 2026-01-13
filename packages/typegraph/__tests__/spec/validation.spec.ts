/**
 * Query Validation Specification Tests
 *
 * Tests for schema-based query validation.
 */

import { describe, it, expect } from "vitest"
import { z } from "zod"
import { defineSchema, node, edge } from "../../src/schema/builders"
import { SchemaValidator, QueryValidationError, createValidator } from "../../src/query/validation"

// =============================================================================
// TEST SCHEMA
// =============================================================================

const testSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
        age: z.number().optional(),
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
    hasParent: edge({
      from: "post",
      to: "post",
      cardinality: { outbound: "optional", inbound: "many" },
    }),
  },
  hierarchy: {
    defaultEdge: "hasParent",
    direction: "up",
  },
})

// =============================================================================
// TESTS
// =============================================================================

describe("Query Validation", () => {
  const validator = createValidator(testSchema)

  describe("Node Label Validation", () => {
    it("accepts valid node labels", () => {
      expect(() => validator.validateNodeLabel("user")).not.toThrow()
      expect(() => validator.validateNodeLabel("post")).not.toThrow()
      expect(() => validator.validateNodeLabel("comment")).not.toThrow()
    })

    it("rejects invalid node labels", () => {
      expect(() => validator.validateNodeLabel("invalid")).toThrow(QueryValidationError)
      expect(() => validator.validateNodeLabel("User")).toThrow(QueryValidationError) // case sensitive
    })

    it("provides helpful error message with valid labels", () => {
      try {
        validator.validateNodeLabel("invalid")
      } catch (e) {
        expect(e).toBeInstanceOf(QueryValidationError)
        const error = e as QueryValidationError
        expect(error.code).toBe("INVALID_NODE_LABEL")
        expect(error.message).toContain("user")
        expect(error.message).toContain("post")
        expect(error.message).toContain("comment")
        expect(error.details?.validLabels).toContain("user")
      }
    })
  })

  describe("Edge Type Validation", () => {
    it("accepts valid edge types", () => {
      expect(() => validator.validateEdgeType("authored")).not.toThrow()
      expect(() => validator.validateEdgeType("likes")).not.toThrow()
      expect(() => validator.validateEdgeType("follows")).not.toThrow()
      expect(() => validator.validateEdgeType("hasComment")).not.toThrow()
    })

    it("rejects invalid edge types", () => {
      expect(() => validator.validateEdgeType("invalid")).toThrow(QueryValidationError)
      expect(() => validator.validateEdgeType("Authored")).toThrow(QueryValidationError)
    })

    it("provides helpful error message with valid edge types", () => {
      try {
        validator.validateEdgeType("invalid")
      } catch (e) {
        expect(e).toBeInstanceOf(QueryValidationError)
        const error = e as QueryValidationError
        expect(error.code).toBe("INVALID_EDGE_TYPE")
        expect(error.message).toContain("authored")
        expect(error.details?.validEdges).toContain("authored")
      }
    })
  })

  describe("Node Property Validation", () => {
    it("accepts valid node properties", () => {
      expect(() => validator.validateNodeProperty("user", "email")).not.toThrow()
      expect(() => validator.validateNodeProperty("user", "name")).not.toThrow()
      expect(() => validator.validateNodeProperty("user", "age")).not.toThrow()
      expect(() => validator.validateNodeProperty("user", "id")).not.toThrow() // id is always valid
    })

    it("rejects invalid node properties", () => {
      expect(() => validator.validateNodeProperty("user", "invalid")).toThrow(QueryValidationError)
      expect(() => validator.validateNodeProperty("user", "title")).toThrow(QueryValidationError) // belongs to post
    })

    it("provides helpful error message with valid properties", () => {
      try {
        validator.validateNodeProperty("user", "invalid")
      } catch (e) {
        expect(e).toBeInstanceOf(QueryValidationError)
        const error = e as QueryValidationError
        expect(error.code).toBe("INVALID_PROPERTY")
        expect(error.message).toContain("email")
        expect(error.message).toContain("name")
        expect(error.details?.validProperties).toContain("id")
        expect(error.details?.validProperties).toContain("email")
      }
    })
  })

  describe("Edge Property Validation", () => {
    it("accepts valid edge properties", () => {
      expect(() => validator.validateEdgeProperty("authored", "role")).not.toThrow()
      expect(() => validator.validateEdgeProperty("authored", "id")).not.toThrow()
    })

    it("rejects invalid edge properties", () => {
      expect(() => validator.validateEdgeProperty("authored", "invalid")).toThrow(QueryValidationError)
    })
  })

  describe("Traversal Validation", () => {
    it("accepts valid outbound traversals", () => {
      // user -[authored]-> post
      expect(() => validator.validateTraversal("user", "authored", "out")).not.toThrow()
      // user -[likes]-> post
      expect(() => validator.validateTraversal("user", "likes", "out")).not.toThrow()
      // user -[follows]-> user
      expect(() => validator.validateTraversal("user", "follows", "out")).not.toThrow()
    })

    it("accepts valid inbound traversals", () => {
      // post <-[authored]- user
      expect(() => validator.validateTraversal("post", "authored", "in")).not.toThrow()
      // user <-[follows]- user
      expect(() => validator.validateTraversal("user", "follows", "in")).not.toThrow()
    })

    it("accepts valid bidirectional traversals", () => {
      // user -[follows]- user (self-referential)
      expect(() => validator.validateTraversal("user", "follows", "both")).not.toThrow()
    })

    it("rejects invalid traversals", () => {
      // post cannot traverse authored outbound (it's the target)
      expect(() => validator.validateTraversal("post", "authored", "out")).toThrow(QueryValidationError)
      // user cannot traverse authored inbound (it's the source)
      expect(() => validator.validateTraversal("user", "authored", "in")).toThrow(QueryValidationError)
      // comment has no connection to authored
      expect(() => validator.validateTraversal("comment", "authored", "out")).toThrow(QueryValidationError)
    })

    it("provides helpful error message for invalid traversals", () => {
      try {
        validator.validateTraversal("post", "authored", "out")
      } catch (e) {
        expect(e).toBeInstanceOf(QueryValidationError)
        const error = e as QueryValidationError
        expect(error.code).toBe("INVALID_TRAVERSAL")
        expect(error.message).toContain("user")
        expect(error.message).toContain("post")
        expect(error.details?.edgeFrom).toBe("user")
        expect(error.details?.edgeTo).toBe("post")
      }
    })
  })

  describe("Hierarchy Edge Validation", () => {
    it("accepts valid hierarchy edge", () => {
      expect(() => validator.validateHierarchyEdge("hasParent")).not.toThrow()
    })

    it("uses default hierarchy edge when not specified", () => {
      expect(() => validator.validateHierarchyEdge()).not.toThrow()
    })

    it("rejects invalid hierarchy edge", () => {
      expect(() => validator.validateHierarchyEdge("invalid")).toThrow(QueryValidationError)
    })
  })

  describe("Helper Methods", () => {
    it("getValidNodeLabels returns all node labels", () => {
      const labels = validator.getValidNodeLabels()
      expect(labels).toContain("user")
      expect(labels).toContain("post")
      expect(labels).toContain("comment")
      expect(labels).toHaveLength(3)
    })

    it("getValidEdgeTypes returns all edge types", () => {
      const edges = validator.getValidEdgeTypes()
      expect(edges).toContain("authored")
      expect(edges).toContain("likes")
      expect(edges).toContain("follows")
      expect(edges).toContain("hasComment")
      expect(edges).toContain("hasParent")
      expect(edges).toHaveLength(5)
    })

    it("getNodeProperties returns properties including id", () => {
      const props = validator.getNodeProperties("user")
      expect(props).toContain("id")
      expect(props).toContain("email")
      expect(props).toContain("name")
      expect(props).toContain("age")
    })

    it("getEdgeProperties returns properties including id", () => {
      const props = validator.getEdgeProperties("authored")
      expect(props).toContain("id")
      expect(props).toContain("role")
    })
  })

  describe("Factory Function", () => {
    it("createValidator creates a working validator", () => {
      const v = createValidator(testSchema)
      expect(v).toBeInstanceOf(SchemaValidator)
      expect(() => v.validateNodeLabel("user")).not.toThrow()
    })
  })
})
