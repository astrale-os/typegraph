/**
 * Type-level tests for Infer<S> - Schema Type Extraction DX API
 *
 * Tests the elegant DX for extracting TypeScript types from schema definitions.
 * This is a TDD approach - tests are written first, then implementation follows.
 *
 * The Infer<S> type should provide a single, discoverable namespace for all
 * schema types, making type extraction intuitive and type-safe.
 */
// @ts-nocheck

import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'
import { defineSchema, node, edge } from '../src/schema'
import type { Infer } from '../src/schema/inference'

// =============================================================================
// TEST SCHEMAS
// =============================================================================

/**
 * Schema 1: Basic schema with simple nodes and edges
 */
const basicSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
        age: z.number(),
      },
      indexes: ['email'],
    }),
    post: node({
      properties: {
        title: z.string(),
        content: z.string(),
        views: z.number().default(0), // Has default, so optional in input
      },
    }),
  },
  edges: {
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'one' },
      properties: {
        publishedAt: z.date(),
      },
    }),
    likes: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
  },
})

/**
 * Schema 2: Schema with extends inheritance
 */
const entityNode = node({
  properties: {
    createdAt: z.date(),
    updatedAt: z.date(),
  },
})
const userNode = node({
  properties: {
    email: z.string(),
    name: z.string(),
  },
  extends: [entityNode], // Inherits createdAt and updatedAt
})
const adminNode = node({
  properties: {
    permissions: z.array(z.string()),
    role: z.string().default('admin'), // Optional in input
  },
  extends: [userNode], // Inherits email, name, createdAt, updatedAt
})
const inheritanceSchema = defineSchema({
  nodes: {
    entity: entityNode,
    user: userNode,
    admin: adminNode,
  },
  edges: {
    hasParent: edge({
      from: 'entity',
      to: 'entity',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },
})

/**
 * Schema 3: Polymorphic edges
 */
const polymorphicSchema = defineSchema({
  nodes: {
    user: node({
      properties: { name: z.string() },
    }),
    admin: node({
      properties: { level: z.number() },
    }),
    post: node({
      properties: { title: z.string() },
    }),
    comment: node({
      properties: { text: z.string() },
    }),
  },
  edges: {
    created: edge({
      from: ['user', 'admin'], // Polymorphic source
      to: ['post', 'comment'], // Polymorphic target
      cardinality: { outbound: 'many', inbound: 'one' },
      properties: {
        timestamp: z.date(),
      },
    }),
  },
})

// =============================================================================
// TESTS: Basic Type Extraction
// =============================================================================

describe('Infer<S> - Basic Type Extraction', () => {
  it('should extract node output types', () => {
    type Types = Infer<typeof basicSchema>

    // User node should have all properties including structural ones
    type User = Types['nodes']['user']
    expectTypeOf<User>().toMatchTypeOf<{
      id: string
      kind: 'user'
      email: string
      name: string
      age: number
    }>()

    // Post node
    type Post = Types['nodes']['post']
    expectTypeOf<Post>().toMatchTypeOf<{
      id: string
      kind: 'post'
      title: string
      content: string
      views: number
    }>()
  })

  it('should extract node input types', () => {
    type Types = Infer<typeof basicSchema>

    // User input should only have id (no kind)
    type UserInput = Types['nodesInput']['user']
    expectTypeOf<UserInput>().toMatchTypeOf<{
      id: string
      email: string
      name: string
      age: number
    }>()

    // Post input should have views as optional (has default)
    type PostInput = Types['nodesInput']['post']
    expectTypeOf<PostInput>().toMatchTypeOf<{
      id: string
      title: string
      content: string
      views?: number // Optional because of .default(0)
    }>()
  })

  it('should extract edge output types', () => {
    type Types = Infer<typeof basicSchema>

    // Authored edge with properties
    type Authored = Types['edges']['authored']
    expectTypeOf<Authored>().toMatchTypeOf<{
      id: string
      kind: 'authored'
      publishedAt: Date
    }>()

    // Likes edge without properties
    type Likes = Types['edges']['likes']
    expectTypeOf<Likes>().toMatchTypeOf<{
      id: string
      kind: 'likes'
    }>()
  })

  it('should extract edge input types', () => {
    type Types = Infer<typeof basicSchema>

    type AuthoredInput = Types['edgesInput']['authored']
    expectTypeOf<AuthoredInput>().toMatchTypeOf<{
      id: string
      publishedAt: Date
    }>()

    // Should NOT have kind
    expectTypeOf<AuthoredInput>().not.toMatchTypeOf<{ kind: string }>()
  })

  it('should extract node properties only (no id, no kind)', () => {
    type Types = Infer<typeof basicSchema>

    // User properties - should exclude id and kind
    type UserProps = Types['nodesProps']['user']
    expectTypeOf<UserProps>().toMatchTypeOf<{
      email: string
      name: string
      age: number
    }>()

    // Should NOT have id
    expectTypeOf<UserProps>().not.toMatchTypeOf<{ id: string }>()
    // Should NOT have kind
    expectTypeOf<UserProps>().not.toMatchTypeOf<{ kind: string }>()

    // Post properties
    type PostProps = Types['nodesProps']['post']
    expectTypeOf<PostProps>().toMatchTypeOf<{
      title: string
      content: string
      views: number
    }>()
  })

  it('should extract edge properties only (no id, no kind)', () => {
    type Types = Infer<typeof basicSchema>

    // Authored edge has properties
    type AuthoredProps = Types['edgesProps']['authored']
    expectTypeOf<AuthoredProps>().toMatchTypeOf<{
      publishedAt: Date
    }>()

    // Should NOT have id or kind
    expectTypeOf<AuthoredProps>().not.toMatchTypeOf<{ id: string }>()
    expectTypeOf<AuthoredProps>().not.toMatchTypeOf<{ kind: string }>()

    // Likes edge has no properties
    type LikesProps = Types['edgesProps']['likes']
    expectTypeOf<LikesProps>().toEqualTypeOf<Record<string, never>>()
  })
})

// =============================================================================
// TESTS: Union Types
// =============================================================================

describe('Infer<S> - Union Types', () => {
  it('should provide union of all node types', () => {
    type Types = Infer<typeof basicSchema>

    type NodeUnion = Types['nodeUnion']

    // Should be a union of User | Post
    expectTypeOf<NodeUnion>().toMatchTypeOf<
      | { id: string; kind: 'user'; email: string; name: string; age: number }
      | { id: string; kind: 'post'; title: string; content: string; views: number }
    >()

    // Should accept either user or post
    const user: NodeUnion = {
      id: '1',
      kind: 'user',
      email: 'test@example.com',
      name: 'Test',
      age: 25,
    }
    const post: NodeUnion = { id: '2', kind: 'post', title: 'Test', content: 'Content', views: 0 }

    expectTypeOf(user).toMatchTypeOf<NodeUnion>()
    expectTypeOf(post).toMatchTypeOf<NodeUnion>()
  })

  it('should provide union of all edge types', () => {
    type Types = Infer<typeof basicSchema>

    type EdgeUnion = Types['edgeUnion']

    // Should be a union of Authored | Likes
    expectTypeOf<EdgeUnion>().toMatchTypeOf<
      { id: string; kind: 'authored'; publishedAt: Date } | { id: string; kind: 'likes' }
    >()
  })

  it('should provide union of node label names', () => {
    type Types = Infer<typeof basicSchema>

    type NodeNames = Types['nodeNames']
    expectTypeOf<NodeNames>().toEqualTypeOf<'user' | 'post'>()
  })

  it('should provide union of edge type names', () => {
    type Types = Infer<typeof basicSchema>

    type EdgeNames = Types['edgeNames']
    expectTypeOf<EdgeNames>().toEqualTypeOf<'authored' | 'likes'>()
  })
})

// =============================================================================
// TESTS: Label Inheritance
// =============================================================================

describe('Infer<S> - Label Inheritance', () => {
  it('should include inherited properties in node types', () => {
    type Types = Infer<typeof inheritanceSchema>

    // User inherits from entity
    type User = Types['nodes']['user']
    expectTypeOf<User>().toMatchTypeOf<{
      id: string
      kind: 'user'
      email: string
      name: string
      createdAt: Date
      updatedAt: Date
    }>()
  })

  it('should include transitively inherited properties', () => {
    type Types = Infer<typeof inheritanceSchema>

    // Admin inherits from user which inherits from entity
    type Admin = Types['nodes']['admin']
    expectTypeOf<Admin>().toMatchTypeOf<{
      id: string
      kind: 'admin'
      permissions: string[]
      role: string
      email: string
      name: string
      createdAt: Date
      updatedAt: Date
    }>()
  })

  it('should respect default values in inherited input types', () => {
    type Types = Infer<typeof inheritanceSchema>

    // Admin input should have role as optional (has default)
    type AdminInput = Types['nodesInput']['admin']
    expectTypeOf<AdminInput>().toMatchTypeOf<{
      id: string
      permissions: string[]
      role?: string // Optional because of default
      email: string
      name: string
      createdAt: Date
      updatedAt: Date
    }>()
  })

  it('should include inherited properties in property-only types', () => {
    type Types = Infer<typeof inheritanceSchema>

    // Admin properties should include inherited properties (no id, no kind)
    type AdminProps = Types['nodesProps']['admin']
    expectTypeOf<AdminProps>().toMatchTypeOf<{
      permissions: string[]
      role: string
      email: string
      name: string
      createdAt: Date
      updatedAt: Date
    }>()

    // Should NOT have id or kind
    expectTypeOf<AdminProps>().not.toMatchTypeOf<{ id: string }>()
    expectTypeOf<AdminProps>().not.toMatchTypeOf<{ kind: string }>()
  })
})

// =============================================================================
// TESTS: Polymorphic Edges
// =============================================================================

describe('Infer<S> - Polymorphic Edges', () => {
  it('should extract types from schemas with polymorphic edges', () => {
    type Types = Infer<typeof polymorphicSchema>

    // Should work normally for nodes
    type User = Types['nodes']['user']
    expectTypeOf<User>().toMatchTypeOf<{
      id: string
      kind: 'user'
      name: string
    }>()

    type Admin = Types['nodes']['admin']
    expectTypeOf<Admin>().toMatchTypeOf<{
      id: string
      kind: 'admin'
      level: number
    }>()

    // Edge types should work
    type Created = Types['edges']['created']
    expectTypeOf<Created>().toMatchTypeOf<{
      id: string
      kind: 'created'
      timestamp: Date
    }>()
  })

  it('should provide correct union types with polymorphic edges', () => {
    type Types = Infer<typeof polymorphicSchema>

    type NodeUnion = Types['nodeUnion']
    expectTypeOf<NodeUnion>().toMatchTypeOf<
      | { id: string; kind: 'user'; name: string }
      | { id: string; kind: 'admin'; level: number }
      | { id: string; kind: 'post'; title: string }
      | { id: string; kind: 'comment'; text: string }
    >()
  })
})

// =============================================================================
// TESTS: Type Safety & Autocomplete
// =============================================================================

describe('Infer<S> - Type Safety', () => {
  it('should provide autocomplete for node names', () => {
    type Types = Infer<typeof basicSchema>

    // This should type-check if node keys are correctly typed
    type UserKey = 'user' extends keyof Types['nodes'] ? true : false
    type PostKey = 'post' extends keyof Types['nodes'] ? true : false
    type InvalidKey = 'invalid' extends keyof Types['nodes'] ? true : false

    expectTypeOf<UserKey>().toEqualTypeOf<true>()
    expectTypeOf<PostKey>().toEqualTypeOf<true>()
    expectTypeOf<InvalidKey>().toEqualTypeOf<false>()
  })

  it('should provide autocomplete for edge names', () => {
    type Types = Infer<typeof basicSchema>

    type AuthoredKey = 'authored' extends keyof Types['edges'] ? true : false
    type LikesKey = 'likes' extends keyof Types['edges'] ? true : false
    type InvalidKey = 'invalid' extends keyof Types['edges'] ? true : false

    expectTypeOf<AuthoredKey>().toEqualTypeOf<true>()
    expectTypeOf<LikesKey>().toEqualTypeOf<true>()
    expectTypeOf<InvalidKey>().toEqualTypeOf<false>()
  })

  it('should narrow kind types correctly', () => {
    type Types = Infer<typeof basicSchema>

    type User = Types['nodes']['user']
    type Post = Types['nodes']['post']

    // kind should be literal type, not string
    expectTypeOf<User['kind']>().toEqualTypeOf<'user'>()
    expectTypeOf<Post['kind']>().toEqualTypeOf<'post'>()
  })
})

// =============================================================================
// TESTS: Empty Schemas & Edge Cases
// =============================================================================

describe('Infer<S> - Edge Cases', () => {
  it('should handle schemas with only nodes (no edges)', () => {
    const noEdgesSchema = defineSchema({
      nodes: {
        user: node({
          properties: {
            name: z.string(),
          },
        }),
      },
      edges: {},
    })

    type Types = Infer<typeof noEdgesSchema>

    type User = Types['nodes']['user']
    expectTypeOf<User>().toMatchTypeOf<{
      id: string
      kind: 'user'
      name: string
    }>()

    // Edges should be empty object
    type Edges = Types['edges']
    expectTypeOf<Edges>().toEqualTypeOf<Record<string, never>>()

    // Edge union should be never
    type EdgeUnion = Types['edgeUnion']
    expectTypeOf<EdgeUnion>().toEqualTypeOf<never>()

    // Edge names should be never
    type EdgeNames = Types['edgeNames']
    expectTypeOf<EdgeNames>().toEqualTypeOf<never>()
  })

  it('should handle nodes with no user properties', () => {
    const emptyNodeSchema = defineSchema({
      nodes: {
        marker: node({
          properties: {},
        }),
      },
      edges: {},
    })

    type Types = Infer<typeof emptyNodeSchema>

    type Marker = Types['nodes']['marker']
    expectTypeOf<Marker>().toMatchTypeOf<{
      id: string
      kind: 'marker'
    }>()

    // Properties should be empty object
    type MarkerProps = Types['nodesProps']['marker']
    expectTypeOf<MarkerProps>().toEqualTypeOf<Record<string, never>>()
  })

  it('should handle edges with no user properties', () => {
    const emptyEdgeSchema = defineSchema({
      nodes: {
        user: node({ properties: { name: z.string() } }),
      },
      edges: {
        follows: edge({
          from: 'user',
          to: 'user',
          cardinality: { outbound: 'many', inbound: 'many' },
        }),
      },
    })

    type Types = Infer<typeof emptyEdgeSchema>

    type Follows = Types['edges']['follows']
    expectTypeOf<Follows>().toMatchTypeOf<{
      id: string
      kind: 'follows'
    }>()

    // Properties should be empty object
    type FollowsProps = Types['edgesProps']['follows']
    expectTypeOf<FollowsProps>().toEqualTypeOf<Record<string, never>>()
  })
})

// =============================================================================
// TESTS: Real-World Usage Patterns
// =============================================================================

describe('Infer<S> - Real-World Usage', () => {
  it('should work in function signatures', () => {
    type Types = Infer<typeof basicSchema>

    // Function that accepts a user
    function createUser(user: Types['nodesInput']['user']): Types['nodes']['user'] {
      return { ...user, kind: 'user' }
    }

    // Should type-check
    const input: Types['nodesInput']['user'] = {
      id: '1',
      email: 'test@example.com',
      name: 'Test',
      age: 25,
    }
    const output = createUser(input)
    expectTypeOf(output).toMatchTypeOf<Types['nodes']['user']>()
  })

  it('should work with discriminated unions', () => {
    type Types = Infer<typeof basicSchema>

    type Node = Types['nodeUnion']

    function handleNode(node: Node) {
      if (node.kind === 'user') {
        // TypeScript should narrow to user
        expectTypeOf(node.email).toBeString()
      } else {
        // Should narrow to post
        expectTypeOf(node.title).toBeString()
      }
    }
  })

  it('should work with mapped types', () => {
    type Types = Infer<typeof basicSchema>

    // Create a record of all node types by their kind
    type NodesByKind = {
      [K in Types['nodeNames']]: Types['nodes'][K]
    }

    type Result = NodesByKind['user']
    expectTypeOf<Result>().toMatchTypeOf<Types['nodes']['user']>()
  })
})
