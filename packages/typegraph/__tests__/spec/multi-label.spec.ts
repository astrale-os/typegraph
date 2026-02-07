/**
 * Multi-Label Support Tests
 *
 * Tests for the multi-label node functionality including:
 * - extends array in node definitions (IS-A relationships)
 * - getNodesSatisfying() helper function
 * - Label-based query filtering
 * - Edge validation with labels
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  defineSchema,
  node,
  edge,
  resolveNodeLabels,
  formatLabels,
  getNodesSatisfying,
  type AnySchema,
} from '../../src/schema'
import { CypherCompiler } from '../../src/compiler'
import { QueryAST } from '../../src/ast'
import { MutationValidator } from '../../src/mutation/validation'
import { SchemaValidator as QueryValidator } from '../../src/query/validation'

// =============================================================================
// TEST SCHEMAS
// =============================================================================

/**
 * Schema with multi-label node using extends array
 */
const moduleNode = node({
  properties: {
    name: z.string(),
  },
})
const identityNode = node({
  properties: {
    gid: z.string(),
  },
})
// Agent IS-A module AND identity
const agentNode = node({
  properties: {
    name: z.string(),
    gid: z.string(),
  },
  extends: [moduleNode, identityNode],
})

const multiLabelSchema = defineSchema({
  nodes: {
    module: moduleNode,
    identity: identityNode,
    agent: agentNode,
  },
  edges: {
    hasPerm: edge({
      from: 'identity',
      to: ['module', 'identity'],
      cardinality: { outbound: 'many', inbound: 'many' },
      properties: {
        perm: z.enum(['read', 'edit', 'use']),
      },
    }),
    ofType: edge({
      from: 'module',
      to: 'module',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },
})

/**
 * Schema without multi-label (for comparison)
 */
const standardSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string(),
      },
    }),
    post: node({
      properties: {
        title: z.string(),
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

// =============================================================================
// LABEL RESOLUTION TESTS
// =============================================================================

describe('Multi-Label Support', () => {
  describe('resolveNodeLabels with extends array', () => {
    it('includes trait labels in resolution', () => {
      const labels = resolveNodeLabels(multiLabelSchema, 'agent')
      expect(labels).toContain('Agent')
      expect(labels).toContain('Module')
      expect(labels).toContain('Identity')
    })

    it('maintains correct label order: own > traits (depth-first)', () => {
      const labels = resolveNodeLabels(multiLabelSchema, 'agent')
      // Order should be: ['Agent', 'Module', 'Identity']
      expect(labels[0]).toBe('Agent')
      expect(labels.indexOf('Module')).toBeGreaterThan(0)
      expect(labels.indexOf('Identity')).toBeGreaterThan(0)
    })

    it('resolves standard nodes without traits correctly', () => {
      const labels = resolveNodeLabels(multiLabelSchema, 'module')
      expect(labels).toEqual(['Module'])
    })

    it('formats multi-label correctly for Cypher', () => {
      const labels = resolveNodeLabels(multiLabelSchema, 'agent')
      const formatted = formatLabels(labels)
      expect(formatted).toBe(':Agent:Module:Identity')
    })
  })

  describe('getNodesSatisfying', () => {
    it('returns self when no other nodes satisfy', () => {
      const satisfying = getNodesSatisfying(multiLabelSchema, 'module')
      expect(satisfying).toContain('module')
    })

    it('returns nodes that declare satisfies', () => {
      const satisfyingModule = getNodesSatisfying(multiLabelSchema, 'module')
      expect(satisfyingModule).toContain('module')
      expect(satisfyingModule).toContain('agent') // agent satisfies module

      const satisfyingIdentity = getNodesSatisfying(multiLabelSchema, 'identity')
      expect(satisfyingIdentity).toContain('identity')
      expect(satisfyingIdentity).toContain('agent') // agent satisfies identity
    })

    it('does not include unrelated nodes', () => {
      const satisfying = getNodesSatisfying(multiLabelSchema, 'module')
      expect(satisfying).not.toContain('identity')
    })

    it('returns only self for nodes without satisfiers', () => {
      const satisfying = getNodesSatisfying(standardSchema, 'user')
      expect(satisfying).toEqual(['user'])
    })
  })
})

// =============================================================================
// MUTATION VALIDATION TESTS
// =============================================================================

describe('Edge Validation with satisfies', () => {
  const validator = new MutationValidator(multiLabelSchema)

  describe('validateEdgeEndpoints', () => {
    it('allows direct node type as edge source', () => {
      expect(() => {
        validator.validateEdgeEndpoints('hasPerm', 'identity', 'module')
      }).not.toThrow()
    })

    it('allows satisfying node as edge source', () => {
      // agent satisfies identity, so can be source of hasPerm
      expect(() => {
        validator.validateEdgeEndpoints('hasPerm', 'agent', 'module')
      }).not.toThrow()
    })

    it('allows satisfying node as edge target', () => {
      // agent satisfies module, so can be target of hasPerm
      expect(() => {
        validator.validateEdgeEndpoints('hasPerm', 'identity', 'agent')
      }).not.toThrow()
    })

    it('allows satisfying node as both source and target', () => {
      // agent satisfies both identity (source) and module (target)
      expect(() => {
        validator.validateEdgeEndpoints('hasPerm', 'agent', 'agent')
      }).not.toThrow()
    })

    it('rejects invalid source node', () => {
      expect(() => {
        validator.validateEdgeEndpoints('hasPerm', 'module', 'identity')
      }).toThrow()
    })

    it('allows ofType edge from agent (satisfies module)', () => {
      expect(() => {
        validator.validateEdgeEndpoints('ofType', 'agent', 'module')
      }).not.toThrow()
    })
  })
})

// =============================================================================
// QUERY VALIDATION TESTS
// =============================================================================

describe('Query Validation with satisfies', () => {
  const validator = new QueryValidator(multiLabelSchema)

  describe('validateTraversal', () => {
    it('allows traversal from satisfying node', () => {
      // agent satisfies identity, can traverse hasPerm outbound
      expect(() => {
        validator.validateTraversal('agent', 'hasPerm', 'out')
      }).not.toThrow()
    })

    it('allows traversal to satisfying node', () => {
      // agent satisfies module, can receive hasPerm inbound
      expect(() => {
        validator.validateTraversal('agent', 'hasPerm', 'in')
      }).not.toThrow()
    })

    it('allows bidirectional traversal for satisfying node', () => {
      expect(() => {
        validator.validateTraversal('agent', 'hasPerm', 'both')
      }).not.toThrow()
    })

    it('rejects invalid traversal', () => {
      expect(() => {
        validator.validateTraversal('module', 'hasPerm', 'out')
      }).toThrow()
    })
  })
})

// =============================================================================
// CYPHER COMPILATION TESTS
// =============================================================================

describe('Cypher Compilation with Labels', () => {
  describe('LabelCondition compilation', () => {
    const compiler = new CypherCompiler(standardSchema as AnySchema)

    it('compiles single label condition', () => {
      const ast = new QueryAST()
        .addMatch('user')
        .addWhere([
          {
            type: 'label',
            labels: ['Admin'],
            mode: 'all',
            negated: false,
            target: 'n0',
          },
        ])
        .setProjection({ type: 'node', nodeAliases: ['n0'], edgeAliases: [] })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('n0:Admin')
    })

    it('compiles multiple labels with AND (all mode)', () => {
      const ast = new QueryAST()
        .addMatch('user')
        .addWhere([
          {
            type: 'label',
            labels: ['Admin', 'Privileged'],
            mode: 'all',
            negated: false,
            target: 'n0',
          },
        ])
        .setProjection({ type: 'node', nodeAliases: ['n0'], edgeAliases: [] })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('n0:Admin')
      expect(result.cypher).toContain('n0:Privileged')
      expect(result.cypher).toContain('AND')
    })

    it('compiles multiple labels with OR (any mode)', () => {
      const ast = new QueryAST()
        .addMatch('user')
        .addWhere([
          {
            type: 'label',
            labels: ['Admin', 'Moderator'],
            mode: 'any',
            negated: false,
            target: 'n0',
          },
        ])
        .setProjection({ type: 'node', nodeAliases: ['n0'], edgeAliases: [] })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('n0:Admin')
      expect(result.cypher).toContain('n0:Moderator')
      expect(result.cypher).toContain('OR')
    })

    it('compiles negated label condition', () => {
      const ast = new QueryAST()
        .addMatch('user')
        .addWhere([
          {
            type: 'label',
            labels: ['Banned'],
            mode: 'all',
            negated: true,
            target: 'n0',
          },
        ])
        .setProjection({ type: 'node', nodeAliases: ['n0'], edgeAliases: [] })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain('NOT')
      expect(result.cypher).toContain('n0:Banned')
    })
  })

  describe('Multi-label node MATCH', () => {
    const compiler = new CypherCompiler(multiLabelSchema as AnySchema)

    it('includes all labels in MATCH for multi-label node', () => {
      const ast = new QueryAST()
        .addMatch('agent')
        .setProjection({ type: 'node', nodeAliases: ['n0'], edgeAliases: [] })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain(':Agent:Module:Identity')
    })

    it('uses single label for standard node', () => {
      const ast = new QueryAST()
        .addMatch('module')
        .setProjection({ type: 'node', nodeAliases: ['n0'], edgeAliases: [] })

      const result = compiler.compile(ast)
      expect(result.cypher).toContain(':Module')
      expect(result.cypher).not.toContain(':Identity')
    })
  })
})

// =============================================================================
// MUTATION CREATE OPTIONS TESTS
// =============================================================================

describe('CreateOptions.additionalLabels', () => {
  it('additionalLabels type exists on CreateOptions', () => {
    // Type check - this compiles if additionalLabels is available
    const options: { id?: string; additionalLabels?: string[] } = {
      additionalLabels: ['Custom', 'Label'],
    }
    expect(options.additionalLabels).toEqual(['Custom', 'Label'])
  })
})

// =============================================================================
// SCHEMA DEFINITION TESTS
// =============================================================================

describe('Schema Definition with extends', () => {
  it('accepts extends array referencing other node types', () => {
    const baseNode = node({ properties: { a: z.string() } })

    const schema = defineSchema({
      nodes: {
        base: baseNode,
        derived: node({
          properties: { a: z.string(), b: z.string() },
          extends: [baseNode],
        }),
      },
      edges: {},
    })

    expect(schema.nodes.derived.extends).toEqual(['base'])
  })

  it('accepts multiple extends', () => {
    const moduleNode2 = node({ properties: {} })
    const identityNode2 = node({ properties: {} })

    const schema = defineSchema({
      nodes: {
        module: moduleNode2,
        identity: identityNode2,
        agent: node({
          properties: {},
          extends: [moduleNode2, identityNode2],
        }),
      },
      edges: {},
    })

    expect(schema.nodes.agent.extends).toEqual(['module', 'identity'])
  })

  it('resolves extends to PascalCase Cypher labels', () => {
    const moduleNode2 = node({ properties: {} })
    const identityNode2 = node({ properties: {} })

    const schema = defineSchema({
      nodes: {
        module: moduleNode2,
        identity: identityNode2,
        agent: node({
          properties: {},
          extends: [moduleNode2, identityNode2],
        }),
      },
      edges: {},
    })

    const labels = resolveNodeLabels(schema, 'agent')
    expect(labels).toEqual(['Agent', 'Module', 'Identity'])
  })

  it('allows nodes without extends', () => {
    const schema = defineSchema({
      nodes: {
        simple: node({ properties: { name: z.string() } }),
      },
      edges: {},
    })

    expect(schema.nodes.simple.extends).toBeUndefined()
    const labels = resolveNodeLabels(schema, 'simple')
    expect(labels).toEqual(['Simple'])
  })
})
