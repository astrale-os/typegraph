/**
 * InstanceModelPass Specification Tests
 *
 * Tests for the type-instance lowering pass that rewrites label-based
 * matching into structural instance_of joins.
 */

import { describe, it, expect } from 'vitest'

import type { SchemaShape } from '../../src/schema'

import { QueryAST } from '../../src/query/ast'
import { CypherCompiler } from '../../src/query/compiler/cypher/compiler'
import { InstanceModelPass } from '../../src/query/compiler/passes/instance-model-pass'
import { ClassId, InterfaceId } from '../../src/schema'
import { normalizeCypher } from './fixtures/test-schema'

// =============================================================================
// TEST SCHEMA WITH INSTANCE MODEL
// =============================================================================

const schema: SchemaShape = {
  nodes: {
    user: { abstract: false, attributes: ['email', 'name'], implements: ['timestamped'] },
    post: { abstract: false, implements: ['timestamped', 'printable'], attributes: ['title'] },
    comment: { abstract: false, implements: ['timestamped'], attributes: ['content'] },
    category: { abstract: false, attributes: ['name'] },
    timestamped: { abstract: true, attributes: ['createdAt'] },
    printable: { abstract: true },
  },
  edges: {
    authored: {
      endpoints: {
        user: { types: ['user'] },
        post: { types: ['post'] },
      },
    },
    commentedOn: {
      endpoints: {
        comment: { types: ['comment'], cardinality: { min: 1, max: 1 } },
        post: { types: ['post'] },
      },
    },
  },
  classRefs: {
    user: ClassId('cls-user'),
    post: ClassId('cls-post'),
    comment: ClassId('cls-comment'),
    category: ClassId('cls-category'),
    timestamped: InterfaceId('iface-timestamped'),
    printable: InterfaceId('iface-printable'),
  },
}

function compile(ast: QueryAST): { cypher: string; params: Record<string, unknown> } {
  const compiler = new CypherCompiler(schema)
  return compiler.compile(ast, schema)
}

// =============================================================================
// TESTS
// =============================================================================

