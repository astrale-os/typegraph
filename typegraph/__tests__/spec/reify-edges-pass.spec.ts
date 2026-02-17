/**
 * ReifyEdgesPass Specification Tests
 *
 * Tests for the edge reification pass that rewrites typed edge traversals
 * into has_link/links_to patterns through link nodes.
 */

import { describe, it, expect } from 'vitest'
import { QueryAST } from '../../src/query/ast'
import { CypherCompiler } from '../../src/query/compiler/cypher/compiler'
import { ReifyEdgesPass } from '../../src/query/compiler/passes/reify-edges-pass'
import { InstanceModelPass } from '../../src/query/compiler/passes/instance-model-pass'
import type { SchemaShape, InstanceModelConfig } from '../../src/schema'
import { normalizeCypher } from './fixtures/test-schema'

// =============================================================================
// TEST SCHEMA — REIFIED EDGES (NO INSTANCE MODEL)
// =============================================================================

const reifiedSchema: SchemaShape = {
  nodes: {
    order: { abstract: false, attributes: ['status'] },
    product: { abstract: false, attributes: ['title'] },
    customer: { abstract: false, attributes: ['name'] },
  },
  edges: {
    orderItem: {
      endpoints: {
        order: { types: ['order'] },
        product: { types: ['product'] },
      },
      attributes: ['quantity', 'unitPriceCents'],
      reified: true,
    },
    placedOrder: {
      endpoints: {
        customer: { types: ['customer'] },
        order: { types: ['order'] },
      },
      // NOT reified
    },
  },
  reifyEdges: false, // only per-edge reified
}

// =============================================================================
// TEST SCHEMA — REIFIED + INSTANCE MODEL
// =============================================================================

const instanceModelConfig: InstanceModelConfig = {
  enabled: true,
  refs: {
    order: 'cls-order',
    product: 'cls-product',
    customer: 'cls-customer',
    orderItem: 'cls-order-item',
    placedOrder: 'cls-placed-order',
  },
  implementors: {},
}

const reifiedWithInstanceModel: SchemaShape = {
  ...reifiedSchema,
  instanceModel: instanceModelConfig,
}

function compile(ast: QueryAST, schema: SchemaShape) {
  return new CypherCompiler(schema).compile(ast, schema)
}

// =============================================================================
// TESTS — REIFY ONLY (NO INSTANCE MODEL)
// =============================================================================

