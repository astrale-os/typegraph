/**
 * Label Configuration Specification Tests
 *
 * These tests define the expected behavior of the universal :Node label feature:
 * - resolveNodeLabels() - resolves all labels for a node type
 * - formatLabels() - formats labels into Cypher syntax
 * - LabelConfig - schema-level configuration for base labels
 * - labels - per-node IS-A relationships (references to other node types)
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  node,
  defineSchema,
  resolveNodeLabels,
  formatLabels,
  DEFAULT_BASE_LABELS,
  getBaseLabelForIdLookup,
} from '../../src/schema'
import { CypherTemplates } from '../../src/mutation/cypher'

describe('Label Configuration Specification', () => {
  // ===========================================================================
  // RESOLVE NODE LABELS
  // ===========================================================================

  describe('resolveNodeLabels()', () => {
    it('includes default base label :Node', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'user')

      expect(labels).toContain('Node')
      expect(labels).toContain('User')
    })

    it('converts node label to PascalCase', () => {
      const schema = defineSchema({
        nodes: {
          userProfile: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'userProfile')

      expect(labels).toContain('UserProfile')
    })

    it('handles snake_case node labels', () => {
      const schema = defineSchema({
        nodes: {
          user_profile: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'user_profile')

      expect(labels).toContain('UserProfile')
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

      expect(labels).toEqual(['Node', 'Admin', 'Privileged', 'Auditable'])
    })

    it('uses custom base labels from schema config', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
        labels: {
          baseLabels: ['Entity', 'Auditable'],
        },
      })

      const labels = resolveNodeLabels(schema, 'user')

      expect(labels).toEqual(['Entity', 'Auditable', 'User'])
      expect(labels).not.toContain('Node')
    })

    it('excludes base labels when includeBaseLabels is false', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
        labels: {
          includeBaseLabels: false,
        },
      })

      const labels = resolveNodeLabels(schema, 'user')

      expect(labels).toEqual(['User'])
      expect(labels).not.toContain('Node')
    })

    it('maintains order: base labels, node label, IS-A labels', () => {
      const schema = defineSchema({
        nodes: {
          privileged: node({ properties: {} }),
          admin: node({
            properties: { name: z.string() },
            labels: ['privileged'],
          }),
        },
        edges: {},
        labels: {
          baseLabels: ['Entity'],
        },
      })

      const labels = resolveNodeLabels(schema, 'admin')

      expect(labels).toEqual(['Entity', 'Admin', 'Privileged'])
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
      expect(formatLabels(['Node', 'User'])).toBe(':Node:User')
    })

    it('formats many labels', () => {
      expect(formatLabels(['Node', 'User', 'Admin', 'Privileged'])).toBe(
        ':Node:User:Admin:Privileged',
      )
    })

    it('returns empty string for empty array', () => {
      expect(formatLabels([])).toBe('')
    })
  })

  // ===========================================================================
  // GET BASE LABEL FOR ID LOOKUP
  // ===========================================================================

  describe('getBaseLabelForIdLookup()', () => {
    it('returns :Node for default schema', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      expect(getBaseLabelForIdLookup(schema)).toBe(':Node')
    })

    it('returns first custom base label', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
        labels: {
          baseLabels: ['Entity', 'Auditable'],
        },
      })

      expect(getBaseLabelForIdLookup(schema)).toBe(':Entity')
    })

    it('returns empty string when includeBaseLabels is false', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
        labels: {
          includeBaseLabels: false,
        },
      })

      expect(getBaseLabelForIdLookup(schema)).toBe('')
    })

    it('returns empty string when schema is undefined', () => {
      expect(getBaseLabelForIdLookup(undefined)).toBe('')
    })

    it('returns empty string when baseLabels is empty array', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
        labels: {
          baseLabels: [],
        },
      })

      expect(getBaseLabelForIdLookup(schema)).toBe('')
    })
  })

  // ===========================================================================
  // DEFAULT BASE LABELS
  // ===========================================================================

  describe('DEFAULT_BASE_LABELS', () => {
    it('contains Node as the default', () => {
      expect(DEFAULT_BASE_LABELS).toContain('Node')
    })

    it('is a readonly array', () => {
      expect(DEFAULT_BASE_LABELS).toEqual(['Node'])
    })
  })

  // ===========================================================================
  // SCHEMA CONFIGURATION
  // ===========================================================================

  describe('Schema Label Configuration', () => {
    it('accepts labels config in schema definition', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
        labels: {
          baseLabels: ['Entity'],
          includeBaseLabels: true,
        },
      })

      expect(schema.labels).toBeDefined()
      expect(schema.labels?.baseLabels).toEqual(['Entity'])
      expect(schema.labels?.includeBaseLabels).toBe(true)
    })

    it('allows schema without labels config (uses defaults)', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      expect(schema.labels).toBeUndefined()

      // Should still work with defaults
      const labels = resolveNodeLabels(schema, 'user')
      expect(labels).toContain('Node')
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
      const query = CypherTemplates.node.create(['Node', 'User'])

      expect(query).toContain('CREATE (n:Node:User)')
      expect(query).toContain('SET n = $props, n.id = $id')
    })

    it('generates MATCH with multi-labels', () => {
      const query = CypherTemplates.node.update(['Node', 'User'])

      expect(query).toContain('MATCH (n:Node:User {id: $id})')
    })

    it('generates DELETE with multi-labels', () => {
      const query = CypherTemplates.node.delete(['Node', 'User'])

      expect(query).toContain('MATCH (n:Node:User {id: $id})')
      expect(query).toContain('DETACH DELETE n')
    })

    it('generates UPSERT with multi-labels', () => {
      const query = CypherTemplates.node.upsert(['Node', 'User'])

      expect(query).toContain('MERGE (n:Node:User {id: $id})')
    })

    it('generates CLONE with multi-labels', () => {
      const query = CypherTemplates.node.clone(['Node', 'User'])

      expect(query).toContain('MATCH (source:Node:User {id: $sourceId})')
      expect(query).toContain('CREATE (clone:Node:User)')
    })

    it('generates createChild with multi-labels', () => {
      const query = CypherTemplates.hierarchy.createChild(['Node', 'Folder'], 'hasParent')

      expect(query).toContain('CREATE (child:Node:Folder)')
    })

    it('generates batch createMany with multi-labels', () => {
      const query = CypherTemplates.batch.createMany(['Node', 'User'])

      expect(query).toContain('CREATE (n:Node:User)')
    })

    it('handles single label (backwards compatibility)', () => {
      const query = CypherTemplates.node.create(['User'])

      expect(query).toContain('CREATE (n:User)')
    })

    it('handles many labels', () => {
      const query = CypherTemplates.node.create(['Entity', 'Node', 'User', 'Admin', 'Privileged'])

      expect(query).toContain('CREATE (n:Entity:Node:User:Admin:Privileged)')
    })
  })

  // ===========================================================================
  // END-TO-END EXAMPLES
  // ===========================================================================

  describe('End-to-End Label Examples', () => {
    it('default schema creates :Node:User labels', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
      })

      const labels = resolveNodeLabels(schema, 'user')
      const labelStr = formatLabels(labels)

      expect(labelStr).toBe(':Node:User')
    })

    it('custom base labels create :Entity:Auditable:User labels', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
        labels: {
          baseLabels: ['Entity', 'Auditable'],
        },
      })

      const labels = resolveNodeLabels(schema, 'user')
      const labelStr = formatLabels(labels)

      expect(labelStr).toBe(':Entity:Auditable:User')
    })

    it('labels array creates :Node:Admin:Privileged labels', () => {
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

      expect(labelStr).toBe(':Node:Admin:Privileged')
    })

    it('opt-out creates :User labels only (backwards compat)', () => {
      const schema = defineSchema({
        nodes: {
          user: node({ properties: { name: z.string() } }),
        },
        edges: {},
        labels: {
          includeBaseLabels: false,
        },
      })

      const labels = resolveNodeLabels(schema, 'user')
      const labelStr = formatLabels(labels)

      expect(labelStr).toBe(':User')
    })
  })
})