describe('InstanceModelPass', () => {
  const pass = new InstanceModelPass()

  describe('MatchStep — concrete class', () => {
    it('rewrites label to :Node + instance_of join', () => {
      // graph.node('user')
      const ast = new QueryAST().addMatch('user')
      const transformed = pass.transform(ast, schema)
      const result = compile(transformed)

      expect(normalizeCypher(result.cypher)).toContain('MATCH (n0:Node)')
      expect(normalizeCypher(result.cypher)).toContain('[:instance_of]')
      expect(normalizeCypher(result.cypher)).toContain('cls0:Node:Class')
      expect(Object.values(result.params)).toContain('cls-user')
    })

    it('uses exact class ID for concrete type', () => {
      const ast = new QueryAST().addMatch('post')
      const transformed = pass.transform(ast, schema)
      const result = compile(transformed)

      expect(Object.values(result.params)).toContain('cls-post')
    })
  })

  describe('MatchStep — interface (polymorphic)', () => {
    it('rewrites interface match to IN check on implementor IDs', () => {
      const ast = new QueryAST().addMatch('timestamped')
      const transformed = pass.transform(ast, schema)
      const result = compile(transformed)

      expect(normalizeCypher(result.cypher)).toContain('MATCH (n0:Node)')
      expect(normalizeCypher(result.cypher)).toContain('[:instance_of]')
      // Should use IN for multiple implementors
      const paramValues = Object.values(result.params)
      const implIds = paramValues.find((v) => Array.isArray(v) && v.includes('cls-user'))
      expect(implIds).toBeTruthy()
    })

    it('uses eq for single implementor', () => {
      const ast = new QueryAST().addMatch('printable')
      const transformed = pass.transform(ast, schema)
      const result = compile(transformed)

      // printable only has one implementor (cls-post)
      expect(Object.values(result.params)).toContain('cls-post')
    })
  })

  describe('MatchByIdStep', () => {
    it('does not add instance_of join', () => {
      const ast = new QueryAST().addMatchById('user-123')
      const transformed = pass.transform(ast, schema)
      const result = compile(transformed)

      expect(normalizeCypher(result.cypher)).not.toContain('instance_of')
      expect(normalizeCypher(result.cypher)).toContain('{id: $p0}')
    })
  })

  describe('TraversalStep.toLabels', () => {
    it('rewrites target labels to :Node + instance_of', () => {
      const ast = new QueryAST().addMatch('user').addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: ['post'],
        cardinality: 'many',
      })
      const transformed = pass.transform(ast, schema)
      const result = compile(transformed)

      // Should have two instance_of joins: one for user, one for post
      const cypher = normalizeCypher(result.cypher)
      const instanceOfCount = (cypher.match(/instance_of/g) || []).length
      expect(instanceOfCount).toBe(2)
    })

    it('does not rewrite empty toLabels', () => {
      const ast = new QueryAST().addMatch('user').addTraversal({
        edges: ['authored'],
        direction: 'out',
        toLabels: [],
        cardinality: 'many',
      })
      const transformed = pass.transform(ast, schema)
      const result = compile(transformed)

      // Only one instance_of (for the match)
      const cypher = normalizeCypher(result.cypher)
      const instanceOfCount = (cypher.match(/instance_of/g) || []).length
      expect(instanceOfCount).toBe(1)
    })
  })

  describe('no-op when disabled', () => {
    it('returns AST unchanged when classRefs is absent', () => {
      const schemaNoRefs: SchemaShape = {
        nodes: schema.nodes,
        edges: schema.edges,
      }
      const ast = new QueryAST().addMatch('user')
      const transformed = pass.transform(ast, schemaNoRefs)

      expect(transformed.steps).toEqual(ast.steps)
    })
  })

  describe('error handling', () => {
    it('throws on unknown type', () => {
      const ast = new QueryAST().addMatch('nonexistent')
      expect(() => pass.transform(ast, schema)).toThrow("unknown type 'nonexistent'")
    })

    it('throws on missing ref', () => {
      const schemaEmptyRefs: SchemaShape = {
        ...schema,
        classRefs: {},
      }
      const ast = new QueryAST().addMatch('user')
      expect(() => pass.transform(ast, schemaEmptyRefs)).toThrow("no ref found for type 'user'")
    })
  })

  // ===========================================================================
  // PatternStep — concrete class nodes
  // ===========================================================================

  describe('PatternStep — concrete class nodes', () => {
    it('rewrites typed node labels to :Node and adds instance_of edges + class nodes', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'u', labels: ['user'] },
          { alias: 'p', labels: ['post'] },
        ],
        edges: [{ from: 'u', to: 'p', types: ['authored'], direction: 'out', optional: false }],
      })
      const transformed = pass.transform(ast, schema)
      const result = compile(transformed)
      const cypher = normalizeCypher(result.cypher)

      expect(cypher).toContain(':Node')
      expect(cypher).toContain('instance_of')
      expect(Object.values(result.params)).toContain('cls-user')
      expect(Object.values(result.params)).toContain('cls-post')
    })

    it('does not rewrite nodes without labels', () => {
      const ast = new QueryAST().addPattern({
        nodes: [{ alias: 'a' }, { alias: 'b', labels: ['user'] }],
        edges: [{ from: 'a', to: 'b', types: ['authored'], direction: 'out', optional: false }],
      })
      const transformed = pass.transform(ast, schema)
      const patternStep = transformed.steps[0] as any

      // Node 'a' should have no labels (unchanged)
      const nodeA = patternStep.nodes.find((n: any) => n.alias === 'a')
      expect(nodeA.labels).toBeUndefined()

      // Node 'b' should be rewritten
      const nodeB = patternStep.nodes.find((n: any) => n.alias === 'b')
      expect(nodeB.labels).toEqual(['Node'])
    })

    it('does not rewrite nodes already using meta-labels', () => {
      const ast = new QueryAST().addPattern({
        nodes: [{ alias: 'n', labels: ['Node'] }],
        edges: [],
      })
      const transformed = pass.transform(ast, schema)
      const patternStep = transformed.steps[0] as any

      // Should have exactly 1 node (no class node added)
      expect(patternStep.nodes).toHaveLength(1)
      expect(patternStep.edges).toHaveLength(0)
    })
  })

  // ===========================================================================
  // PatternStep — interface (polymorphic) nodes
  // ===========================================================================

  describe('PatternStep — interface nodes', () => {
    it('rewrites interface node with IN check on implementor IDs', () => {
      const ast = new QueryAST().addPattern({
        nodes: [{ alias: 't', labels: ['timestamped'] }],
        edges: [],
      })
      const transformed = pass.transform(ast, schema)
      const result = compile(transformed)

      // Should have an array param with implementor class IDs
      const paramValues = Object.values(result.params)
      const implIds = paramValues.find((v) => Array.isArray(v) && v.includes('cls-user'))
      expect(implIds).toBeTruthy()
    })
  })

  // ===========================================================================
  // PatternStep — instance_of optionality
  // ===========================================================================

  describe('PatternStep — instance_of optionality', () => {
    it('instance_of edge is required when node is in a required edge', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'u', labels: ['user'] },
          { alias: 'p', labels: ['post'] },
        ],
        edges: [{ from: 'u', to: 'p', types: ['authored'], direction: 'out', optional: false }],
      })
      const transformed = pass.transform(ast, schema)
      const patternStep = transformed.steps[0] as any

      // Both u and p are in a required edge → instance_of edges should be required
      const instanceOfEdges = patternStep.edges.filter((e: any) => e.types.includes('instance_of'))
      expect(instanceOfEdges.length).toBe(2)
      for (const edge of instanceOfEdges) {
        expect(edge.optional).toBe(false)
      }
    })

    it('instance_of edge is optional when node ONLY appears in optional edges', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'u', labels: ['user'] },
          { alias: 'p', labels: ['post'] },
        ],
        edges: [{ from: 'u', to: 'p', types: ['authored'], direction: 'out', optional: true }],
      })
      const transformed = pass.transform(ast, schema)
      const patternStep = transformed.steps[0] as any

      // Both nodes are ONLY in optional edges → instance_of should be optional
      const instanceOfEdges = patternStep.edges.filter((e: any) => e.types.includes('instance_of'))
      expect(instanceOfEdges.length).toBe(2)
      for (const edge of instanceOfEdges) {
        expect(edge.optional).toBe(true)
      }
    })

    it('instance_of edge is required for standalone node (no edges)', () => {
      const ast = new QueryAST().addPattern({
        nodes: [{ alias: 'u', labels: ['user'] }],
        edges: [],
      })
      const transformed = pass.transform(ast, schema)
      const patternStep = transformed.steps[0] as any

      const instanceOfEdges = patternStep.edges.filter((e: any) => e.types.includes('instance_of'))
      expect(instanceOfEdges.length).toBe(1)
      expect(instanceOfEdges[0].optional).toBe(false)
    })
  })

  // ===========================================================================
  // PatternStep — preserves existing data
  // ===========================================================================

  describe('PatternStep — preserves existing data', () => {
    it('preserves inline where conditions on original nodes', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          {
            alias: 'u',
            labels: ['user'],
            where: [
              { type: 'comparison', target: 'u', field: 'name', operator: 'eq', value: 'Alice' },
            ],
          },
        ],
        edges: [],
      })
      const transformed = pass.transform(ast, schema)
      const result = compile(transformed)
      const cypher = normalizeCypher(result.cypher)

      // Original where condition should be preserved
      expect(cypher).toContain('name')
      expect(Object.values(result.params)).toContain('Alice')
      // And instance_of should also be present
      expect(cypher).toContain('instance_of')
    })
  })

  // ===========================================================================
  // SubqueryStep — recursive processing
  // ===========================================================================

  describe('SubqueryStep — recursive processing', () => {
    it('recursively processes SubqueryStep inner steps', () => {
      // Manually construct inner steps (match + traversal that need lowering)
      const innerSteps = [
        {
          type: 'match' as const,
          label: 'post',
          alias: 'sq0',
        },
        {
          type: 'traversal' as const,
          edges: ['commentedOn'],
          direction: 'in' as const,
          fromAlias: 'sq0',
          toAlias: 'sq1',
          toLabels: ['comment'],
          optional: false,
          cardinality: 'many' as const,
        },
      ]

      const ast = new QueryAST().addMatch('user').addSubqueryStep({
        correlatedAliases: ['n0'],
        steps: innerSteps,
        exportedAliases: [],
      })

      const transformed = pass.transform(ast, schema)

      // Outer match should be transformed
      expect(transformed.steps[0]).toHaveProperty('type', 'match')
      expect((transformed.steps[0] as any).label).toBe('Node')

      // Inner subquery steps should also be transformed
      const subqueryStep = transformed.steps.find((s) => s.type === 'subquery') as any
      expect(subqueryStep).toBeDefined()

      // Inner match should be rewritten to :Node
      const innerMatch = subqueryStep.steps.find((s: any) => s.type === 'match')
      expect(innerMatch.label).toBe('Node')

      // Inner steps should have instance_of traversals
      const innerInstanceOf = subqueryStep.steps.filter(
        (s: any) => s.type === 'traversal' && s.edges.includes('instance_of'),
      )
      expect(innerInstanceOf.length).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // SubqueryCondition — recursive processing
  // ===========================================================================

  describe('SubqueryCondition — recursive processing', () => {
    it('recursively processes WHERE EXISTS inner query', () => {
      // Manually construct inner subquery steps (traversal with toLabels that needs lowering)
      const innerTraversalStep = {
        type: 'traversal' as const,
        edges: ['authored'],
        direction: 'out' as const,
        fromAlias: 'n0',
        toAlias: 'n1',
        toLabels: ['post'],
        optional: false,
        cardinality: 'many' as const,
      }

      const ast = new QueryAST().addMatch('user').addWhere([
        {
          type: 'subquery',
          mode: 'exists',
          query: [innerTraversalStep],
          correlatedAliases: ['n0'],
        },
      ])

      const transformed = pass.transform(ast, schema)

      // Outer query should be transformed
      const result = compile(transformed)
      const cypher = normalizeCypher(result.cypher)
      expect(cypher).toContain(':Node')
      expect(Object.values(result.params)).toContain('cls-user')

      // The subquery condition should also be transformed
      // Note: expandMatch adds its own WHERE step for class ID, so find the one with subquery condition
      const whereStep = transformed.steps.find(
        (s: any) => s.type === 'where' && s.conditions.some((c: any) => c.type === 'subquery'),
      ) as any
      expect(whereStep).toBeDefined()

      const subqueryCondition = whereStep.conditions.find((c: any) => c.type === 'subquery')
      expect(subqueryCondition).toBeDefined()

      // Inner query should have been transformed (toLabels rewritten)
      const innerTraversal = subqueryCondition.query.find((s: any) => s.type === 'traversal')
      expect(innerTraversal.toLabels).toEqual(['Node'])
    })

    it('recursively processes SubqueryCondition nested in logical conditions', () => {
      // Manually construct inner subquery steps
      const innerTraversalStep = {
        type: 'traversal' as const,
        edges: ['authored'],
        direction: 'out' as const,
        fromAlias: 'n0',
        toAlias: 'n1',
        toLabels: ['post'],
        optional: false,
        cardinality: 'many' as const,
      }

      const ast = new QueryAST().addMatch('user').addWhere([
        {
          type: 'logical',
          operator: 'AND',
          conditions: [
            { type: 'comparison', target: 'n0', field: 'name', operator: 'eq', value: 'Alice' },
            {
              type: 'subquery',
              mode: 'exists',
              query: [innerTraversalStep],
              correlatedAliases: ['n0'],
            },
          ],
        },
      ])

      const transformed = pass.transform(ast, schema)

      // Find the WHERE step with the logical condition (not the class ID one)
      const whereStep = transformed.steps.find(
        (s: any) => s.type === 'where' && s.conditions.some((c: any) => c.type === 'logical'),
      ) as any
      expect(whereStep).toBeDefined()
      const logicalCond = whereStep.conditions.find((c: any) => c.type === 'logical')
      const subqueryCond = logicalCond.conditions.find((c: any) => c.type === 'subquery')

      // Inner query should be transformed
      const innerTraversal = subqueryCond.query.find((s: any) => s.type === 'traversal')
      expect(innerTraversal.toLabels).toEqual(['Node'])
    })
  })

  // ===========================================================================
  // No-op for PatternStep when classRefs absent
  // ===========================================================================

  describe('PatternStep — no-op when disabled', () => {
    it('passes PatternStep through unchanged when classRefs absent', () => {
      const schemaNoRefs: SchemaShape = {
        nodes: schema.nodes,
        edges: schema.edges,
      }
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'u', labels: ['user'] },
          { alias: 'p', labels: ['post'] },
        ],
        edges: [{ from: 'u', to: 'p', types: ['authored'], direction: 'out', optional: false }],
      })
      const transformed = pass.transform(ast, schemaNoRefs)

      expect(transformed.steps).toEqual(ast.steps)
    })
  })
})
