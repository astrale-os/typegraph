import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineSchema, node, edge, diffSchema } from '../src/schema'

// =============================================================================
// TEST SCHEMAS
// =============================================================================

const schemaV1 = defineSchema({
  nodes: {
    user: node({
      properties: { email: z.string(), name: z.string() },
      indexes: ['email'],
    }),
    space: node({
      properties: { name: z.string(), description: z.string().optional() },
    }),
  },
  edges: {
    owns: edge({
      from: 'user',
      to: 'space',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
  },
})

// =============================================================================
// TESTS
// =============================================================================

describe('diffSchema', () => {
  // ---------------------------------------------------------------------------
  // Node changes
  // ---------------------------------------------------------------------------
  describe('nodes', () => {
    it('identical schemas produce empty diff', () => {
      const diff = diffSchema(schemaV1, schemaV1)

      expect(diff.nodes.added).toEqual([])
      expect(diff.nodes.removed).toEqual([])
      expect(diff.nodes.modified).toEqual([])
      expect(diff.edges.added).toEqual([])
      expect(diff.edges.removed).toEqual([])
      expect(diff.edges.modified).toEqual([])
      expect(diff.hierarchy).toEqual([])
      expect(diff.breaking).toBe(false)
      expect(diff.breakingReasons).toEqual([])
      expect(diff.warnings).toEqual([])
    })

    it('detects added node label (non-breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string(), name: z.string() }, indexes: ['email'] }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
          post: node({ properties: { title: z.string() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      expect(diff.nodes.added).toEqual(['post'])
      expect(diff.breaking).toBe(false)
    })

    it('detects removed node label (breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string(), name: z.string() }, indexes: ['email'] }),
        },
        edges: {},
      })

      const diff = diffSchema(schemaV1, v2)
      expect(diff.nodes.removed).toContain('space')
      expect(diff.breaking).toBe(true)
      expect(diff.breakingReasons).toContain("Node kind 'space' was removed")
    })

    it('detects required property added (breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string(), age: z.number() },
            indexes: ['email'],
          }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const addedProp = userMod!.changes.find(
        (c) => c.kind === 'property-added' && c.description.includes("'age'"),
      )
      expect(addedProp).toBeDefined()
      expect(addedProp!.breaking).toBe(true)
      expect(diff.breaking).toBe(true)
    })

    it('detects optional property added (non-breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string(), bio: z.string().optional() },
            indexes: ['email'],
          }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const addedProp = userMod!.changes.find(
        (c) => c.kind === 'property-added' && c.description.includes("'bio'"),
      )
      expect(addedProp).toBeDefined()
      expect(addedProp!.breaking).toBe(false)
      expect(diff.breaking).toBe(false)
    })

    it('detects defaulted property added (non-breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string(), active: z.boolean().default(true) },
            indexes: ['email'],
          }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const addedProp = userMod!.changes.find(
        (c) => c.kind === 'property-added' && c.description.includes("'active'"),
      )
      expect(addedProp).toBeDefined()
      expect(addedProp!.breaking).toBe(false)
    })

    it('detects property removed (breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string() },
            indexes: ['email'],
          }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const removedProp = userMod!.changes.find(
        (c) => c.kind === 'property-removed' && c.description.includes("'name'"),
      )
      expect(removedProp).toBeDefined()
      expect(removedProp!.breaking).toBe(true)
      expect(diff.breaking).toBe(true)
    })

    it('detects property type changed (breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.number() },
            indexes: ['email'],
          }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const changedProp = userMod!.changes.find(
        (c) => c.kind === 'property-changed' && c.description.includes("'name'"),
      )
      expect(changedProp).toBeDefined()
      expect(changedProp!.breaking).toBe(true)
    })

    it('detects property required → optional (non-breaking)', () => {
      const v1 = defineSchema({
        nodes: {
          item: node({ properties: { name: z.string(), tag: z.string() } }),
        },
        edges: {},
      })
      const v2 = defineSchema({
        nodes: {
          item: node({ properties: { name: z.string(), tag: z.string().optional() } }),
        },
        edges: {},
      })

      const diff = diffSchema(v1, v2)
      const itemMod = diff.nodes.modified.find((m) => m.label === 'item')
      expect(itemMod).toBeDefined()
      const change = itemMod!.changes.find(
        (c) => c.kind === 'property-required-changed' && c.description.includes("'tag'"),
      )
      expect(change).toBeDefined()
      expect(change!.breaking).toBe(false)
      expect(change!.description).toContain('required to optional')
    })

    it('detects property optional → required (breaking)', () => {
      const v1 = defineSchema({
        nodes: {
          item: node({ properties: { name: z.string(), tag: z.string().optional() } }),
        },
        edges: {},
      })
      const v2 = defineSchema({
        nodes: {
          item: node({ properties: { name: z.string(), tag: z.string() } }),
        },
        edges: {},
      })

      const diff = diffSchema(v1, v2)
      const itemMod = diff.nodes.modified.find((m) => m.label === 'item')
      expect(itemMod).toBeDefined()
      const change = itemMod!.changes.find(
        (c) => c.kind === 'property-required-changed' && c.description.includes("'tag'"),
      )
      expect(change).toBeDefined()
      expect(change!.breaking).toBe(true)
      expect(change!.description).toContain('optional to required')
    })

    it('detects label added to node (non-breaking)', () => {
      const v1 = defineSchema({
        nodes: {
          entity: node({ properties: { name: z.string() } }),
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })
      const v2 = defineSchema({
        nodes: {
          entity: node({ properties: { name: z.string() } }),
          user: node({ properties: { name: z.string() }, labels: ['entity'] }),
        },
        edges: {},
      })

      const diff = diffSchema(v1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const labelChange = userMod!.changes.find((c) => c.kind === 'label-added')
      expect(labelChange).toBeDefined()
      expect(labelChange!.breaking).toBe(false)
    })

    it('detects multiple label changes on same node', () => {
      const v1 = defineSchema({
        nodes: {
          entity: node({ properties: { name: z.string() } }),
          actor: node({ properties: { name: z.string() } }),
          auditable: node({ properties: { name: z.string() } }),
          user: node({ properties: { name: z.string() }, labels: ['entity'] }),
        },
        edges: {},
      })
      const v2 = defineSchema({
        nodes: {
          entity: node({ properties: { name: z.string() } }),
          actor: node({ properties: { name: z.string() } }),
          auditable: node({ properties: { name: z.string() } }),
          user: node({ properties: { name: z.string() }, labels: ['actor', 'auditable'] }),
        },
        edges: {},
      })

      const diff = diffSchema(v1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const labelAdded = userMod!.changes.filter((c) => c.kind === 'label-added')
      const labelRemoved = userMod!.changes.filter((c) => c.kind === 'label-removed')
      expect(labelAdded).toHaveLength(2)
      expect(labelRemoved).toHaveLength(1)
      expect(diff.breaking).toBe(true)
    })

    it('detects label removed from node (breaking)', () => {
      const v1 = defineSchema({
        nodes: {
          entity: node({ properties: { name: z.string() } }),
          user: node({ properties: { name: z.string() }, labels: ['entity'] }),
        },
        edges: {},
      })
      const v2 = defineSchema({
        nodes: {
          entity: node({ properties: { name: z.string() } }),
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const diff = diffSchema(v1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const labelChange = userMod!.changes.find((c) => c.kind === 'label-removed')
      expect(labelChange).toBeDefined()
      expect(labelChange!.breaking).toBe(true)
      expect(diff.breaking).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // Edge changes
  // ---------------------------------------------------------------------------
  describe('edges', () => {
    it('detects edge type added (non-breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string(), name: z.string() }, indexes: ['email'] }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
          likes: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'many' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      expect(diff.edges.added).toContain('likes')
      expect(diff.breaking).toBe(false)
    })

    it('detects edge type removed (breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string(), name: z.string() }, indexes: ['email'] }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {},
      })

      const diff = diffSchema(schemaV1, v2)
      expect(diff.edges.removed).toContain('owns')
      expect(diff.breaking).toBe(true)
      expect(diff.breakingReasons).toContain("Edge type 'owns' was removed")
    })

    it('detects edge from changed (breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string(), name: z.string() }, indexes: ['email'] }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'space', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const ownsMod = diff.edges.modified.find((m) => m.type === 'owns')
      expect(ownsMod).toBeDefined()
      const fromChange = ownsMod!.changes.find((c) => c.kind === 'from-changed')
      expect(fromChange).toBeDefined()
      expect(fromChange!.breaking).toBe(true)
    })

    it('detects edge to changed (breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string(), name: z.string() }, indexes: ['email'] }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'user', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const ownsMod = diff.edges.modified.find((m) => m.type === 'owns')
      expect(ownsMod).toBeDefined()
      const toChange = ownsMod!.changes.find((c) => c.kind === 'to-changed')
      expect(toChange).toBeDefined()
      expect(toChange!.breaking).toBe(true)
    })

    it('detects cardinality changed (breaking)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string(), name: z.string() }, indexes: ['email'] }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'many' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const ownsMod = diff.edges.modified.find((m) => m.type === 'owns')
      expect(ownsMod).toBeDefined()
      const cardChange = ownsMod!.changes.find((c) => c.kind === 'cardinality-changed')
      expect(cardChange).toBeDefined()
      expect(cardChange!.breaking).toBe(true)
    })

    it('detects edge property added (breaking when required)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string(), name: z.string() }, indexes: ['email'] }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({
            from: 'user',
            to: 'space',
            cardinality: { outbound: 'many', inbound: 'one' },
            properties: { role: z.string() },
          }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const ownsMod = diff.edges.modified.find((m) => m.type === 'owns')
      expect(ownsMod).toBeDefined()
      const propChange = ownsMod!.changes.find(
        (c) => c.kind === 'property-added' && c.description.includes("'role'"),
      )
      expect(propChange).toBeDefined()
      expect(propChange!.breaking).toBe(true)
    })

    it('detects edge property removed (breaking)', () => {
      const v1WithEdgeProps = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          space: node({ properties: { name: z.string() } }),
        },
        edges: {
          owns: edge({
            from: 'user',
            to: 'space',
            cardinality: { outbound: 'many', inbound: 'one' },
            properties: { role: z.string() },
          }),
        },
      })
      const v2NoEdgeProps = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          space: node({ properties: { name: z.string() } }),
        },
        edges: {
          owns: edge({
            from: 'user',
            to: 'space',
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      })

      const diff = diffSchema(v1WithEdgeProps, v2NoEdgeProps)
      const ownsMod = diff.edges.modified.find((m) => m.type === 'owns')
      expect(ownsMod).toBeDefined()
      const propChange = ownsMod!.changes.find(
        (c) => c.kind === 'property-removed' && c.description.includes("'role'"),
      )
      expect(propChange).toBeDefined()
      expect(propChange!.breaking).toBe(true)
    })

    it('treats from: "user" and from: ["user"] as equivalent (no diff)', () => {
      const v1Single = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          space: node({ properties: { name: z.string() } }),
        },
        edges: {
          owns: edge({
            from: 'user',
            to: 'space',
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      })
      const v2Array = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          space: node({ properties: { name: z.string() } }),
        },
        edges: {
          owns: edge({
            from: ['user'],
            to: ['space'],
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      })

      const diff = diffSchema(v1Single, v2Array)
      expect(diff.edges.modified).toEqual([])
      expect(diff.breaking).toBe(false)
    })
  })

  // ---------------------------------------------------------------------------
  // Index changes
  // ---------------------------------------------------------------------------
  describe('indexes', () => {
    it('detects index added (non-breaking, warning)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string() },
            indexes: ['email', 'name'],
          }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const indexChange = userMod!.changes.find((c) => c.kind === 'index-added')
      expect(indexChange).toBeDefined()
      expect(indexChange!.breaking).toBe(false)
      expect(diff.warnings).toHaveLength(1)
      expect(diff.breaking).toBe(false)
    })

    it('detects index removed (non-breaking, warning)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string() },
            indexes: [],
          }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const indexChange = userMod!.changes.find((c) => c.kind === 'index-removed')
      expect(indexChange).toBeDefined()
      expect(indexChange!.breaking).toBe(false)
      expect(diff.warnings).toHaveLength(1)
    })

    it('detects index type changed (non-breaking, warning)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string() },
            indexes: [{ property: 'email', type: 'unique' }],
          }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const indexChange = userMod!.changes.find((c) => c.kind === 'index-changed')
      expect(indexChange).toBeDefined()
      expect(indexChange!.breaking).toBe(false)
    })

    it('detects composite index added (non-breaking, warning)', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string() },
            indexes: ['email', { properties: ['email', 'name'], type: 'unique' }],
          }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const indexChange = userMod!.changes.find(
        (c) => c.kind === 'index-added' && c.description.includes('Composite'),
      )
      expect(indexChange).toBeDefined()
      expect(indexChange!.breaking).toBe(false)
    })

    it('detects composite index removed (non-breaking, warning)', () => {
      const v1 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string() },
            indexes: ['email', { properties: ['email', 'name'], type: 'unique' }],
          }),
        },
        edges: {},
      })
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string() },
            indexes: ['email'],
          }),
        },
        edges: {},
      })

      const diff = diffSchema(v1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const indexChange = userMod!.changes.find(
        (c) => c.kind === 'index-removed' && c.description.includes('Composite'),
      )
      expect(indexChange).toBeDefined()
      expect(indexChange!.breaking).toBe(false)
      expect(diff.warnings).toHaveLength(1)
    })

    it('detects composite index with order/name changed', () => {
      const v1 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string() },
            indexes: [{ properties: ['email', 'name'], type: 'btree', name: 'idx_email_name' }],
          }),
        },
        edges: {},
      })
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string() },
            indexes: [
              {
                properties: ['email', 'name'],
                type: 'btree',
                name: 'idx_email_name_v2',
                order: { email: 'ASC', name: 'DESC' },
              },
            ],
          }),
        },
        edges: {},
      })

      const diff = diffSchema(v1, v2)
      const userMod = diff.nodes.modified.find((m) => m.label === 'user')
      expect(userMod).toBeDefined()
      const indexChange = userMod!.changes.find((c) => c.kind === 'index-changed')
      expect(indexChange).toBeDefined()
      expect(indexChange!.breaking).toBe(false)
      expect(indexChange!.description).toContain('configuration changed')
    })
  })

  // ---------------------------------------------------------------------------
  // Hierarchy changes
  // ---------------------------------------------------------------------------
  describe('hierarchy', () => {
    it('detects hierarchy added (non-breaking, warning)', () => {
      const v1 = defineSchema({
        nodes: { item: node({ properties: { name: z.string() } }) },
        edges: {
          parent: edge({
            from: 'item',
            to: 'item',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
        },
      })
      const v2 = defineSchema({
        nodes: { item: node({ properties: { name: z.string() } }) },
        edges: {
          parent: edge({
            from: 'item',
            to: 'item',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
        },
        hierarchy: { defaultEdge: 'parent', direction: 'up' },
      })

      const diff = diffSchema(v1, v2)
      expect(diff.hierarchy.length).toBe(1)
      expect(diff.hierarchy[0].kind).toBe('hierarchy-added')
      expect(diff.hierarchy[0].breaking).toBe(false)
      expect(diff.warnings).toHaveLength(1)
      expect(diff.breaking).toBe(false)
    })

    it('detects hierarchy removed (non-breaking, warning)', () => {
      const v1 = defineSchema({
        nodes: { item: node({ properties: { name: z.string() } }) },
        edges: {
          parent: edge({
            from: 'item',
            to: 'item',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
        },
        hierarchy: { defaultEdge: 'parent', direction: 'up' },
      })
      const v2 = defineSchema({
        nodes: { item: node({ properties: { name: z.string() } }) },
        edges: {
          parent: edge({
            from: 'item',
            to: 'item',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
        },
      })

      const diff = diffSchema(v1, v2)
      expect(diff.hierarchy.length).toBe(1)
      expect(diff.hierarchy[0].kind).toBe('hierarchy-removed')
      expect(diff.hierarchy[0].breaking).toBe(false)
    })

    it('detects hierarchy edge changed (non-breaking, warning)', () => {
      const v1 = defineSchema({
        nodes: { item: node({ properties: { name: z.string() } }) },
        edges: {
          parent: edge({
            from: 'item',
            to: 'item',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
          child: edge({
            from: 'item',
            to: 'item',
            cardinality: { outbound: 'many', inbound: 'optional' },
          }),
        },
        hierarchy: { defaultEdge: 'parent', direction: 'up' },
      })
      const v2 = defineSchema({
        nodes: { item: node({ properties: { name: z.string() } }) },
        edges: {
          parent: edge({
            from: 'item',
            to: 'item',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
          child: edge({
            from: 'item',
            to: 'item',
            cardinality: { outbound: 'many', inbound: 'optional' },
          }),
        },
        hierarchy: { defaultEdge: 'child', direction: 'down' },
      })

      const diff = diffSchema(v1, v2)
      expect(diff.hierarchy.length).toBe(1)
      expect(diff.hierarchy[0].kind).toBe('hierarchy-changed')
      expect(diff.hierarchy[0].breaking).toBe(false)
      expect(diff.warnings).toHaveLength(1)
    })
  })

  // ---------------------------------------------------------------------------
  // Combined scenarios
  // ---------------------------------------------------------------------------
  describe('combined', () => {
    it('collects all breaking reasons for multiple breaking changes', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.number(), name: z.string() }, // email type changed
            indexes: ['email'],
          }),
          // space removed
        },
        edges: {}, // owns removed
      })

      const diff = diffSchema(schemaV1, v2)
      expect(diff.breaking).toBe(true)
      // Exactly: space removed, owns removed, email type changed
      expect(diff.breakingReasons).toHaveLength(3)
    })

    it('non-breaking changes only produce warnings not breaking reasons', () => {
      const v2 = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string(), name: z.string() },
            indexes: ['email', 'name'], // index added
          }),
          space: node({ properties: { name: z.string(), description: z.string().optional() } }),
        },
        edges: {
          owns: edge({ from: 'user', to: 'space', cardinality: { outbound: 'many', inbound: 'one' } }),
        },
      })

      const diff = diffSchema(schemaV1, v2)
      expect(diff.breaking).toBe(false)
      expect(diff.breakingReasons).toEqual([])
      expect(diff.warnings).toHaveLength(1)
    })

    it('detects description changed (non-breaking)', () => {
      const v1 = defineSchema({
        nodes: {
          item: node({ properties: { name: z.string() }, description: 'An item' }),
        },
        edges: {},
      })
      const v2 = defineSchema({
        nodes: {
          item: node({ properties: { name: z.string() }, description: 'A thing' }),
        },
        edges: {},
      })

      const diff = diffSchema(v1, v2)
      const itemMod = diff.nodes.modified.find((m) => m.label === 'item')
      expect(itemMod).toBeDefined()
      const descChange = itemMod!.changes.find((c) => c.kind === 'description-changed')
      expect(descChange).toBeDefined()
      expect(descChange!.breaking).toBe(false)
      expect(diff.breaking).toBe(false)
    })

    it('detects edge description changed (non-breaking)', () => {
      const v1 = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          space: node({ properties: { name: z.string() } }),
        },
        edges: {
          owns: edge({
            from: 'user',
            to: 'space',
            cardinality: { outbound: 'many', inbound: 'one' },
            description: 'User owns a space',
          }),
        },
      })
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          space: node({ properties: { name: z.string() } }),
        },
        edges: {
          owns: edge({
            from: 'user',
            to: 'space',
            cardinality: { outbound: 'many', inbound: 'one' },
            description: 'Ownership relation',
          }),
        },
      })

      const diff = diffSchema(v1, v2)
      const ownsMod = diff.edges.modified.find((m) => m.type === 'owns')
      expect(ownsMod).toBeDefined()
      const descChange = ownsMod!.changes.find((c) => c.kind === 'description-changed')
      expect(descChange).toBeDefined()
      expect(descChange!.breaking).toBe(false)
    })

    it('detects edge index changes (non-breaking, warning)', () => {
      const v1 = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          resource: node({ properties: { name: z.string() } }),
        },
        edges: {
          access: edge({
            from: 'user',
            to: 'resource',
            cardinality: { outbound: 'many', inbound: 'many' },
            properties: { role: z.string() },
            indexes: ['role'],
          }),
        },
      })
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          resource: node({ properties: { name: z.string() } }),
        },
        edges: {
          access: edge({
            from: 'user',
            to: 'resource',
            cardinality: { outbound: 'many', inbound: 'many' },
            properties: { role: z.string() },
            indexes: [{ property: 'role', type: 'unique' }],
          }),
        },
      })

      const diff = diffSchema(v1, v2)
      const accessMod = diff.edges.modified.find((m) => m.type === 'access')
      expect(accessMod).toBeDefined()
      const indexChange = accessMod!.changes.find((c) => c.kind === 'index-changed')
      expect(indexChange).toBeDefined()
      expect(indexChange!.breaking).toBe(false)
      expect(diff.warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('role')]),
      )
    })

    it('detects edge property type changed (breaking)', () => {
      const v1 = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          space: node({ properties: { name: z.string() } }),
        },
        edges: {
          owns: edge({
            from: 'user',
            to: 'space',
            cardinality: { outbound: 'many', inbound: 'one' },
            properties: { role: z.string() },
          }),
        },
      })
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          space: node({ properties: { name: z.string() } }),
        },
        edges: {
          owns: edge({
            from: 'user',
            to: 'space',
            cardinality: { outbound: 'many', inbound: 'one' },
            properties: { role: z.number() },
          }),
        },
      })

      const diff = diffSchema(v1, v2)
      const ownsMod = diff.edges.modified.find((m) => m.type === 'owns')
      expect(ownsMod).toBeDefined()
      const propChange = ownsMod!.changes.find(
        (c) => c.kind === 'property-changed' && c.description.includes("'role'"),
      )
      expect(propChange).toBeDefined()
      expect(propChange!.breaking).toBe(true)
    })

    it('empty schemas produce empty diff', () => {
      const empty = defineSchema({ nodes: {}, edges: {} })
      const diff = diffSchema(empty, empty)

      expect(diff.nodes.added).toEqual([])
      expect(diff.nodes.removed).toEqual([])
      expect(diff.nodes.modified).toEqual([])
      expect(diff.edges.added).toEqual([])
      expect(diff.edges.removed).toEqual([])
      expect(diff.edges.modified).toEqual([])
      expect(diff.breaking).toBe(false)
    })

    it('normalizeEndpoint sorts multi-element arrays for comparison', () => {
      const v1 = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          admin: node({ properties: { name: z.string() } }),
          space: node({ properties: { name: z.string() } }),
        },
        edges: {
          manages: edge({
            from: ['user', 'admin'],
            to: 'space',
            cardinality: { outbound: 'many', inbound: 'many' },
          }),
        },
      })
      const v2 = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          admin: node({ properties: { name: z.string() } }),
          space: node({ properties: { name: z.string() } }),
        },
        edges: {
          manages: edge({
            from: ['admin', 'user'], // same elements, different order
            to: 'space',
            cardinality: { outbound: 'many', inbound: 'many' },
          }),
        },
      })

      const diff = diffSchema(v1, v2)
      // After sorting, ['admin', 'user'] === ['admin', 'user'] — no change
      expect(diff.edges.modified).toEqual([])
      expect(diff.breaking).toBe(false)
    })
  })
})
