/**
 * Label Configuration Specification Tests
 *
 * These tests define the expected behavior of label resolution:
 * - resolveNodeLabels() - resolves all labels for a node type via transitive inheritance
 * - formatLabels() - formats labels into Cypher syntax
 * - labels - per-node IS-A relationships (references to other node types)
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
      const schema = defineSchema({
        nodes: {
          privileged: node({ properties: {} }),
          auditable: node({ properties: {} }),
          admin: node({
            properties: { name: z.string() },
            labels: ['privileged', 'auditable'],
          }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'admin')

      expect(labels).toEqual(['Admin', 'Privileged', 'Auditable'])
    })

    it('maintains order: node label, then IS-A labels (depth-first)', () => {
      const schema = defineSchema({
        nodes: {
          privileged: node({ properties: {} }),
          admin: node({
            properties: { name: z.string() },
            labels: ['privileged'],
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

  describe('Node labels Configuration', () => {
    it('accepts labels array in node definition', () => {
      const agentNode = node({
        properties: { name: z.string() },
        labels: ['module', 'identity'],
      })

      expect(agentNode.labels).toEqual(['module', 'identity'])
    })

    it('allows node without labels', () => {
      const userNode = node({
        properties: { name: z.string() },
      })

      expect(userNode.labels).toBeUndefined()
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
      const schema = defineSchema({
        nodes: {
          entity: node({ properties: {} }),
          admin: node({
            properties: { name: z.string() },
            labels: ['entity'],
          }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'admin')
      const labelStr = formatLabels(labels)

      expect(labelStr).toBe(':Admin:Entity')
    })

    it('labels array creates :Admin:Privileged labels', () => {
      const schema = defineSchema({
        nodes: {
          privileged: node({ properties: {} }),
          admin: node({
            properties: { name: z.string() },
            labels: ['privileged'],
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
      const schema = defineSchema({
        nodes: {
          entity: node({ properties: {} }),
          module: node({ properties: {}, labels: ['entity'] }),
          agent: node({ properties: {}, labels: ['module'] }),
        },
        edges: {},
      })
      // Depth-first: agent -> module -> entity
      expect(resolveNodeLabels(schema, 'agent')).toEqual(['Agent', 'Module', 'Entity'])
    })

    it('resolves 5-level deep chain without stack overflow', () => {
      const schema = defineSchema({
        nodes: {
          l5: node({ properties: {} }),
          l4: node({ properties: {}, labels: ['l5'] }),
          l3: node({ properties: {}, labels: ['l4'] }),
          l2: node({ properties: {}, labels: ['l3'] }),
          l1: node({ properties: {}, labels: ['l2'] }),
        },
        edges: {},
      })
      expect(resolveNodeLabels(schema, 'l1')).toEqual(['L1', 'L2', 'L3', 'L4', 'L5'])
    })

    it('maintains depth-first order with multiple labels', () => {
      // A labels [B, C], B labels [D] -> order is A, B, D, C (depth-first)
      const schema = defineSchema({
        nodes: {
          d: node({ properties: {} }),
          c: node({ properties: {} }),
          b: node({ properties: {}, labels: ['d'] }),
          a: node({ properties: {}, labels: ['b', 'c'] }),
        },
        edges: {},
      })
      expect(resolveNodeLabels(schema, 'a')).toEqual(['A', 'B', 'D', 'C'])
    })

    // === DEDUPLICATION ===

    it('deduplicates diamond inheritance (base appears once)', () => {
      const schema = defineSchema({
        nodes: {
          base: node({ properties: {} }),
          left: node({ properties: {}, labels: ['base'] }),
          right: node({ properties: {}, labels: ['base'] }),
          child: node({ properties: {}, labels: ['left', 'right'] }),
        },
        edges: {},
      })
      const labels = resolveNodeLabels(schema, 'child')
      expect(labels).toEqual(['Child', 'Left', 'Base', 'Right'])
      // Base NOT duplicated (Right's Base is already seen via Left)
    })

    // === ERROR CASES (schema definition time) ===

    it('throws on direct self-reference with cycle path', () => {
      expect(() =>
        defineSchema({
          nodes: { a: node({ properties: {}, labels: ['a'] }) },
          edges: {},
        }),
      ).toThrow(/[Cc]ircular.*a.*a/)
    })

    it('throws on indirect cycle with full path', () => {
      expect(() =>
        defineSchema({
          nodes: {
            a: node({ properties: {}, labels: ['b'] }),
            b: node({ properties: {}, labels: ['c'] }),
            c: node({ properties: {}, labels: ['a'] }),
          },
          edges: {},
        }),
      ).toThrow(/[Cc]ircular.*a.*b.*c.*a/)
    })

    it('throws on unknown label reference with available labels', () => {
      expect(() =>
        defineSchema({
          nodes: {
            user: node({ properties: {}, labels: ['nonexistent'] }),
            entity: node({ properties: {} }),
          },
          edges: {},
        }),
      ).toThrow(/nonexistent/)
    })

    // === EDGE CASES ===

    it('handles empty labels array (no inheritance)', () => {
      const schema = defineSchema({
        nodes: { user: node({ properties: {}, labels: [] }) },
        edges: {},
      })
      expect(resolveNodeLabels(schema, 'user')).toEqual(['User'])
    })

    it('handles node without labels property', () => {
      const schema = defineSchema({
        nodes: { user: node({ properties: {} }) },
        edges: {},
      })
      expect(resolveNodeLabels(schema, 'user')).toEqual(['User'])
    })

    // === getNodesSatisfying ===

    it('getNodesSatisfying returns all transitive satisfiers', () => {
      const schema = defineSchema({
        nodes: {
          entity: node({ properties: {} }),
          module: node({ properties: {}, labels: ['entity'] }),
          agent: node({ properties: {}, labels: ['module'] }),
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
        nodes: { user: node({ properties: {}, labels: [] }) },
        edges: {},
      })
      const schema2 = defineSchema({
        nodes: {
          entity: node({ properties: {} }),
          user: node({ properties: {}, labels: ['entity'] }),
        },
        edges: {},
      })
      expect(resolveNodeLabels(schema1, 'user')).toEqual(['User'])
      expect(resolveNodeLabels(schema2, 'user')).toEqual(['User', 'Entity'])
    })
  })
})