describe('ReifyEdgesPass', () => {
  const pass = new ReifyEdgesPass()

  describe('basic reification (no instance model)', () => {
    it('rewrites reified edge traversal to has_link/links_to pattern', () => {
      const ast = new QueryAST()
        .addMatch('order')
        .addTraversal({
          edges: ['orderItem'],
          direction: 'out',
          toLabels: ['product'],
          cardinality: 'many',
        })
      const transformed = pass.transform(ast, reifiedSchema)
      const result = compile(transformed, reifiedSchema)
      const cypher = normalizeCypher(result.cypher)

      expect(cypher).toContain('has_link')
      expect(cypher).toContain('OrderItem')  // PascalCase link label
      expect(cypher).toContain('links_to')
    })

    it('does not rewrite non-reified edges', () => {
      const ast = new QueryAST()
        .addMatch('customer')
        .addTraversal({
          edges: ['placedOrder'],
          direction: 'out',
          toLabels: ['order'],
          cardinality: 'many',
        })
      const transformed = pass.transform(ast, reifiedSchema)
      const result = compile(transformed, reifiedSchema)
      const cypher = normalizeCypher(result.cypher)

      expect(cypher).toContain('placedOrder')
      expect(cypher).not.toContain('has_link')
    })

    it('converts edgeWhere to node WHERE on link', () => {
      const ast = new QueryAST()
        .addMatch('order')
        .addTraversal({
          edges: ['orderItem'],
          direction: 'out',
          toLabels: ['product'],
          cardinality: 'many',
          edgeWhere: [{ field: 'quantity', operator: 'gt', value: 5 }],
        })
      const transformed = pass.transform(ast, reifiedSchema)
      const result = compile(transformed, reifiedSchema)
      const cypher = normalizeCypher(result.cypher)

      // edgeWhere should become a WHERE on the link node
      expect(cypher).toContain('link0')
      expect(cypher).toContain('quantity')
    })
  })

  describe('direction handling', () => {
    it('reverses hops for inbound traversal', () => {
      const ast = new QueryAST()
        .addMatch('product')
        .addTraversal({
          edges: ['orderItem'],
          direction: 'in',
          toLabels: ['order'],
          cardinality: 'many',
        })
      const transformed = pass.transform(ast, reifiedSchema)
      const result = compile(transformed, reifiedSchema)
      const cypher = normalizeCypher(result.cypher)

      // Inbound: links_to first (in), then has_link (in)
      expect(cypher).toContain('links_to')
      expect(cypher).toContain('has_link')
    })

    it('rejects bidirectional traversal', () => {
      const ast = new QueryAST()
        .addMatch('order')
        .addTraversal({
          edges: ['orderItem'],
          direction: 'both',
          toLabels: ['product'],
          cardinality: 'many',
        })

      expect(() => pass.transform(ast, reifiedSchema)).toThrow(
        'bidirectional traversal on reified edge',
      )
    })
  })

  describe('variable-length rejection', () => {
    it('rejects variable-length path on reified edge', () => {
      const ast = new QueryAST()
        .addMatch('order')
        .addTraversal({
          edges: ['orderItem'],
          direction: 'out',
          toLabels: ['product'],
          cardinality: 'many',
          variableLength: { min: 1, max: 3, uniqueness: 'nodes' },
        })

      expect(() => pass.transform(ast, reifiedSchema)).toThrow(
        'variable-length traversal on reified edge',
      )
    })
  })

  describe('no-op when no reified edges', () => {
    it('returns AST unchanged when no edges are reified', () => {
      const noReifySchema: SchemaShape = {
        ...reifiedSchema,
        edges: {
          ...reifiedSchema.edges,
          orderItem: { ...reifiedSchema.edges.orderItem, reified: false },
        },
      }
      const ast = new QueryAST()
        .addMatch('order')
        .addTraversal({
          edges: ['orderItem'],
          direction: 'out',
          toLabels: ['product'],
          cardinality: 'many',
        })
      const transformed = pass.transform(ast, noReifySchema)

      expect(transformed.steps).toEqual(ast.steps)
    })
  })
})

// =============================================================================
// TESTS — REIFY + INSTANCE MODEL (FULL PIPELINE)
// =============================================================================

describe('ReifyEdgesPass + InstanceModelPass (full pipeline)', () => {
  it('produces full kernel-compliant Cypher', () => {
    const imPass = new InstanceModelPass(instanceModelConfig)
    const reifyPass = new ReifyEdgesPass()

    const ast = new QueryAST()
      .addMatch('order')
      .addTraversal({
        edges: ['orderItem'],
        direction: 'out',
        toLabels: ['product'],
        cardinality: 'many',
      })

    // Pipeline order: InstanceModel first, then ReifyEdges
    const afterIM = imPass.transform(ast, reifiedWithInstanceModel)
    const afterReify = reifyPass.transform(afterIM, reifiedWithInstanceModel)

    const result = compile(afterReify, reifiedWithInstanceModel)
    const cypher = normalizeCypher(result.cypher)

    // Should have :Node labels (not :order or :product)
    expect(cypher).toContain(':Node')
    // Should have instance_of for source node type
    expect(cypher).toContain('instance_of')
    // Should have has_link / links_to for edge reification
    expect(cypher).toContain('has_link')
    expect(cypher).toContain('links_to')
    // Should use :Link label (not :OrderItem)
    expect(cypher).toContain(':Link')
    // Should have class ID params
    expect(Object.values(result.params)).toContain('cls-order')
    expect(Object.values(result.params)).toContain('cls-order-item')
    expect(Object.values(result.params)).toContain('cls-product')
  })
})
