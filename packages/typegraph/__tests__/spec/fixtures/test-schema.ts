/**
 * Test Schema Fixture
 *
 * A comprehensive schema used across all specification tests.
 * Covers various edge cardinalities, polymorphic edges, and hierarchy.
 */

import { z } from "zod"

// =============================================================================
// MOCK IMPLEMENTATIONS FOR TESTING
// =============================================================================

/**
 * Minimal node() implementation for testing.
 * The real implementation should match this contract.
 */
export function node<TProps extends z.ZodRawShape>(config: {
  properties: TProps
  indexes?: Array<keyof TProps>
  description?: string
}) {
  return {
    _type: "node" as const,
    properties: z.object(config.properties),
    indexes: config.indexes ?? [],
    description: config.description,
  }
}

/**
 * Minimal edge() implementation for testing.
 */
export function edge<
  TFrom extends string | readonly string[],
  TTo extends string | readonly string[],
  TProps extends z.ZodRawShape = Record<string, never>,
>(config: {
  from: TFrom
  to: TTo
  cardinality: { outbound: "one" | "many" | "optional"; inbound: "one" | "many" | "optional" }
  properties?: TProps
  description?: string
}) {
  return {
    _type: "edge" as const,
    from: config.from,
    to: config.to,
    cardinality: config.cardinality,
    properties: z.object(config.properties ?? ({} as TProps)),
    description: config.description,
  }
}

/**
 * Minimal defineSchema() implementation for testing.
 */
export function defineSchema<
  TNodes extends Record<string, ReturnType<typeof node>>,
  TEdges extends Record<string, ReturnType<typeof edge>>,
>(config: {
  nodes: TNodes
  edges: TEdges
  hierarchy?: { defaultEdge: keyof TEdges & string; direction: "up" | "down" }
  version?: string
}) {
  return config
}

// =============================================================================
// TEST SCHEMA DEFINITION
// =============================================================================

/**
 * Comprehensive test schema covering:
 * - Multiple node types
 * - Various cardinality combinations
 * - Polymorphic edges
 * - Self-referential edges
 * - Hierarchy configuration
 * - Edge properties
 */
export const testSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
        status: z.enum(["active", "inactive", "banned"]),
        createdAt: z.date(),
        score: z.number().optional(),
      },
      indexes: ["email"],
      description: "A user account",
    }),

    post: node({
      properties: {
        title: z.string(),
        content: z.string(),
        publishedAt: z.date().optional(),
        viewCount: z.number().default(0),
        tags: z.array(z.string()).default([]),
      },
      description: "A blog post",
    }),

    comment: node({
      properties: {
        content: z.string(),
        createdAt: z.date(),
        edited: z.boolean().default(false),
      },
    }),

    category: node({
      properties: {
        name: z.string(),
        slug: z.string(),
        description: z.string().optional(),
      },
      indexes: ["slug"],
    }),

    organization: node({
      properties: {
        name: z.string(),
        domain: z.string(),
      },
    }),

    folder: node({
      properties: {
        name: z.string(),
        color: z.string().optional(),
      },
      description: "A folder in a hierarchical file system",
    }),
  },

  edges: {
    // One-to-many: one user authors many posts, each post has one author
    authored: edge({
      from: "user",
      to: "post",
      cardinality: { outbound: "many", inbound: "one" },
      properties: {
        role: z.enum(["author", "coauthor", "editor"]),
        contributedAt: z.date(),
      },
    }),

    // Many-to-many: users can like many posts, posts can be liked by many users
    likes: edge({
      from: "user",
      to: "post",
      cardinality: { outbound: "many", inbound: "many" },
      properties: {
        likedAt: z.date(),
      },
    }),

    // Self-referential many-to-many: users can follow each other
    follows: edge({
      from: "user",
      to: "user",
      cardinality: { outbound: "many", inbound: "many" },
      properties: {
        since: z.date(),
        notifications: z.boolean().default(true),
      },
    }),

    // One-to-many: one post has many comments
    commentedOn: edge({
      from: "comment",
      to: "post",
      cardinality: { outbound: "one", inbound: "many" },
    }),

    // One-to-one: each comment has exactly one author
    writtenBy: edge({
      from: "comment",
      to: "user",
      cardinality: { outbound: "one", inbound: "many" },
    }),

    // Many-to-many: posts can belong to many categories
    categorizedAs: edge({
      from: "post",
      to: "category",
      cardinality: { outbound: "many", inbound: "many" },
    }),

    // Self-referential hierarchy: category parent-child
    categoryParent: edge({
      from: "category",
      to: "category",
      cardinality: { outbound: "optional", inbound: "many" },
    }),

    // Organization membership
    memberOf: edge({
      from: "user",
      to: "organization",
      cardinality: { outbound: "many", inbound: "many" },
      properties: {
        role: z.enum(["member", "admin", "owner"]),
        joinedAt: z.date(),
      },
    }),

    // Folder hierarchy (default hierarchy edge)
    hasParent: edge({
      from: "folder",
      to: "folder",
      cardinality: { outbound: "optional", inbound: "many" },
      description: "Folder parent-child relationship",
    }),

    // Folder ownership
    owns: edge({
      from: "user",
      to: "folder",
      cardinality: { outbound: "many", inbound: "one" },
    }),
  },

  hierarchy: {
    defaultEdge: "hasParent",
    direction: "up",
  },

  version: "1.0.0",
})

export type TestSchema = typeof testSchema

// =============================================================================
// EXPECTED CYPHER OUTPUT HELPERS
// =============================================================================

/**
 * Normalize Cypher for comparison (removes extra whitespace).
 */
export function normalizeCypher(cypher: string): string {
  return cypher
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\[\s+/g, "[")
    .replace(/\s+\]/g, "]")
    .replace(/{\s+/g, "{")
    .replace(/\s+}/g, "}")
    .replace(/,\s+/g, ", ")
}

/**
 * Compare two Cypher queries, ignoring whitespace differences.
 */
export function cypherEquals(actual: string, expected: string): boolean {
  return normalizeCypher(actual) === normalizeCypher(expected)
}
