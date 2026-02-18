/**
 * InstanceModelPass Specification Tests
 *
 * Tests for the type-instance lowering pass that rewrites label-based
 * matching into structural instance_of joins.
 */

import { describe, it, expect } from 'vitest'
import { QueryAST } from '../../src/query/ast'
import { CypherCompiler } from '../../src/query/compiler/cypher/compiler'
import { InstanceModelPass } from '../../src/query/compiler/passes/instance-model-pass'
import type { SchemaShape } from '../../src/schema'
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
      const implIds = paramValues.find(
        (v) => Array.isArray(v) && v.includes('cls-user'),
      )
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
      const ast = new QueryAST()
        .addMatch('user')
        .addTraversal({
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
      const ast = new QueryAST()
        .addMatch('user')
        .addTraversal({
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
})
