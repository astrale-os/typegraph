/**
 * Schema Serializer Tests
 *
 * Tests for toSchema() which converts schemas to JSON-serializable format.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { defineSchema, node, edge, toSchema } from '../src/schema'

describe('toSchema Serializer', () => {
  describe('Basic Serialization', () => {
    it('should serialize a simple schema', () => {
      const schema = defineSchema({
        nodes: {
          user: node({
            properties: {
              email: z.string(),
              name: z.string(),
            },
          }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes).toHaveProperty('user')
      expect(serialized.nodes.user.properties).toBeDefined()
      expect(serialized.edges).toEqual({})
    })

    it('should serialize node with all options', () => {
      const schema = defineSchema({
        nodes: {
          user: node({
            properties: {
              email: z.string(),
              age: z.number(),
            },
            indexes: ['email', { property: 'age', type: 'btree' }],
            description: 'A user in the system',
          }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.user.description).toBe('A user in the system')
      expect(serialized.nodes.user.indexes).toHaveLength(2)
      expect(serialized.nodes.user.indexes?.[0]).toBe('email')
      expect(serialized.nodes.user.indexes?.[1]).toEqual({ property: 'age', type: 'btree' })
    })

    it('should serialize edges correctly', () => {
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
            properties: {
              publishedAt: z.date(),
            },
            description: 'User authored a post',
          }),
        },
      })

      const serialized = toSchema(schema)

      expect(serialized.edges.authored).toEqual({
        from: 'user',
        to: 'post',
        cardinality: { outbound: 'many', inbound: 'one' },
        description: 'User authored a post',
        properties: expect.any(Object),
      })
    })
  })

  describe('Label Inheritance', () => {
    it('should serialize node extends', () => {
      const entityNode = node({ properties: { createdAt: z.date() } })
      const schema = defineSchema({
        nodes: {
          entity: entityNode,
          user: node({
            properties: { email: z.string() },
            extends: [entityNode],
          }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.user.extends).toEqual(['entity'])
      expect(serialized.nodes.entity.extends).toBeUndefined()
    })
  })

  describe('Polymorphic Edges', () => {
    it('should serialize polymorphic edge endpoints as arrays', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          admin: node({ properties: { role: z.string() } }),
          post: node({ properties: { title: z.string() } }),
          comment: node({ properties: { text: z.string() } }),
        },
        edges: {
          created: edge({
            from: ['user', 'admin'],
            to: ['post', 'comment'],
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      })

      const serialized = toSchema(schema)

      expect(serialized.edges.created.from).toEqual(['user', 'admin'])
      expect(serialized.edges.created.to).toEqual(['post', 'comment'])
    })
  })

  describe('Composite Indexes', () => {
    it('should serialize composite indexes', () => {
      const schema = defineSchema({
        nodes: {
          user: node({
            properties: {
              tenantId: z.string(),
              email: z.string(),
            },
            indexes: [{ properties: ['tenantId', 'email'], type: 'unique' }],
          }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.user.indexes).toHaveLength(1)
      expect(serialized.nodes.user.indexes?.[0]).toEqual({
        properties: ['tenantId', 'email'],
        type: 'unique',
      })
    })

    it('should serialize composite index with order', () => {
      const schema = defineSchema({
        nodes: {
          event: node({
            properties: {
              userId: z.string(),
              timestamp: z.date(),
            },
            indexes: [
              {
                properties: ['userId', 'timestamp'],
                type: 'btree',
                order: { timestamp: 'DESC' },
              },
            ],
          }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.event.indexes?.[0]).toEqual({
        properties: ['userId', 'timestamp'],
        type: 'btree',
        order: { timestamp: 'DESC' },
      })
    })
  })

  describe('Hierarchy Configuration', () => {
    it('should serialize hierarchy config', () => {
      const schema = defineSchema({
        nodes: {
          entity: node({ properties: { name: z.string() } }),
        },
        edges: {
          hasParent: edge({
            from: 'entity',
            to: 'entity',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
        },
        hierarchy: {
          defaultEdge: 'hasParent',
          direction: 'up',
        },
      })

      const serialized = toSchema(schema)

      expect(serialized.hierarchy).toEqual({
        defaultEdge: 'hasParent',
        direction: 'up',
      })
    })

    it('should omit hierarchy if not defined', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.hierarchy).toBeUndefined()
    })
  })

  describe('Empty Schemas', () => {
    it('should handle schema with no edges', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.edges).toEqual({})
    })

    it('should handle node with no indexes', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.user.indexes).toBeUndefined()
    })

    it('should handle node with empty properties', () => {
      const schema = defineSchema({
        nodes: {
          marker: node({ properties: {} }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      // Empty properties should be omitted
      expect(serialized.nodes.marker.properties).toBeUndefined()
    })

    it('should handle edge with no properties', () => {
      const schema = defineSchema({
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

      const serialized = toSchema(schema)

      expect(serialized.edges.follows.properties).toBeUndefined()
    })
  })

  describe('JSON Serialization', () => {
    it('should produce valid JSON', () => {
      const schema = defineSchema({
        nodes: {
          user: node({
            properties: {
              email: z.string().email(),
              age: z.number().min(0),
              verified: z.boolean().default(false),
            },
            indexes: ['email'],
          }),
          post: node({
            properties: {
              title: z.string(),
              tags: z.array(z.string()),
            },
          }),
        },
        edges: {
          authored: edge({
            from: 'user',
            to: 'post',
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      })

      const serialized = toSchema(schema)
      const json = JSON.stringify(serialized)
      const parsed = JSON.parse(json)

      // Should round-trip without error
      expect(parsed.nodes.user).toBeDefined()
      expect(parsed.nodes.post).toBeDefined()
      expect(parsed.edges.authored).toBeDefined()
    })

    it('should not include undefined values in JSON', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)
      const json = JSON.stringify(serialized)

      // undefined values should not appear in JSON
      expect(json).not.toContain('undefined')
      expect(json).not.toContain('"description":null')
      expect(json).not.toContain('"indexes":null')
    })
  })

  describe('Immutability', () => {
    it('should not mutate the original schema', () => {
      const entityNode = node({ properties: { createdAt: z.date() } })
      const schema = defineSchema({
        nodes: {
          entity: entityNode,
          user: node({
            properties: { name: z.string() },
            extends: [entityNode],
            indexes: ['name'],
          }),
        },
        edges: {},
      })

      const originalExtends = [...(schema.nodes.user.extends ?? [])]
      const originalIndexes = [...(schema.nodes.user.indexes ?? [])]

      const serialized = toSchema(schema)

      // Mutate the serialized output
      if (serialized.nodes.user.extends) {
        serialized.nodes.user.extends.push('mutated')
      }
      if (serialized.nodes.user.indexes) {
        serialized.nodes.user.indexes.push('mutated')
      }

      // Original should be unchanged
      expect(schema.nodes.user.extends).toEqual(originalExtends)
      expect(schema.nodes.user.indexes).toEqual(originalIndexes)
    })
  })

  describe('Extends Serialization Edge Cases', () => {
    it('_extendsRefs does not leak into serialized output', () => {
      const entityNode = node({ properties: { id: z.string() } })
      const schema = defineSchema({
        nodes: {
          entity: entityNode,
          user: node({ properties: { name: z.string() }, extends: [entityNode] }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)
      const json = JSON.stringify(serialized)

      expect(json).not.toContain('_extendsRefs')
      expect(json).not.toContain('extendsRefs')
      // extends should be present as resolved string keys
      expect(serialized.nodes.user.extends).toEqual(['entity'])
    })

    it('deep inheritance serializes only direct extends, not transitive', () => {
      const aNode = node({ properties: { a: z.string() } })
      const bNode = node({ properties: { b: z.string() }, extends: [aNode] })
      const cNode = node({ properties: { c: z.string() }, extends: [bNode] })
      const schema = defineSchema({
        nodes: { a: aNode, b: bNode, c: cNode },
        edges: {},
      })

      const serialized = toSchema(schema)

      // c extends only b (direct), not a (transitive)
      expect(serialized.nodes.c.extends).toEqual(['b'])
      expect(serialized.nodes.b.extends).toEqual(['a'])
      expect(serialized.nodes.a.extends).toBeUndefined()
    })

    it('node with no extends omits the field entirely', () => {
      const schema = defineSchema({
        nodes: { user: node({ properties: { name: z.string() } }) },
        edges: {},
      })

      const serialized = toSchema(schema)
      expect(serialized.nodes.user.extends).toBeUndefined()
      expect('extends' in serialized.nodes.user).toBe(false)
    })
  })
})
