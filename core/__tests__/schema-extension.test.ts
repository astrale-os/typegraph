import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import type { NodeDefinition } from '../src/schema/types'

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

    it('extending base with internal inheritance works', () => {
      const entityNode = node({ properties: { id: z.string() } })
      const userNode = node({ properties: { name: z.string() }, extends: [entityNode] })
      const base = defineSchema({
        nodes: { entity: entityNode, user: userNode },
        edges: {},
      })

      // Base has internal inheritance (user extends entity).
      // Adding a new node that doesn't reference anything should work.
      const extended = extendSchema(base, {
        nodes: { post: node({ properties: { title: z.string() } }) },
      })

      expect(extended.nodes).toHaveProperty('entity')
      expect(extended.nodes).toHaveProperty('user')
      expect(extended.nodes).toHaveProperty('post')
      // user should still have inherited properties
      expect(extended.nodes.user.extends).toEqual(['entity'])
      expect(extended.nodes.user.properties.shape).toHaveProperty('id')
      expect(extended.nodes.user.properties.shape).toHaveProperty('name')
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
        hierarchy: { defaultEdge: 'parentFolder', direction: 'up' },
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
        hierarchy: { defaultEdge: 'parentDoc', direction: 'up' },
      })

      expect(extended.hierarchy?.defaultEdge).toBe('parentDoc')
    })

    it('multi-level extension works', () => {
      const entityNode = node({ properties: { id: z.string() } })
      const base = defineSchema({
        nodes: {
          entity: entityNode,
        },
        edges: {},
      })

      // Single-level extension with extends referencing base node
      const userNode = node({ properties: { name: z.string() }, extends: [base.nodes.entity] })
      const ext1 = extendSchema(base, {
        nodes: {
          user: userNode,
        },
      })

      // Multi-level inheritance via flat defineSchema (extendSchema chains with
      // cross-level inheritance require resolved node identity matching)
      const entityNode2 = node({ properties: { id: z.string() } })
      const userNode2 = node({ properties: { name: z.string() }, extends: [entityNode2] })
      const adminNode = node({ properties: { role: z.string() }, extends: [userNode2] })
      const ext2 = defineSchema({
        nodes: {
          entity: entityNode2,
          user: userNode2,
          admin: adminNode,
        },
        edges: {},
      })

      expect(ext1.nodes).toHaveProperty('entity')
      expect(ext1.nodes).toHaveProperty('user')
      expect(ext2.nodes).toHaveProperty('entity')
      expect(ext2.nodes).toHaveProperty('user')
      expect(ext2.nodes).toHaveProperty('admin')
    })

    it('throws when extension extends references unknown node', () => {
      const base = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const nonexistentNode = node({ properties: {} })
      expect(() =>
        extendSchema(base, {
          nodes: {
            admin: node({ properties: { role: z.string() }, extends: [nonexistentNode] }),
          },
        }),
      ).toThrow(/not found in base or extension schema/)
    })

    it('node replacement: extension node without extends replaces base node', () => {
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
  // Property Inheritance via Extends
  // ─────────────────────────────────────────────────────────────────────────────

  describe('property inheritance (mergeNodeSchemas)', () => {
    it('child with extends inherits parent properties', () => {
      const entityNode = node({ properties: { id: z.string(), createdAt: z.date() } })
      const userNode = node({ properties: { name: z.string() }, extends: [entityNode] })
      const schema = defineSchema({
        nodes: { entity: entityNode, user: userNode },
        edges: {},
      })

      // user should have entity's properties (defineSchema calls mergeNodeSchemas internally)
      expect(schema.nodes.user.properties.shape).toHaveProperty('id')
      expect(schema.nodes.user.properties.shape).toHaveProperty('createdAt')
      expect(schema.nodes.user.properties.shape).toHaveProperty('name')
    })

    it('child property overrides parent property', () => {
      const entityNode = node({ properties: { name: z.string().min(1) } })
      const userNode = node({ properties: { name: z.string().max(100) }, extends: [entityNode] })
      const schema = defineSchema({
        nodes: { entity: entityNode, user: userNode },
        edges: {},
      })

      // Child's name wins - verify by parsing
      const userNameSchema = schema.nodes.user.properties.shape.name
      // Parent had min(1), child has max(100)
      // If child wins, empty string should fail (no min) but long string should fail (has max)
      expect(userNameSchema.safeParse('').success).toBe(true) // No min constraint
      expect(userNameSchema.safeParse('a'.repeat(101)).success).toBe(false) // Has max constraint
    })

    it('diamond inheritance: no duplicate properties', () => {
      const baseNode = node({ properties: { id: z.string() } })
      const leftNode = node({ properties: { leftProp: z.string() }, extends: [baseNode] })
      const rightNode = node({ properties: { rightProp: z.string() }, extends: [baseNode] })
      const childNode = node({
        properties: { childProp: z.string() },
        extends: [leftNode, rightNode],
      })
      const schema = defineSchema({
        nodes: { base: baseNode, left: leftNode, right: rightNode, child: childNode },
        edges: {},
      })

      // child should have all properties without duplication
      expect(schema.nodes.child.properties.shape).toHaveProperty('id')
      expect(schema.nodes.child.properties.shape).toHaveProperty('leftProp')
      expect(schema.nodes.child.properties.shape).toHaveProperty('rightProp')
      expect(schema.nodes.child.properties.shape).toHaveProperty('childProp')

      // Should only have 4 properties total
      expect(Object.keys(schema.nodes.child.properties.shape)).toHaveLength(4)
    })

    it('modifiers preserved: .default() works', () => {
      const entityNode = node({ properties: { active: z.boolean().default(true) } })
      const userNode = node({ properties: { name: z.string() }, extends: [entityNode] })
      const schema = defineSchema({
        nodes: { entity: entityNode, user: userNode },
        edges: {},
      })

      // The default modifier should be preserved - verify by parsing
      const result = schema.nodes.user.properties.parse({ name: 'test' })
      expect(result).toEqual({ name: 'test', active: true })
    })

    it('indexes are NOT inherited from parent extends', () => {
      const entityNode = node({
        properties: { id: z.string() },
        indexes: ['id'],
      })
      const userNode = node({
        properties: { name: z.string() },
        extends: [entityNode],
        indexes: ['name'],
      })
      const schema = defineSchema({
        nodes: { entity: entityNode, user: userNode },
        edges: {},
      })

      // user should only have its own index, not entity's
      expect(schema.nodes.user.indexes).toHaveLength(1)
      expect(schema.nodes.user.indexes?.[0]).toBe('name')
    })

    it('multiple extends: property merge order is left-to-right', () => {
      const leftNode = node({ properties: { status: z.literal('left') } })
      const rightNode = node({ properties: { status: z.literal('right') } })
      const childNode = node({ properties: { name: z.string() }, extends: [leftNode, rightNode] })
      const schema = defineSchema({
        nodes: { left: leftNode, right: rightNode, child: childNode },
        edges: {},
      })

      // 'left' is processed first, then 'right' overwrites
      // So 'right' wins (last one wins in iteration order)
      // Note: inherited properties are merged at runtime but not reflected in TProps
      const statusSchema = (schema.nodes.child.properties.shape as Record<string, z.ZodType>).status
      expect(statusSchema.safeParse('right').success).toBe(true)
      expect(statusSchema.safeParse('left').success).toBe(false)
    })

    it('grandparent properties are inherited', () => {
      const grandparentNode = node({ properties: { gp: z.string() } })
      const parentNode = node({ properties: { p: z.string() }, extends: [grandparentNode] })
      const childNode = node({ properties: { c: z.string() }, extends: [parentNode] })
      const schema = defineSchema({
        nodes: { grandparent: grandparentNode, parent: parentNode, child: childNode },
        edges: {},
      })

      // child should have grandparent's property via parent
      expect(schema.nodes.child.properties.shape).toHaveProperty('gp')
      expect(schema.nodes.child.properties.shape).toHaveProperty('p')
      expect(schema.nodes.child.properties.shape).toHaveProperty('c')
    })

    it('no extends: node unchanged', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const nodes: Record<string, NodeDefinition<any, any>> = {
        user: node({ properties: { name: z.string() } }),
      }

      const merged = mergeNodeSchemas(nodes)

      expect(merged.user.properties.shape).toHaveProperty('name')
      expect(Object.keys(merged.user.properties.shape)).toHaveLength(1)
    })

    it('extends referencing non-existent node: no crash', () => {
      // mergeNodeSchemas with resolved extends pointing to a key not in the map
      // should gracefully skip the unknown parent
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      // Manually construct a node with extends pointing to non-existent key
      const nodesWithBadExtends = {
        ...schema.nodes,
        user: { ...schema.nodes.user, extends: ['nonexistent'] as readonly string[] },
      }

      // Should not throw, just skip the unknown parent
      const merged = mergeNodeSchemas(nodesWithBadExtends)
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
      const baseNode = node({ properties: { baseId: z.literal('base-value') } })
      const leftNode = node({
        properties: { leftId: z.literal('left-value') },
        extends: [baseNode],
      })
      const rightNode = node({
        properties: { rightId: z.literal('right-value') },
        extends: [baseNode],
      })
      const childNode = node({
        properties: { childId: z.literal('child-value') },
        extends: [leftNode, rightNode],
      })
      const schema = defineSchema({
        nodes: { base: baseNode, left: leftNode, right: rightNode, child: childNode },
        edges: {},
      })

      // Verify by parsing - each value should be exactly as defined
      const childSchema = schema.nodes.child.properties
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
      const ancestor1Node = node({ properties: { shared: z.literal('a1') } })
      const ancestor2Node = node({ properties: { shared: z.literal('a2') } })
      const ancestor3Node = node({ properties: { shared: z.literal('a3') } })
      const childNode = node({
        properties: { own: z.string() },
        extends: [ancestor1Node, ancestor2Node, ancestor3Node],
      })
      const schema = defineSchema({
        nodes: {
          ancestor1: ancestor1Node,
          ancestor2: ancestor2Node,
          ancestor3: ancestor3Node,
          child: childNode,
        },
        edges: {},
      })

      // Last one in iteration order wins (ancestor3)
      // Note: inherited properties are merged at runtime but not reflected in TProps
      const sharedSchema = (schema.nodes.child.properties.shape as Record<string, z.ZodType>).shared
      expect(sharedSchema.safeParse('a3').success).toBe(true)
      expect(sharedSchema.safeParse('a1').success).toBe(false)
      expect(sharedSchema.safeParse('a2').success).toBe(false)
    })

    it('node with extends redefined in extension: extends processed on new node', () => {
      const entityNode = node({ properties: { entityProp: z.string() } })
      const baseUserNode = node({ properties: { baseName: z.string() }, extends: [entityNode] })
      const base = defineSchema({
        nodes: {
          entity: entityNode,
          user: baseUserNode,
        },
        edges: {},
      })

      // Redefine user with different extends - should still inherit from entity
      // Use base.nodes.entity (the resolved node) as the extends ref
      const extUserNode = node({
        properties: { extName: z.string() },
        extends: [base.nodes.entity],
      })
      const extended = extendSchema(base, {
        nodes: {
          user: extUserNode,
        },
      })

      // Extension node replaced base node entirely, but extends still work
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
      const level0Node = node({ properties: { p0: z.literal(0) } })
      const level1Node = node({ properties: { p1: z.literal(1) }, extends: [level0Node] })
      const level2Node = node({ properties: { p2: z.literal(2) }, extends: [level1Node] })
      const level3Node = node({ properties: { p3: z.literal(3) }, extends: [level2Node] })
      const level4Node = node({ properties: { p4: z.literal(4) }, extends: [level3Node] })
      const level5Node = node({ properties: { p5: z.literal(5) }, extends: [level4Node] })
      const fullSchema = defineSchema({
        nodes: {
          level0: level0Node,
          level1: level1Node,
          level2: level2Node,
          level3: level3Node,
          level4: level4Node,
          level5: level5Node,
        },
        edges: {},
      })

      // level5 should have all 6 properties
      const level5Schema = fullSchema.nodes.level5.properties
      expect(Object.keys(level5Schema.shape)).toHaveLength(6)

      // Verify by parsing
      const result = level5Schema.parse({ p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 })
      expect(result).toEqual({ p0: 0, p1: 1, p2: 2, p3: 3, p4: 4, p5: 5 })
    })

    it('extends detection: catches unknown extends introduced by extension', () => {
      const aNode = node({ properties: { name: z.string() } })
      const base = defineSchema({
        nodes: {
          a: aNode,
        },
        edges: {},
      })

      // With ref-based extends, circular inheritance is architecturally impossible.
      // Instead verify that extending a node not in the schema is caught.
      const orphanNode = node({ properties: {} })
      expect(() =>
        extendSchema(base, {
          nodes: {
            b: node({ properties: { name: z.string() }, extends: [orphanNode] }),
          },
        }),
      ).toThrow(/not found in base or extension schema/)
    })

    it('multi-level extension: properties cascade correctly', () => {
      // Multi-level inheritance via flat defineSchema (avoids cross-level
      // extendSchema ref identity issue with resolved nodes)
      const entityNode = node({ properties: { entityId: z.literal('entity') } })
      const userNode = node({ properties: { userId: z.literal('user') }, extends: [entityNode] })
      const adminNode = node({ properties: { adminId: z.literal('admin') }, extends: [userNode] })
      const schema = defineSchema({
        nodes: {
          entity: entityNode,
          user: userNode,
          admin: adminNode,
        },
        edges: {},
      })

      // admin should have all 3 properties from inheritance chain
      const adminSchema = schema.nodes.admin.properties
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
      expect(
        adminSchema.safeParse({ entityId: 'wrong', userId: 'user', adminId: 'admin' }).success,
      ).toBe(false)
    })

    it('child can make parent required property optional (override)', () => {
      const entityNode = node({ properties: { required: z.string() } })
      const userNode = node({
        properties: { required: z.string().optional() },
        extends: [entityNode],
      })
      const schema = defineSchema({
        nodes: { entity: entityNode, user: userNode },
        edges: {},
      })

      // Child wins: 'required' should now be optional
      const result = schema.nodes.user.properties.parse({})
      expect(result).toEqual({})
    })

    it('child can make parent optional property required (override)', () => {
      const entityNode = node({ properties: { field: z.string().optional() } })
      const userNode = node({ properties: { field: z.string() }, extends: [entityNode] })
      const schema = defineSchema({
        nodes: { entity: entityNode, user: userNode },
        edges: {},
      })

      // Child wins: 'field' should now be required
      expect(schema.nodes.user.properties.safeParse({}).success).toBe(false)
      expect(schema.nodes.user.properties.safeParse({ field: 'value' }).success).toBe(true)
    })

    it('indexes preserved through multi-level extension', () => {
      // Multi-level inheritance via flat defineSchema (avoids cross-level
      // extendSchema ref identity issue with resolved nodes)
      const entityNode = node({
        properties: { id: z.string() },
        indexes: ['id'],
      })
      const userNode = node({
        properties: { email: z.string() },
        extends: [entityNode],
        indexes: ['email'],
      })
      const adminNode = node({
        properties: { role: z.string() },
        extends: [userNode],
        indexes: ['role'],
      })
      const schema = defineSchema({
        nodes: {
          entity: entityNode,
          user: userNode,
          admin: adminNode,
        },
        edges: {},
      })

      // Each node should have ONLY its own indexes (not inherited)
      expect(schema.nodes.entity.indexes).toHaveLength(1)
      expect(schema.nodes.entity.indexes?.[0]).toBe('id')

      expect(schema.nodes.user.indexes).toHaveLength(1)
      expect(schema.nodes.user.indexes?.[0]).toBe('email')

      expect(schema.nodes.admin.indexes).toHaveLength(1)
      expect(schema.nodes.admin.indexes?.[0]).toBe('role')
    })

    it('transform modifier preserved through inheritance', () => {
      const entityNode = node({
        properties: {
          createdAt: z.string().transform((s) => new Date(s)),
        },
      })
      const userNode = node({ properties: { name: z.string() }, extends: [entityNode] })
      const schema = defineSchema({
        nodes: { entity: entityNode, user: userNode },
        edges: {},
      })

      // The transform should work - input string, output Date
      // Note: inherited properties are merged at runtime but not reflected in TProps
      const result = schema.nodes.user.properties.parse({
        name: 'test',
        createdAt: '2024-01-01',
      })
      expect((result as Record<string, unknown>).createdAt).toBeInstanceOf(Date)
    })

    it('optional modifier preserved through inheritance', () => {
      const entityNode = node({
        properties: {
          optional: z.string().optional(),
        },
      })
      const userNode = node({ properties: { name: z.string() }, extends: [entityNode] })
      const schema = defineSchema({
        nodes: { entity: entityNode, user: userNode },
        edges: {},
      })

      // Optional should work - can omit the field
      const result = schema.nodes.user.properties.parse({ name: 'test' })
      expect(result).toEqual({ name: 'test' })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Integration: defineSchema with property inheritance
  // ─────────────────────────────────────────────────────────────────────────────

  describe('defineSchema with property inheritance', () => {
    it('nodes with extends get merged properties in defineSchema()', () => {
      const entityNode = node({ properties: { id: z.string() } })
      const userNode = node({ properties: { name: z.string() }, extends: [entityNode] })
      const schema = defineSchema({
        nodes: {
          entity: entityNode,
          user: userNode,
        },
        edges: {},
      })

      // user should have both id and name
      expect(schema.nodes.user.properties.shape).toHaveProperty('id')
      expect(schema.nodes.user.properties.shape).toHaveProperty('name')
    })

    it('extendSchema propagates property inheritance', () => {
      const entityNode = node({ properties: { id: z.string() } })
      const base = defineSchema({
        nodes: {
          entity: entityNode,
        },
        edges: {},
      })

      // Use base.nodes.entity (the resolved node) as the extends ref
      const userNode = node({ properties: { name: z.string() }, extends: [base.nodes.entity] })
      const extended = extendSchema(base, {
        nodes: {
          user: userNode,
        },
      })

      // user should have both id and name
      expect(extended.nodes.user.properties.shape).toHaveProperty('id')
      expect(extended.nodes.user.properties.shape).toHaveProperty('name')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Extends Edge Cases: Identity, Programmatic, and Complex Scenarios
  // ─────────────────────────────────────────────────────────────────────────────

  describe('extends edge cases', () => {
    it('extendSchema with base that has deep inheritance chain', () => {
      const aNode = node({ properties: { a: z.string() } })
      const bNode = node({ properties: { b: z.string() }, extends: [aNode] })
      const cNode = node({ properties: { c: z.string() }, extends: [bNode] })
      const base = defineSchema({
        nodes: { a: aNode, b: bNode, c: cNode },
        edges: {},
      })

      // Extend with unrelated node — base internal inheritance must survive
      const extended = extendSchema(base, {
        nodes: { d: node({ properties: { d: z.string() } }) },
      })

      expect(extended.nodes.c.extends).toEqual(['b'])
      expect(extended.nodes.b.extends).toEqual(['a'])
      // c should have inherited a + b + own
      expect(extended.nodes.c.properties.shape).toHaveProperty('a')
      expect(extended.nodes.c.properties.shape).toHaveProperty('b')
      expect(extended.nodes.c.properties.shape).toHaveProperty('c')
    })

    it('extendSchema with extension node referencing resolved base node', () => {
      const entityNode = node({ properties: { id: z.string() } })
      const base = defineSchema({
        nodes: { entity: entityNode },
        edges: {},
      })

      // Extension node uses base.nodes.entity (resolved copy) as ref
      const ext = extendSchema(base, {
        nodes: { user: node({ properties: { name: z.string() }, extends: [base.nodes.entity] }) },
      })

      expect(ext.nodes.user.extends).toEqual(['entity'])
      expect(ext.nodes.user.properties.shape).toHaveProperty('id')
      expect(ext.nodes.user.properties.shape).toHaveProperty('name')
    })

    it('chained extendSchema preserves inheritance at each level', () => {
      const entityNode = node({ properties: { id: z.string() } })
      const base = defineSchema({
        nodes: { entity: entityNode },
        edges: {},
      })

      const userNode = node({ properties: { name: z.string() }, extends: [base.nodes.entity] })
      const ext1 = extendSchema(base, { nodes: { user: userNode } })

      // Chain again — ext1 has internal inheritance (user extends entity)
      const ext2 = extendSchema(ext1, {
        nodes: { post: node({ properties: { title: z.string() } }) },
      })

      expect(ext2.nodes.user.extends).toEqual(['entity'])
      expect(ext2.nodes.user.properties.shape).toHaveProperty('id')
      expect(ext2.nodes.user.properties.shape).toHaveProperty('name')
      expect(ext2.nodes).toHaveProperty('post')
    })

    it('chained extendSchema: extension at each level can reference previous level', () => {
      const entityNode = node({ properties: { id: z.string() } })
      const base = defineSchema({
        nodes: { entity: entityNode },
        edges: {},
      })

      const ext1 = extendSchema(base, {
        nodes: { user: node({ properties: { name: z.string() }, extends: [base.nodes.entity] }) },
      })

      // admin extends user — must use ext1.nodes.user (resolved), not userNode
      const ext2 = extendSchema(ext1, {
        nodes: { admin: node({ properties: { role: z.string() }, extends: [ext1.nodes.user] }) },
      })

      expect(ext2.nodes.admin.extends).toEqual(['user'])
      expect(ext2.nodes.admin.properties.shape).toHaveProperty('id')
      expect(ext2.nodes.admin.properties.shape).toHaveProperty('name')
      expect(ext2.nodes.admin.properties.shape).toHaveProperty('role')
    })

    it('same NodeDefinition under multiple keys: last key wins in reverse map', () => {
      const sharedNode = node({ properties: { name: z.string() } })
      const childNode = node({ properties: { extra: z.string() }, extends: [sharedNode] })

      // sharedNode registered as both 'alias1' and 'alias2'
      const schema = defineSchema({
        nodes: { alias1: sharedNode, alias2: sharedNode, child: childNode },
        edges: {},
      })

      // child.extends resolves to one of the keys (depends on iteration order)
      expect(schema.nodes.child.extends).toBeDefined()
      expect(schema.nodes.child.extends).toHaveLength(1)
      const resolvedKey = schema.nodes.child.extends![0]
      expect(['alias1', 'alias2']).toContain(resolvedKey)
    })

    it('programmatic schema: nodes built in a loop', () => {
      const baseNode = node({ properties: { createdAt: z.date() } })
      const configs = [
        { name: 'user', props: { email: z.string() } },
        { name: 'post', props: { title: z.string() } },
        { name: 'comment', props: { body: z.string() } },
      ] as const

      const nodes: Record<string, NodeDefinition<any, any>> = { base: baseNode }
      for (const cfg of configs) {
        nodes[cfg.name] = node({ properties: cfg.props, extends: [baseNode] })
      }

      const schema = defineSchema({ nodes, edges: {} })

      for (const cfg of configs) {
        expect(schema.nodes[cfg.name].extends).toEqual(['base'])
        expect(schema.nodes[cfg.name].properties.shape).toHaveProperty('createdAt')
      }
    })

    it('factory function pattern works when parent is shared', () => {
      const entityNode = node({ properties: { id: z.string() } })

      function makeChild(props: Record<string, z.ZodType>) {
        return node({ properties: props, extends: [entityNode] })
      }

      const schema = defineSchema({
        nodes: {
          entity: entityNode,
          user: makeChild({ name: z.string() }),
          post: makeChild({ title: z.string() }),
        },
        edges: {},
      })

      expect(schema.nodes.user.extends).toEqual(['entity'])
      expect(schema.nodes.post.extends).toEqual(['entity'])
      expect(schema.nodes.user.properties.shape).toHaveProperty('id')
      expect(schema.nodes.post.properties.shape).toHaveProperty('id')
    })

    it('cloned/spread NodeDefinition breaks identity resolution', () => {
      const baseNode = node({ properties: { id: z.string() } })
      const clone = { ...baseNode }
      const childNode = node({ properties: { name: z.string() }, extends: [clone] })

      // clone !== baseNode, so defineSchema can't resolve the ref
      expect(() =>
        defineSchema({
          nodes: { base: baseNode, child: childNode },
          edges: {},
        }),
      ).toThrow(/extends an unknown node definition/)
    })

    it('extendSchema rejects extension node with original (pre-resolution) ref', () => {
      const entityNode = node({ properties: { id: z.string() } })
      const base = defineSchema({
        nodes: { entity: entityNode },
        edges: {},
      })

      // Using original entityNode (not base.nodes.entity) should throw
      expect(() =>
        extendSchema(base, {
          nodes: { user: node({ properties: { name: z.string() }, extends: [entityNode] }) },
        }),
      ).toThrow(/not found in base or extension schema/)
    })
  })
})
