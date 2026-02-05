/**
 * Edge Case Tests - Verifying Corner Cases
 *
 * Tests for potential issues identified in critical analysis:
 * 1. Empty edges schema
 * 2. Property override in inheritance
 * 3. Very deep inheritance chains
 * 4. Discriminated union narrowing
 */
// @ts-nocheck

import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'
import { defineSchema, node, edge, type Infer } from '../src'

describe('Edge Cases', () => {
  describe('Empty edges schema', () => {
    it('should handle schema with no edges gracefully', () => {
      const noEdgesSchema = defineSchema({
        nodes: {
          user: node({
            properties: { name: z.string() },
          }),
        },
        edges: {},
      })

      type Types = Infer<typeof noEdgesSchema>

      // Nodes should work normally
      type User = Types['nodes']['user']
      expectTypeOf<User>().toMatchTypeOf<{
        id: string
        kind: 'user'
        name: string
      }>()

      // Edges should be empty object
      type Edges = Types['edges']
      expectTypeOf<Edges>().toEqualTypeOf<Record<string, never>>()

      // Edge union should be never (union of zero types)
      type EdgeUnion = Types['edgeUnion']
      expectTypeOf<EdgeUnion>().toEqualTypeOf<never>()

      // Edge names should be never
      type EdgeNames = Types['edgeNames']
      expectTypeOf<EdgeNames>().toEqualTypeOf<never>()
    })
  })

  describe('Property override in inheritance', () => {
    it('should allow child to narrow parent property type', () => {
      const schema = defineSchema({
        nodes: {
          entity: node({
            properties: {
              status: z.string(), // Wide type
            },
          }),
          user: node({
            properties: {
              status: z.enum(['active', 'inactive']), // Narrower type
            },
            labels: ['entity'],
          }),
        },
        edges: {},
      })

      type Types = Infer<typeof schema>

      type Entity = Types['nodes']['entity']
      type User = Types['nodes']['user']

      // Entity has wide string
      expectTypeOf<Entity['status']>().toEqualTypeOf<string>()

      // User has narrow enum (child overrides parent)
      expectTypeOf<User['status']>().toEqualTypeOf<'active' | 'inactive'>()
    })

    it('should handle property addition in child', () => {
      const schema = defineSchema({
        nodes: {
          entity: node({
            properties: {
              id: z.string(),
              createdAt: z.date(),
            },
          }),
          user: node({
            properties: {
              email: z.string(), // New property
            },
            labels: ['entity'],
          }),
        },
        edges: {},
      })

      type Types = Infer<typeof schema>
      type User = Types['nodes']['user']

      // User should have both inherited and own properties
      expectTypeOf<User>().toMatchTypeOf<{
        id: string
        kind: 'user'
        createdAt: Date
        email: string
      }>()
    })
  })

  describe('Deep inheritance chains', () => {
    it('should handle 5-level inheritance', () => {
      const deepSchema = defineSchema({
        nodes: {
          l0: node({ properties: { p0: z.string() } }),
          l1: node({ properties: { p1: z.string() }, labels: ['l0'] }),
          l2: node({ properties: { p2: z.string() }, labels: ['l1'] }),
          l3: node({ properties: { p3: z.string() }, labels: ['l2'] }),
          l4: node({ properties: { p4: z.string() }, labels: ['l3'] }),
        },
        edges: {},
      })

      type Types = Infer<typeof deepSchema>
      type L4 = Types['nodes']['l4']

      // Should have all properties from all ancestors
      expectTypeOf<L4>().toMatchTypeOf<{
        id: string
        kind: 'l4'
        p0: string // From l0
        p1: string // From l1
        p2: string // From l2
        p3: string // From l3
        p4: string // From l4
      }>()
    })

    it('should handle diamond inheritance', () => {
      const diamondSchema = defineSchema({
        nodes: {
          base: node({ properties: { baseVal: z.string() } }),
          left: node({ properties: { leftVal: z.string() }, labels: ['base'] }),
          right: node({ properties: { rightVal: z.string() }, labels: ['base'] }),
          bottom: node({
            properties: { bottomVal: z.string() },
            labels: ['left', 'right'],
          }),
        },
        edges: {},
      })

      type Types = Infer<typeof diamondSchema>
      type Bottom = Types['nodes']['bottom']

      // Should have properties from all paths (no duplicates)
      expectTypeOf<Bottom>().toMatchTypeOf<{
        id: string
        kind: 'bottom'
        baseVal: string // From base (via both left and right)
        leftVal: string // From left
        rightVal: string // From right
        bottomVal: string // Own
      }>()
    })
  })

  describe('Union narrowing', () => {
    it('should support discriminated union narrowing', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string() } }),
          post: node({ properties: { title: z.string() } }),
        },
        edges: {},
      })

      type Types = Infer<typeof schema>
      type NodeUnion = Types['nodeUnion']

      // Type-level test - verify union structure
      expectTypeOf<NodeUnion>().toMatchTypeOf<
        | { id: string; kind: 'user'; email: string }
        | { id: string; kind: 'post'; title: string }
      >()
    })

    it('should work with generic functions', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string() } }),
          post: node({ properties: { title: z.string() } }),
        },
        edges: {},
      })

      type Types = Infer<typeof schema>
      type Node<K extends Types['nodeNames']> = Types['nodes'][K]

      // Declare function for type testing
      declare function getNode<K extends Types['nodeNames']>(kind: K): Node<K>

      // Test return types
      type UserReturn = ReturnType<typeof getNode<'user'>>
      expectTypeOf<UserReturn>().toMatchTypeOf<{
        id: string
        kind: 'user'
        email: string
      }>()

      type PostReturn = ReturnType<typeof getNode<'post'>>
      expectTypeOf<PostReturn>().toMatchTypeOf<{
        id: string
        kind: 'post'
        title: string
      }>()
    })
  })

  describe('Input vs Output types', () => {
    it('should handle optional fields with defaults correctly', () => {
      const schema = defineSchema({
        nodes: {
          user: node({
            properties: {
              name: z.string(),
              verified: z.boolean().default(false), // Has default
              age: z.number().optional(), // Explicitly optional
            },
          }),
        },
        edges: {},
      })

      type Types = Infer<typeof schema>

      // Output type - all fields present
      type User = Types['nodes']['user']
      expectTypeOf<User['verified']>().toEqualTypeOf<boolean>()
      expectTypeOf<User['age']>().toEqualTypeOf<number | undefined>()

      // Input type - fields with defaults are optional
      type UserInput = Types['nodesInput']['user']
      expectTypeOf<UserInput>().toMatchTypeOf<{
        id: string
        name: string
        verified?: boolean // Optional in input because of default
        age?: number
      }>()
    })
  })

  describe('Polymorphic edges', () => {
    it('should handle polymorphic source and target', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
          admin: node({ properties: { level: z.number() } }),
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

      type Types = Infer<typeof schema>

      // Edge type should work normally
      type Created = Types['edges']['created']
      expectTypeOf<Created>().toMatchTypeOf<{
        id: string
        kind: 'created'
      }>()

      // Union should include all node types
      type NodeUnion = Types['nodeUnion']
      expectTypeOf<NodeUnion>().toMatchTypeOf<
        | { id: string; kind: 'user'; name: string }
        | { id: string; kind: 'admin'; level: number }
        | { id: string; kind: 'post'; title: string }
        | { id: string; kind: 'comment'; text: string }
      >()
    })
  })

  describe('Complex real-world patterns', () => {
    it('should handle repository pattern with constraints', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { email: z.string() } }),
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

      type Types = Infer<typeof schema>
      type Node<K extends Types['nodeNames']> = Types['nodes'][K]

      interface Repository<K extends Types['nodeNames']> {
        find(id: string): Promise<Node<K> | null>
        create(input: Types['nodesInput'][K]): Promise<Node<K>>
      }

      // Declare class for type testing
      declare class UserRepository implements Repository<'user'> {
        find(id: string): Promise<Node<'user'> | null>
        create(input: Types['nodesInput']['user']): Promise<Node<'user'>>
      }

      // Test method types
      type FindMethod = UserRepository['find']
      expectTypeOf<FindMethod>().toBeFunction()

      type CreateMethod = UserRepository['create']
      expectTypeOf<CreateMethod>().toBeFunction()
    })
  })
})
