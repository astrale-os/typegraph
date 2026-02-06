import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineSchema, extendSchema, node, edge, mergeNodeSchemas } from '../src/schema/builders'

describe('Schema Extension', () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // Core Functionality
  // ─────────────────────────────────────────────────────────────────────────────

  describe('extendSchema()', () => {
    it('merges nodes from base and extension', () => {
      const base = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const extended = extendSchema(base, {
        nodes: {
          post: node({ properties: { title: z.string() } }),
        },
      })

      expect(extended.nodes).toHaveProperty('user')
      expect(extended.nodes).toHaveProperty('post')
    })

    it('merges edges from base and extension', () => {
      const base = defineSchema({
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

      const extended = extendSchema(base, {
        nodes: {
          comment: node({ properties: { text: z.string() } }),
        },
        edges: {
          commented: edge({
            from: 'user',
            to: 'comment',
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      })

      expect(extended.edges).toHaveProperty('authored')
      expect(extended.edges).toHaveProperty('commented')
    })

    it('empty extension returns base unchanged', () => {
      const base = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const extended = extendSchema(base, {})

      expect(extended.nodes).toHaveProperty('user')
      expect(Object.keys(extended.nodes)).toHaveLength(1)
    })

    it('extension edges can reference base nodes', () => {
      const base = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const extended = extendSchema(base, {
        nodes: {
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

      expect(extended.edges.authored.from).toBe('user')
      expect(extended.edges.authored.to).toBe('post')
    })

    it('extension can override hierarchy', () => {
      const base = defineSchema({
        nodes: {
          folder: node({ properties: { name: z.string() } }),
        },
        edges: {
          parentFolder: edge({
            from: 'folder',
            to: 'folder',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
        },
        hierarchy: { defaultEdge: 'parentFolder' },
      })

      const extended = extendSchema(base, {
        nodes: {
          doc: node({ properties: { title: z.string() } }),
        },
        edges: {
          parentDoc: edge({
            from: 'doc',
            to: 'doc',
            cardinality: { outbound: 'optional', inbound: 'many' },
          }),
        },
        hierarchy: { defaultEdge: 'parentDoc' },
      })

      expect(extended.hierarchy?.defaultEdge).toBe('parentDoc')
    })

    it('multi-level extension works', () => {
      const base = defineSchema({
        nodes: {
          entity: node({ properties: { id: z.string() } }),
        },
        edges: {},
      })

      const ext1 = extendSchema(base, {
        nodes: {
          user: node({ properties: { name: z.string() }, labels: ['entity'] }),
        },
      })

      const ext2 = extendSchema(ext1, {
        nodes: {
          admin: node({ properties: { role: z.string() }, labels: ['user'] }),
        },
      })

      expect(ext2.nodes).toHaveProperty('entity')
      expect(ext2.nodes).toHaveProperty('user')
      expect(ext2.nodes).toHaveProperty('admin')
    })

    it('throws when extension label references unknown node', () => {
      const base = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      expect(() =>
        extendSchema(base, {
          nodes: {
            admin: node({ properties: { role: z.string() }, labels: ['nonexistent'] }),
          },
        }),
      ).toThrow(/nonexistent/)
    })

    it('node replacement: extension node without labels replaces base node', () => {
      const base = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const extended = extendSchema(base, {
        nodes: {
          user: node({ properties: { email: z.string() } }),
        },
      })

      // The extension node replaced the base node
      expect(extended.nodes.user.properties.shape).toHaveProperty('email')
      expect(extended.nodes.user.properties.shape).not.toHaveProperty('name')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Property Inheritance via Labels
  // ─────────────────────────────────────────────────────────────────────────────

  describe('property inheritance (mergeNodeSchemas)', () => {
    it('child with labels inherits parent properties', () => {
      const nodes = {
        entity: node({ properties: { id: z.string(), createdAt: z.date() } }),
        user: node({ properties: { name: z.string() }, labels: ['entity'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // user should have entity's properties
      expect(merged.user.properties.shape).toHaveProperty('id')
      expect(merged.user.properties.shape).toHaveProperty('createdAt')
      expect(merged.user.properties.shape).toHaveProperty('name')
    })

    it('child property overrides parent property', () => {
      const nodes = {
        entity: node({ properties: { name: z.string().min(1) } }),
        user: node({ properties: { name: z.string().max(100) }, labels: ['entity'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // Child's name wins - verify by parsing
      const userNameSchema = merged.user.properties.shape.name
      // Parent had min(1), child has max(100)
      // If child wins, empty string should fail (no min) but long string should fail (has max)
      expect(userNameSchema.safeParse('').success).toBe(true) // No min constraint
      expect(userNameSchema.safeParse('a'.repeat(101)).success).toBe(false) // Has max constraint
    })

    it('diamond inheritance: no duplicate properties', () => {
      const nodes = {
        base: node({ properties: { id: z.string() } }),
        left: node({ properties: { leftProp: z.string() }, labels: ['base'] }),
        right: node({ properties: { rightProp: z.string() }, labels: ['base'] }),
        child: node({ properties: { childProp: z.string() }, labels: ['left', 'right'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // child should have all properties without duplication
      expect(merged.child.properties.shape).toHaveProperty('id')
      expect(merged.child.properties.shape).toHaveProperty('leftProp')
      expect(merged.child.properties.shape).toHaveProperty('rightProp')
      expect(merged.child.properties.shape).toHaveProperty('childProp')

      // Should only have 4 properties total
      expect(Object.keys(merged.child.properties.shape)).toHaveLength(4)
    })

    it('modifiers preserved: .default() works', () => {
      const nodes = {
        entity: node({ properties: { active: z.boolean().default(true) } }),
        user: node({ properties: { name: z.string() }, labels: ['entity'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // The default modifier should be preserved - verify by parsing
      const result = merged.user.properties.parse({ name: 'test' })
      expect(result).toEqual({ name: 'test', active: true })
    })

    it('indexes are NOT inherited from parent labels', () => {
      const nodes = {
        entity: node({
          properties: { id: z.string() },
          indexes: [{ property: 'id' }],
        }),
        user: node({
          properties: { name: z.string() },
          labels: ['entity'],
          indexes: [{ property: 'name' }],
        }),
      }

      const merged = mergeNodeSchemas(nodes)

      // user should only have its own index, not entity's
      expect(merged.user.indexes).toHaveLength(1)
      expect(merged.user.indexes?.[0]).toMatchObject({ property: 'name' })
    })

    it('multiple labels: property merge order is left-to-right', () => {
      const nodes = {
        left: node({ properties: { status: z.literal('left') } }),
        right: node({ properties: { status: z.literal('right') } }),
        child: node({ properties: { name: z.string() }, labels: ['left', 'right'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // 'left' is processed first, then 'right' overwrites
      // So 'right' wins (last one wins in iteration order)
      const statusSchema = merged.child.properties.shape.status
      expect(statusSchema.safeParse('right').success).toBe(true)
      expect(statusSchema.safeParse('left').success).toBe(false)
    })

    it('grandparent properties are inherited', () => {
      const nodes = {
        grandparent: node({ properties: { gp: z.string() } }),
        parent: node({ properties: { p: z.string() }, labels: ['grandparent'] }),
        child: node({ properties: { c: z.string() }, labels: ['parent'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // child should have grandparent's property via parent
      expect(merged.child.properties.shape).toHaveProperty('gp')
      expect(merged.child.properties.shape).toHaveProperty('p')
      expect(merged.child.properties.shape).toHaveProperty('c')
    })

    it('no labels: node unchanged', () => {
      const nodes = {
        user: node({ properties: { name: z.string() } }),
      }

      const merged = mergeNodeSchemas(nodes)

      expect(merged.user.properties.shape).toHaveProperty('name')
      expect(Object.keys(merged.user.properties.shape)).toHaveLength(1)
    })

    it('labels referencing non-existent node: no crash', () => {
      const nodes = {
        user: node({ properties: { name: z.string() }, labels: ['nonexistent'] }),
      }

      // Should not throw, just skip the unknown parent
      const merged = mergeNodeSchemas(nodes)
      expect(merged.user.properties.shape).toHaveProperty('name')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Edge Cases and Deep Semantics
  // ─────────────────────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('diamond inheritance: visited tracking prevents duplicate processing', () => {
      // Verify the diamond pattern actually uses visited tracking
      // by checking that 'base' properties appear exactly once
      const nodes = {
        base: node({ properties: { baseId: z.literal('base-value') } }),
        left: node({ properties: { leftId: z.literal('left-value') }, labels: ['base'] }),
        right: node({ properties: { rightId: z.literal('right-value') }, labels: ['base'] }),
        child: node({ properties: { childId: z.literal('child-value') }, labels: ['left', 'right'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // Verify by parsing - each value should be exactly as defined
      const childSchema = merged.child.properties
      const result = childSchema.parse({
        baseId: 'base-value',
        leftId: 'left-value',
        rightId: 'right-value',
        childId: 'child-value',
      })
      expect(result).toEqual({
        baseId: 'base-value',
        leftId: 'left-value',
        rightId: 'right-value',
        childId: 'child-value',
      })

      // Verify 'base' was only collected once by checking parse behavior
      // If base was collected twice, there might be weird schema merging effects
      expect(childSchema.safeParse({ baseId: 'wrong' }).success).toBe(false)
    })

    it('three-way property conflict: last ancestor wins', () => {
      // When multiple ancestors define the same property,
      // the DFS order determines winner: grandparents before parents, left before right
      const nodes = {
        ancestor1: node({ properties: { shared: z.literal('a1') } }),
        ancestor2: node({ properties: { shared: z.literal('a2') } }),
        ancestor3: node({ properties: { shared: z.literal('a3') } }),
        child: node({
          properties: { own: z.string() },
          labels: ['ancestor1', 'ancestor2', 'ancestor3'],
        }),
      }

      const merged = mergeNodeSchemas(nodes)

      // Last one in iteration order wins (ancestor3)
      const sharedSchema = merged.child.properties.shape.shared
      expect(sharedSchema.safeParse('a3').success).toBe(true)
      expect(sharedSchema.safeParse('a1').success).toBe(false)
      expect(sharedSchema.safeParse('a2').success).toBe(false)
    })

    it('node with labels redefined in extension: labels processed on new node', () => {
      const base = defineSchema({
        nodes: {
          entity: node({ properties: { entityProp: z.string() } }),
          user: node({ properties: { baseName: z.string() }, labels: ['entity'] }),
        },
        edges: {},
      })

      // Redefine user with different labels - should still inherit from entity
      const extended = extendSchema(base, {
        nodes: {
          user: node({ properties: { extName: z.string() }, labels: ['entity'] }),
        },
      })

      // Extension node replaced base node entirely, but labels still work
      const userSchema = extended.nodes.user.properties

      // Verify via parsing - should require both inherited and own properties
      const result = userSchema.parse({ entityProp: 'inherited', extName: 'own' })
      expect(result).toEqual({ entityProp: 'inherited', extName: 'own' })

      // NEGATIVE: Should fail if inherited property is missing
      expect(userSchema.safeParse({ extName: 'own' }).success).toBe(false)

      // NEGATIVE: Should fail if own property is missing
      expect(userSchema.safeParse({ entityProp: 'inherited' }).success).toBe(false)

      // Verify baseName is NOT inherited (old user replaced)
      expect(userSchema.shape).not.toHaveProperty('baseName')
    })

    it('deep inheritance chain (6 levels): all properties inherited', () => {
      const nodes = {
        level0: node({ properties: { p0: z.literal(0) } }),
        level1: node({ properties: { p1: z.literal(1) }, labels: ['level0'] }),
        level2: node({ properties: { p2: z.literal(2) }, labels: ['level1'] }),
        level3: node({ properties: { p3: z.literal(3) }, labels: ['level2'] }),
        level4: node({ properties: { p4: z.literal(4) }, labels: ['level3'] }),
        level5: node({ properties: { p5: z.literal(5) }, labels: ['level4'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // level5 should have all 6 properties
      const schema = merged.level5.properties
      expect(Object.keys(schema.shape)).toHaveLength(6)

      // Verify by parsing
      const result = schema.parse({ p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 })
      expect(result).toEqual({ p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 })
    })

    it('cycle detection: catches cycle introduced by extension', () => {
      const base = defineSchema({
        nodes: {
          a: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      // Extension creates a cycle: a -> b -> a
      expect(() =>
        extendSchema(base, {
          nodes: {
            a: node({ properties: { name: z.string() }, labels: ['b'] }), // a now depends on b
            b: node({ properties: { name: z.string() }, labels: ['a'] }), // b depends on a -> CYCLE
          },
        }),
      ).toThrow(/circular/i)
    })

    it('multi-level extension: properties cascade correctly', () => {
      const base = defineSchema({
        nodes: {
          entity: node({ properties: { entityId: z.literal('entity') } }),
        },
        edges: {},
      })

      const ext1 = extendSchema(base, {
        nodes: {
          user: node({ properties: { userId: z.literal('user') }, labels: ['entity'] }),
        },
      })

      const ext2 = extendSchema(ext1, {
        nodes: {
          admin: node({ properties: { adminId: z.literal('admin') }, labels: ['user'] }),
        },
      })

      // admin should have all 3 properties from inheritance chain
      const adminSchema = ext2.nodes.admin.properties
      const result = adminSchema.parse({
        entityId: 'entity',
        userId: 'user',
        adminId: 'admin',
      })
      expect(result).toEqual({
        entityId: 'entity',
        userId: 'user',
        adminId: 'admin',
      })

      // NEGATIVE: Should fail if any inherited property is missing
      expect(adminSchema.safeParse({ userId: 'user', adminId: 'admin' }).success).toBe(false)
      expect(adminSchema.safeParse({ entityId: 'entity', adminId: 'admin' }).success).toBe(false)

      // NEGATIVE: Should fail if wrong value for literal
      expect(adminSchema.safeParse({ entityId: 'wrong', userId: 'user', adminId: 'admin' }).success).toBe(false)
    })

    it('child can make parent required property optional (override)', () => {
      const nodes = {
        entity: node({ properties: { required: z.string() } }),
        user: node({ properties: { required: z.string().optional() }, labels: ['entity'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // Child wins: 'required' should now be optional
      const result = merged.user.properties.parse({})
      expect(result).toEqual({})
    })

    it('child can make parent optional property required (override)', () => {
      const nodes = {
        entity: node({ properties: { field: z.string().optional() } }),
        user: node({ properties: { field: z.string() }, labels: ['entity'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // Child wins: 'field' should now be required
      expect(merged.user.properties.safeParse({}).success).toBe(false)
      expect(merged.user.properties.safeParse({ field: 'value' }).success).toBe(true)
    })

    it('indexes preserved through multi-level extension', () => {
      const base = defineSchema({
        nodes: {
          entity: node({
            properties: { id: z.string() },
            indexes: [{ property: 'id' }],
          }),
        },
        edges: {},
      })

      const ext1 = extendSchema(base, {
        nodes: {
          user: node({
            properties: { email: z.string() },
            labels: ['entity'],
            indexes: [{ property: 'email' }],
          }),
        },
      })

      const ext2 = extendSchema(ext1, {
        nodes: {
          admin: node({
            properties: { role: z.string() },
            labels: ['user'],
            indexes: [{ property: 'role' }],
          }),
        },
      })

      // Each node should have ONLY its own indexes (not inherited)
      expect(ext2.nodes.entity.indexes).toHaveLength(1)
      expect(ext2.nodes.entity.indexes?.[0]).toMatchObject({ property: 'id' })

      expect(ext2.nodes.user.indexes).toHaveLength(1)
      expect(ext2.nodes.user.indexes?.[0]).toMatchObject({ property: 'email' })

      expect(ext2.nodes.admin.indexes).toHaveLength(1)
      expect(ext2.nodes.admin.indexes?.[0]).toMatchObject({ property: 'role' })
    })

    it('transform modifier preserved through inheritance', () => {
      const nodes = {
        entity: node({
          properties: {
            createdAt: z.string().transform((s) => new Date(s)),
          },
        }),
        user: node({ properties: { name: z.string() }, labels: ['entity'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // The transform should work - input string, output Date
      const result = merged.user.properties.parse({
        name: 'test',
        createdAt: '2024-01-01',
      })
      expect(result.createdAt).toBeInstanceOf(Date)
    })

    it('optional modifier preserved through inheritance', () => {
      const nodes = {
        entity: node({
          properties: {
            optional: z.string().optional(),
          },
        }),
        user: node({ properties: { name: z.string() }, labels: ['entity'] }),
      }

      const merged = mergeNodeSchemas(nodes)

      // Optional should work - can omit the field
      const result = merged.user.properties.parse({ name: 'test' })
      expect(result).toEqual({ name: 'test' })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Integration: defineSchema with property inheritance
  // ─────────────────────────────────────────────────────────────────────────────

  describe('defineSchema with property inheritance', () => {
    it('nodes with labels get merged properties in defineSchema()', () => {
      const schema = defineSchema({
        nodes: {
          entity: node({ properties: { id: z.string() } }),
          user: node({ properties: { name: z.string() }, labels: ['entity'] }),
        },
        edges: {},
      })

      // user should have both id and name
      expect(schema.nodes.user.properties.shape).toHaveProperty('id')
      expect(schema.nodes.user.properties.shape).toHaveProperty('name')
    })

    it('extendSchema propagates property inheritance', () => {
      const base = defineSchema({
        nodes: {
          entity: node({ properties: { id: z.string() } }),
        },
        edges: {},
      })

      const extended = extendSchema(base, {
        nodes: {
          user: node({ properties: { name: z.string() }, labels: ['entity'] }),
        },
      })

      // user should have both id and name
      expect(extended.nodes.user.properties.shape).toHaveProperty('id')
      expect(extended.nodes.user.properties.shape).toHaveProperty('name')
    })
  })
})
