import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineSchema, node, edge, toSchema } from '@astrale/typegraph-core'

describe('toSchema', () => {
  describe('node serialization', () => {
    it('serializes properties to JSON Schema with constraints', () => {
      const schema = defineSchema({
        nodes: {
          user: node({
            properties: {
              email: z.string().email(),
              age: z.number().int().min(0),
              role: z.enum(['admin', 'user']),
            },
          }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.user.properties).toMatchObject({
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          age: { type: 'integer', minimum: 0 },
          role: { enum: ['admin', 'user'] },
        },
        required: ['email', 'age', 'role'],
      })
    })

    it('serializes labels', () => {
      const schema = defineSchema({
        nodes: {
          entity: node({ properties: {} }),
          user: node({
            properties: {},
            labels: ['entity'],
          }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.user.labels).toEqual(['entity'])
      expect(serialized.nodes.entity.labels).toBeUndefined()
    })

    it('serializes description', () => {
      const schema = defineSchema({
        nodes: {
          user: node({
            properties: {},
            description: 'A user account',
          }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.user.description).toBe('A user account')
    })

    it('serializes all index formats', () => {
      const schema = defineSchema({
        nodes: {
          user: node({
            properties: {
              email: z.string(),
              tenantId: z.string(),
              createdAt: z.string(),
            },
            indexes: [
              'email', // simple string
              { property: 'email', type: 'unique', name: 'user_email_unique' }, // single with name
              { properties: ['tenantId', 'email'], type: 'unique' }, // composite
              {
                properties: ['tenantId', 'createdAt'],
                type: 'btree',
                order: { createdAt: 'DESC' },
                name: 'tenant_created_idx',
              }, // composite with order and name
            ],
          }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.user.indexes).toEqual([
        'email',
        { property: 'email', type: 'unique', name: 'user_email_unique' },
        { properties: ['tenantId', 'email'], type: 'unique' },
        {
          properties: ['tenantId', 'createdAt'],
          type: 'btree',
          order: { createdAt: 'DESC' },
          name: 'tenant_created_idx',
        },
      ])
    })

    it('omits empty optional fields', () => {
      const schema = defineSchema({
        nodes: { user: node({ properties: {} }) },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.user).toEqual({})
    })
  })

  describe('edge serialization', () => {
    it('serializes from/to and cardinality', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: {} }),
          post: node({ properties: {} }),
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

      expect(serialized.edges.authored).toEqual({
        from: 'user',
        to: 'post',
        cardinality: { outbound: 'many', inbound: 'one' },
      })
    })

    it('serializes polymorphic from', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: {} }),
          admin: node({ properties: {} }),
          post: node({ properties: {} }),
        },
        edges: {
          created: edge({
            from: ['user', 'admin'],
            to: 'post',
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      })

      const serialized = toSchema(schema)

      expect(serialized.edges.created.from).toEqual(['user', 'admin'])
      expect(serialized.edges.created.to).toBe('post')
    })

    it('serializes polymorphic to', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: {} }),
          post: node({ properties: {} }),
          comment: node({ properties: {} }),
        },
        edges: {
          likes: edge({
            from: 'user',
            to: ['post', 'comment'],
            cardinality: { outbound: 'many', inbound: 'many' },
          }),
        },
      })

      const serialized = toSchema(schema)

      expect(serialized.edges.likes.from).toBe('user')
      expect(serialized.edges.likes.to).toEqual(['post', 'comment'])
    })

    it('serializes edge properties', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: {} }),
        },
        edges: {
          follows: edge({
            from: 'user',
            to: 'user',
            cardinality: { outbound: 'many', inbound: 'many' },
            properties: {
              since: z.string(),
              closeness: z.enum(['close', 'acquaintance']),
            },
          }),
        },
      })

      const serialized = toSchema(schema)

      expect(serialized.edges.follows.properties).toMatchObject({
        type: 'object',
        properties: {
          since: { type: 'string' },
          closeness: { enum: ['close', 'acquaintance'] },
        },
      })
    })

    it('serializes edge description and indexes', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: {} }),
        },
        edges: {
          follows: edge({
            from: 'user',
            to: 'user',
            cardinality: { outbound: 'many', inbound: 'many' },
            properties: {
              since: z.string(),
            },
            description: 'User follow relationship',
            indexes: ['since', { property: 'since', type: 'btree', name: 'follow_since_idx' }],
          }),
        },
      })

      const serialized = toSchema(schema)

      expect(serialized.edges.follows.description).toBe('User follow relationship')
      expect(serialized.edges.follows.indexes).toEqual([
        'since',
        { property: 'since', type: 'btree', name: 'follow_since_idx' },
      ])
    })
  })

  describe('schema-level config', () => {
    it('serializes hierarchy config', () => {
      const schema = defineSchema({
        nodes: {
          folder: node({ properties: {} }),
        },
        edges: {
          hasParent: edge({
            from: 'folder',
            to: 'folder',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
        },
        hierarchy: { defaultEdge: 'hasParent', direction: 'up' },
      })

      const serialized = toSchema(schema)

      expect(serialized.hierarchy).toEqual({ defaultEdge: 'hasParent', direction: 'up' })
    })

    it('omits undefined schema-level config', () => {
      const schema = defineSchema({
        nodes: { user: node({ properties: {} }) },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.hierarchy).toBeUndefined()
    })
  })

  describe('edge cases', () => {
    it('handles unrepresentable Zod types gracefully', () => {
      const schema = defineSchema({
        nodes: {
          event: node({
            properties: {
              name: z.string(),
              timestamp: z.date(), // Unrepresentable in JSON Schema
            },
          }),
        },
        edges: {},
      })

      const serialized = toSchema(schema)

      expect(serialized.nodes.event.properties?.properties?.name).toEqual({ type: 'string' })
      expect(serialized.nodes.event.properties?.properties?.timestamp).toEqual({}) // becomes empty object
    })

    it('produces valid JSON that survives round-trip', () => {
      const schema = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string().email(), tenantId: z.string() },
            labels: ['entity'],
            indexes: [
              { properties: ['tenantId', 'email'], type: 'unique', order: { email: 'ASC' } },
            ],
          }),
          entity: node({ properties: {} }),
        },
        edges: {
          follows: edge({
            from: 'user',
            to: 'user',
            cardinality: { outbound: 'many', inbound: 'many' },
          }),
        },
        hierarchy: { defaultEdge: 'follows', direction: 'up' },
      })

      const json = JSON.stringify(toSchema(schema))
      const parsed = JSON.parse(json)

      expect(parsed.nodes.user.properties.properties.email.format).toBe('email')
      expect(parsed.nodes.user.labels).toEqual(['entity'])
      expect(parsed.nodes.user.indexes[0].order).toEqual({ email: 'ASC' })
      expect(parsed.edges.follows.cardinality).toEqual({ outbound: 'many', inbound: 'many' })
      expect(parsed.hierarchy.direction).toBe('up')
    })

    it('handles schema with multiple nodes and edges', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          post: node({ properties: { title: z.string() } }),
          comment: node({ properties: { body: z.string() } }),
        },
        edges: {
          authored: edge({
            from: 'user',
            to: 'post',
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
          commented: edge({
            from: 'user',
            to: 'comment',
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      })

      const serialized = toSchema(schema)

      expect(Object.keys(serialized.nodes)).toEqual(['user', 'post', 'comment'])
      expect(Object.keys(serialized.edges)).toEqual(['authored', 'commented'])
    })
  })
})
