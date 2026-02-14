/**
 * Schema Builder Specification Tests
 *
 * These tests define the expected behavior of schema definition functions:
 * - node() - creates node definitions
 * - edge() - creates edge definitions
 * - defineSchema() - creates complete schema definitions
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { node, edge, defineSchema, testSchema } from './fixtures/test-schema'

describe('Schema Builder Specification', () => {
  // ===========================================================================
  // NODE DEFINITION
  // ===========================================================================

  describe('node()', () => {
    it('creates a node definition with properties', () => {
      const userNode = node({
        properties: {
          name: z.string(),
          email: z.string().email(),
        },
      })

      expect(userNode._type).toBe('node')
      expect(userNode.properties).toBeDefined()
      expect(userNode.indexes).toEqual([])
    })

    it('accepts index configuration', () => {
      const userNode = node({
        properties: {
          email: z.string().email(),
          name: z.string(),
        },
        indexes: ['email'],
      })

      expect(userNode.indexes).toContain('email')
    })

    it('accepts description', () => {
      const userNode = node({
        properties: { name: z.string() },
        description: 'A user in the system',
      })

      expect(userNode.description).toBe('A user in the system')
    })

    it('supports optional properties via Zod', () => {
      const userNode = node({
        properties: {
          name: z.string(),
          bio: z.string().optional(),
          age: z.number().nullable().optional(),
        },
      })

      // Properties schema should parse correctly
      const result = userNode.properties.safeParse({
        name: 'John',
        // bio and age are optional/nullable - not required
      })

      expect(result.success).toBe(true)
    })

    it('supports array properties', () => {
      const postNode = node({
        properties: {
          title: z.string(),
          tags: z.array(z.string()),
        },
      })

      const result = postNode.properties.safeParse({
        title: 'Hello',
        tags: ['tech', 'news'],
      })

      expect(result.success).toBe(true)
    })

    it('supports enum properties', () => {
      const userNode = node({
        properties: {
          status: z.enum(['active', 'inactive', 'banned']),
        },
      })

      expect(userNode.properties.safeParse({ status: 'active' }).success).toBe(true)
      expect(userNode.properties.safeParse({ status: 'invalid' }).success).toBe(false)
    })
  })

  // ===========================================================================
  // EDGE DEFINITION
  // ===========================================================================

  describe('edge()', () => {
    it('creates an edge definition with from/to', () => {
      const authoredEdge = edge({
        from: 'user',
        to: 'post',
        cardinality: { outbound: 'many', inbound: 'one' },
      })

      expect(authoredEdge._type).toBe('edge')
      expect(authoredEdge.from).toBe('user')
      expect(authoredEdge.to).toBe('post')
    })

    it('captures cardinality correctly', () => {
      const authoredEdge = edge({
        from: 'user',
        to: 'post',
        cardinality: { outbound: 'many', inbound: 'one' },
      })

      expect(authoredEdge.cardinality.outbound).toBe('many')
      expect(authoredEdge.cardinality.inbound).toBe('one')
    })

    it('supports edge properties', () => {
      const followsEdge = edge({
        from: 'user',
        to: 'user',
        cardinality: { outbound: 'many', inbound: 'many' },
        properties: {
          since: z.date(),
          closeness: z.enum(['close', 'acquaintance']),
        },
      })

      expect(followsEdge.properties).toBeDefined()
      const result = followsEdge.properties.safeParse({
        since: new Date(),
        closeness: 'close',
      })
      expect(result.success).toBe(true)
    })

    it('creates edge with no properties', () => {
      const likesEdge = edge({
        from: 'user',
        to: 'post',
        cardinality: { outbound: 'many', inbound: 'many' },
      })

      // Should have empty properties schema
      const result = likesEdge.properties.safeParse({})
      expect(result.success).toBe(true)
    })

    it('supports self-referential edges', () => {
      const parentEdge = edge({
        from: 'folder',
        to: 'folder',
        cardinality: { outbound: 'optional', inbound: 'many' },
      })

      expect(parentEdge.from).toBe('folder')
      expect(parentEdge.to).toBe('folder')
    })

    it('supports optional outbound cardinality', () => {
      const parentEdge = edge({
        from: 'node',
        to: 'node',
        cardinality: { outbound: 'optional', inbound: 'many' },
      })

      expect(parentEdge.cardinality.outbound).toBe('optional')
    })

    it('accepts description', () => {
      const authoredEdge = edge({
        from: 'user',
        to: 'post',
        cardinality: { outbound: 'many', inbound: 'one' },
        description: 'User authored a post',
      })

      expect(authoredEdge.description).toBe('User authored a post')
    })
  })

  // ===========================================================================
  // SCHEMA DEFINITION
  // ===========================================================================

  describe('defineSchema()', () => {
    it('creates a schema with nodes and edges', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          post: node({ properties: { title: z.string() } }),
        },
        edges: {
          authored: edge({
            from: 'user',
            to: 'post',
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      })

      expect(schema.nodes.user).toBeDefined()
      expect(schema.nodes.post).toBeDefined()
      expect(schema.edges.authored).toBeDefined()
    })

    it('supports hierarchy configuration', () => {
      const schema = defineSchema({
        nodes: {
          folder: node({ properties: { name: z.string() } }),
        },
        edges: {
          hasParent: edge({
            from: 'folder',
            to: 'folder',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
        },
        hierarchy: {
          defaultEdge: 'hasParent',
          direction: 'up',
        },
      })

      expect(schema.hierarchy?.defaultEdge).toBe('hasParent')
      expect(schema.hierarchy?.direction).toBe('up')
    })

    it('supports version', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
        version: '1.0.0',
      })

      expect(schema.version).toBe('1.0.0')
    })
  })

  // ===========================================================================
  // TEST SCHEMA INTEGRITY
  // ===========================================================================

  describe('Test Schema Fixture', () => {
    it('has all expected node types', () => {
      expect(testSchema.nodes.user).toBeDefined()
      expect(testSchema.nodes.post).toBeDefined()
      expect(testSchema.nodes.comment).toBeDefined()
      expect(testSchema.nodes.category).toBeDefined()
      expect(testSchema.nodes.organization).toBeDefined()
      expect(testSchema.nodes.folder).toBeDefined()
    })

    it('has all expected edge types', () => {
      expect(testSchema.edges.authored).toBeDefined()
      expect(testSchema.edges.likes).toBeDefined()
      expect(testSchema.edges.follows).toBeDefined()
      expect(testSchema.edges.commentedOn).toBeDefined()
      expect(testSchema.edges.writtenBy).toBeDefined()
      expect(testSchema.edges.categorizedAs).toBeDefined()
      expect(testSchema.edges.categoryParent).toBeDefined()
      expect(testSchema.edges.memberOf).toBeDefined()
      expect(testSchema.edges.hasParent).toBeDefined()
      expect(testSchema.edges.owns).toBeDefined()
    })

    it('has hierarchy configuration', () => {
      expect(testSchema.hierarchy).toBeDefined()
      expect(testSchema.hierarchy?.defaultEdge).toBe('hasParent')
      expect(testSchema.hierarchy?.direction).toBe('up')
    })

    it('user node validates correctly', () => {
      const validUser = {
        email: 'john@example.com',
        name: 'John Doe',
        status: 'active',
        createdAt: new Date(),
      }

      const result = testSchema.nodes.user.properties.safeParse(validUser)
      expect(result.success).toBe(true)
    })

    it('user node rejects invalid data', () => {
      const invalidUser = {
        email: 'not-an-email',
        name: 'John',
        status: 'invalid-status',
        createdAt: 'not-a-date',
      }

      const result = testSchema.nodes.user.properties.safeParse(invalidUser)
      expect(result.success).toBe(false)
    })

    it('authored edge has correct cardinality', () => {
      // One user can author many posts (outbound: many)
      // One post has one author (inbound: one)
      expect(testSchema.edges.authored.cardinality.outbound).toBe('many')
      expect(testSchema.edges.authored.cardinality.inbound).toBe('one')
    })

    it('follows edge is self-referential', () => {
      expect(testSchema.edges.follows.from).toBe('user')
      expect(testSchema.edges.follows.to).toBe('user')
    })

    it('hasParent edge has optional outbound', () => {
      // A folder can have 0 or 1 parent
      expect(testSchema.edges.hasParent.cardinality.outbound).toBe('optional')
      // A folder can have many children
      expect(testSchema.edges.hasParent.cardinality.inbound).toBe('many')
    })
  })
})
