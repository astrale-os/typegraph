/**
 * Label Configuration Specification Tests
 *
 * These tests define the expected behavior of label resolution:
 * - resolveNodeLabels() - resolves all labels for a node type via transitive inheritance
 * - formatLabels() - formats labels into Cypher syntax
 * - extends - per-node IS-A relationships (references to other node definitions)
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  node,
  defineSchema,
  resolveNodeLabels,
  formatLabels,
  getNodesSatisfying,
} from '../../src/schema'
import { CypherTemplates } from '../../src/mutation/cypher'

describe('Label Configuration Specification', () => {
  // ===========================================================================
  // RESOLVE NODE LABELS
  // ===========================================================================

  describe('resolveNodeLabels()', () => {
    it('returns node label in PascalCase', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'user')

      expect(labels).toEqual(['User'])
    })

    it('converts camelCase node label to PascalCase', () => {
      const schema = defineSchema({
        nodes: {
          userProfile: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'userProfile')

      expect(labels).toEqual(['UserProfile'])
    })

    it('handles snake_case node labels', () => {
      const schema = defineSchema({
        nodes: {
          user_profile: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'user_profile')

      expect(labels).toEqual(['UserProfile'])
    })

    it('includes labels from referenced node types', () => {
      const privilegedNode = node({ properties: {} })
      const auditableNode = node({ properties: {} })

      const schema = defineSchema({
        nodes: {
          privileged: privilegedNode,
          auditable: auditableNode,
          admin: node({
            properties: { name: z.string() },
            extends: [privilegedNode, auditableNode],
          }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'admin')

      expect(labels).toEqual(['Admin', 'Privileged', 'Auditable'])
    })

    it('maintains order: node label, then IS-A labels (depth-first)', () => {
      const privilegedNode = node({ properties: {} })

      const schema = defineSchema({
        nodes: {
          privileged: privilegedNode,
          admin: node({
            properties: { name: z.string() },
            extends: [privilegedNode],
          }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'admin')

      expect(labels).toEqual(['Admin', 'Privileged'])
    })
  })

  // ===========================================================================
  // FORMAT LABELS
  // ===========================================================================

  describe('formatLabels()', () => {
    it('formats single label', () => {
      expect(formatLabels(['User'])).toBe(':User')
    })

    it('formats multiple labels', () => {
      expect(formatLabels(['User', 'Entity'])).toBe(':User:Entity')
    })

    it('formats many labels', () => {
      expect(formatLabels(['User', 'Admin', 'Privileged', 'Entity'])).toBe(
        ':User:Admin:Privileged:Entity',
      )
    })

    it('returns empty string for empty array', () => {
      expect(formatLabels([])).toBe('')
    })
  })

  // ===========================================================================
  // NODE CONFIGURATION
  // ===========================================================================

  describe('Node extends Configuration', () => {
    it('accepts extends array in node definition', () => {
      const moduleNode = node({ properties: {} })
      const identityNode = node({ properties: {} })

      const agentNode = node({
        properties: { name: z.string() },
        extends: [moduleNode, identityNode],
      })

      expect(agentNode._extendsRefs).toEqual([moduleNode, identityNode])
    })

    it('allows node without extends', () => {
      const userNode = node({
        properties: { name: z.string() },
      })

      expect(userNode.extends).toBeUndefined()
    })
  })

  // ===========================================================================
  // CYPHER TEMPLATE OUTPUT
  // ===========================================================================

  describe('Cypher Templates with Labels', () => {
    it('generates CREATE with multi-labels', () => {
      const query = CypherTemplates.node.create(['User', 'Entity'])

      expect(query).toContain('CREATE (n:User:Entity)')
      expect(query).toContain('SET n = $props, n.id = $id')
    })

    it('generates MATCH with multi-labels', () => {
      const query = CypherTemplates.node.update(['User', 'Entity'])

      expect(query).toContain('MATCH (n:User:Entity {id: $id})')
    })

    it('generates DELETE with multi-labels', () => {
      const query = CypherTemplates.node.delete(['User', 'Entity'])

      expect(query).toContain('MATCH (n:User:Entity {id: $id})')
      expect(query).toContain('DETACH DELETE n')
    })

    it('generates UPSERT with multi-labels', () => {
      const query = CypherTemplates.node.upsert(['User', 'Entity'])

      expect(query).toContain('MERGE (n:User:Entity {id: $id})')
    })

    it('generates CLONE with multi-labels', () => {
      const query = CypherTemplates.node.clone(['User', 'Entity'])

      expect(query).toContain('MATCH (source:User:Entity {id: $sourceId})')
      expect(query).toContain('CREATE (clone:User:Entity)')
    })

    it('generates createChild with multi-labels', () => {
      const query = CypherTemplates.hierarchy.createChild(['Folder', 'Entity'], 'hasParent')

      expect(query).toContain('CREATE (child:Folder:Entity)')
    })

    it('generates batch createMany with multi-labels', () => {
      const query = CypherTemplates.batch.createMany(['User', 'Entity'])

      expect(query).toContain('CREATE (n:User:Entity)')
    })

    it('handles single label', () => {
      const query = CypherTemplates.node.create(['User'])

      expect(query).toContain('CREATE (n:User)')
    })

    it('handles many labels', () => {
      const query = CypherTemplates.node.create(['User', 'Admin', 'Privileged', 'Entity'])

      expect(query).toContain('CREATE (n:User:Admin:Privileged:Entity)')
    })
  })

  // ===========================================================================
  // END-TO-END EXAMPLES
  // ===========================================================================

  describe('End-to-End Label Examples', () => {
    it('simple node creates :User labels', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'user')
      const labelStr = formatLabels(labels)

      expect(labelStr).toBe(':User')
    })

    it('node with explicit base creates :Admin:Entity labels', () => {
      const entityNode = node({ properties: {} })

      const schema = defineSchema({
        nodes: {
          entity: entityNode,
          admin: node({
            properties: { name: z.string() },
            extends: [entityNode],
          }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'admin')
      const labelStr = formatLabels(labels)

      expect(labelStr).toBe(':Admin:Entity')
    })

    it('extends array creates :Admin:Privileged labels', () => {
      const privilegedNode = node({ properties: {} })

      const schema = defineSchema({
        nodes: {
          privileged: privilegedNode,
          admin: node({
            properties: { name: z.string() },
            extends: [privilegedNode],
          }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'admin')
      const labelStr = formatLabels(labels)

      expect(labelStr).toBe(':Admin:Privileged')
    })
  })

  // ===========================================================================
  // TRANSITIVE LABEL INHERITANCE
  // ===========================================================================

  describe('Transitive Label Inheritance', () => {
    // === CORE TRANSITIVE BEHAVIOR ===

    it('resolves two-level transitive chain with exact order', () => {
      const entityNode = node({ properties: {} })
      const moduleNode = node({ properties: {}, extends: [entityNode] })
      const agentNode = node({ properties: {}, extends: [moduleNode] })

      const schema = defineSchema({
        nodes: {
          entity: entityNode,
          module: moduleNode,
          agent: agentNode,
        },
        edges: {},
      })
      // Depth-first: agent -> module -> entity
      expect(resolveNodeLabels(schema, 'agent')).toEqual(['Agent', 'Module', 'Entity'])
    })

    it('resolves 5-level deep chain without stack overflow', () => {
      const l5Node = node({ properties: {} })
      const l4Node = node({ properties: {}, extends: [l5Node] })
      const l3Node = node({ properties: {}, extends: [l4Node] })
      const l2Node = node({ properties: {}, extends: [l3Node] })
      const l1Node = node({ properties: {}, extends: [l2Node] })

      const schema = defineSchema({
        nodes: {
          l5: l5Node,
          l4: l4Node,
          l3: l3Node,
          l2: l2Node,
          l1: l1Node,
        },
        edges: {},
      })
      expect(resolveNodeLabels(schema, 'l1')).toEqual(['L1', 'L2', 'L3', 'L4', 'L5'])
    })

    it('maintains depth-first order with multiple labels', () => {
      // A extends [B, C], B extends [D] -> order is A, B, D, C (depth-first)
      const dNode = node({ properties: {} })
      const cNode = node({ properties: {} })
      const bNode = node({ properties: {}, extends: [dNode] })
      const aNode = node({ properties: {}, extends: [bNode, cNode] })

      const schema = defineSchema({
        nodes: {
          d: dNode,
          c: cNode,
          b: bNode,
          a: aNode,
        },
        edges: {},
      })
      expect(resolveNodeLabels(schema, 'a')).toEqual(['A', 'B', 'D', 'C'])
    })

    // === DEDUPLICATION ===

    it('deduplicates diamond inheritance (base appears once)', () => {
      const baseNode = node({ properties: {} })
      const leftNode = node({ properties: {}, extends: [baseNode] })
      const rightNode = node({ properties: {}, extends: [baseNode] })
      const childNode = node({ properties: {}, extends: [leftNode, rightNode] })

      const schema = defineSchema({
        nodes: {
          base: baseNode,
          left: leftNode,
          right: rightNode,
          child: childNode,
        },
        edges: {},
      })
      const labels = resolveNodeLabels(schema, 'child')
      expect(labels).toEqual(['Child', 'Left', 'Base', 'Right'])
      // Base NOT duplicated (Right's Base is already seen via Left)
    })

    // === ERROR CASES (schema definition time) ===

    it('throws on direct self-reference with cycle path', () => {
      const aNode = node({ properties: {} })
      // Manually set _extendsRefs to self to create a self-reference
      ;(aNode as any)._extendsRefs = [aNode]
      expect(() =>
        defineSchema({
          nodes: { a: aNode },
          edges: {},
        }),
      ).toThrow(/[Cc]ircular.*a.*a/)
    })

    it('throws on indirect cycle with full path', () => {
      const aNode = node({ properties: {} })
      const bNode = node({ properties: {} })
      const cNode = node({ properties: {} })
      // Create cycle: a -> b -> c -> a
      ;(aNode as any)._extendsRefs = [bNode]
      ;(bNode as any)._extendsRefs = [cNode]
      ;(cNode as any)._extendsRefs = [aNode]

      expect(() =>
        defineSchema({
          nodes: {
            a: aNode,
            b: bNode,
            c: cNode,
          },
          edges: {},
        }),
      ).toThrow(/[Cc]ircular.*a.*b.*c.*a/)
    })

    it('throws on unknown label reference with available labels', () => {
      const unknownRef = node({ properties: {} })
      const userNode = node({ properties: {}, extends: [unknownRef] })

      expect(() =>
        defineSchema({
          nodes: {
            user: userNode,
            entity: node({ properties: {} }),
          },
          edges: {},
        }),
      ).toThrow()
    })

    // === EDGE CASES ===

    it('handles node without extends (no inheritance)', () => {
      const schema = defineSchema({
        nodes: { user: node({ properties: {} }) },
        edges: {},
      })
      expect(resolveNodeLabels(schema, 'user')).toEqual(['User'])
    })

    it('handles node without extends property', () => {
      const schema = defineSchema({
        nodes: { user: node({ properties: {} }) },
        edges: {},
      })
      expect(resolveNodeLabels(schema, 'user')).toEqual(['User'])
    })

    // === getNodesSatisfying ===

    it('getNodesSatisfying returns all transitive satisfiers', () => {
      const entityNode = node({ properties: {} })
      const moduleNode = node({ properties: {}, extends: [entityNode] })
      const agentNode = node({ properties: {}, extends: [moduleNode] })

      const schema = defineSchema({
        nodes: {
          entity: entityNode,
          module: moduleNode,
          agent: agentNode,
          unrelated: node({ properties: {} }),
        },
        edges: {},
      })
      const satisfying = getNodesSatisfying(schema, 'entity')
      expect(satisfying).toEqual(expect.arrayContaining(['entity', 'module', 'agent']))
      expect(satisfying).not.toContain('unrelated')
      expect(satisfying).toHaveLength(3)
    })

    it('getNodesSatisfying returns only self when no satisfiers', () => {
      const schema = defineSchema({
        nodes: { isolated: node({ properties: {} }) },
        edges: {},
      })
      expect(getNodesSatisfying(schema, 'isolated')).toEqual(['isolated'])
    })

    // === MEMOIZATION ===

    it('memoization returns fresh copy (mutation-safe)', () => {
      const schema = defineSchema({
        nodes: { user: node({ properties: {} }) },
        edges: {},
      })
      const labels1 = resolveNodeLabels(schema, 'user')
      labels1.push('MUTATED')
      const labels2 = resolveNodeLabels(schema, 'user')
      expect(labels2).toEqual(['User'])
    })

    it('memoization is isolated between schemas', () => {
      const schema1 = defineSchema({
        nodes: { user: node({ properties: {} }) },
        edges: {},
      })
      const entityNode = node({ properties: {} })
      const schema2 = defineSchema({
        nodes: {
          entity: entityNode,
          user: node({ properties: {}, extends: [entityNode] }),
        },
        edges: {},
      })
      expect(resolveNodeLabels(schema1, 'user')).toEqual(['User'])
      expect(resolveNodeLabels(schema2, 'user')).toEqual(['User', 'Entity'])
    })
  })
})
