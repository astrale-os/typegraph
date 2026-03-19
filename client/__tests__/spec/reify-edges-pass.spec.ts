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
import { getCompiler, getQueryPipeline } from '../../src/query/compiler/cache'
import type { SchemaShape } from '../../src/schema'
import { ClassId } from '../../src/schema'
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

const reifiedWithInstanceModel: SchemaShape = {
  ...reifiedSchema,
  classRefs: {
    order: ClassId('cls-order'),
    product: ClassId('cls-product'),
    customer: ClassId('cls-customer'),
    orderItem: ClassId('cls-order-item'),
    placedOrder: ClassId('cls-placed-order'),
  },
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
      const ast = new QueryAST().addMatch('order').addTraversal({
        edges: ['orderItem'],
        direction: 'out',
        toLabels: ['product'],
        cardinality: 'many',
      })
      const transformed = pass.transform(ast, reifiedSchema)
      const result = compile(transformed, reifiedSchema)
      const cypher = normalizeCypher(result.cypher)

      expect(cypher).toContain('has_link')
      expect(cypher).toContain('OrderItem') // PascalCase link label
      expect(cypher).toContain('links_to')
    })

    it('does not rewrite non-reified edges', () => {
      const ast = new QueryAST().addMatch('customer').addTraversal({
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
      const ast = new QueryAST().addMatch('order').addTraversal({
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
      const ast = new QueryAST().addMatch('product').addTraversal({
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
      const ast = new QueryAST().addMatch('order').addTraversal({
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
      const ast = new QueryAST().addMatch('order').addTraversal({
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
      const ast = new QueryAST().addMatch('order').addTraversal({
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

// =============================================================================
// TESTS — PATTERN STEP REIFICATION
// =============================================================================

describe('ReifyEdgesPass — PatternStep', () => {
  const pass = new ReifyEdgesPass()

  describe('reified edge expansion (no instance model)', () => {
    it('expands reified pattern edge to has_link + link node + links_to', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'o', labels: ['order'] },
          { alias: 'p', labels: ['product'] },
        ],
        edges: [{ from: 'o', to: 'p', types: ['orderItem'], direction: 'out', optional: false }],
      })
      const transformed = pass.transform(ast, reifiedSchema)
      const result = compile(transformed, reifiedSchema)
      const cypher = normalizeCypher(result.cypher)

      expect(cypher).toContain('has_link')
      expect(cypher).toContain('OrderItem') // PascalCase link label
      expect(cypher).toContain('links_to')
    })

    it('does not expand non-reified pattern edges', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'c', labels: ['customer'] },
          { alias: 'o', labels: ['order'] },
        ],
        edges: [{ from: 'c', to: 'o', types: ['placedOrder'], direction: 'out', optional: false }],
      })
      const transformed = pass.transform(ast, reifiedSchema)
      const result = compile(transformed, reifiedSchema)
      const cypher = normalizeCypher(result.cypher)

      expect(cypher).toContain('placedOrder')
      expect(cypher).not.toContain('has_link')
    })

    it('handles inbound direction on reified pattern edge', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'p', labels: ['product'] },
          { alias: 'o', labels: ['order'] },
        ],
        edges: [{ from: 'p', to: 'o', types: ['orderItem'], direction: 'in', optional: false }],
      })
      const transformed = pass.transform(ast, reifiedSchema)
      const result = compile(transformed, reifiedSchema)
      const cypher = normalizeCypher(result.cypher)

      expect(cypher).toContain('links_to')
      expect(cypher).toContain('has_link')
    })

    it('rejects bidirectional on reified pattern edge', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'o', labels: ['order'] },
          { alias: 'p', labels: ['product'] },
        ],
        edges: [{ from: 'o', to: 'p', types: ['orderItem'], direction: 'both', optional: false }],
      })

      expect(() => pass.transform(ast, reifiedSchema)).toThrow(
        'bidirectional traversal on reified edge',
      )
    })

    it('rejects variableLength on reified pattern edge', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'o', labels: ['order'] },
          { alias: 'p', labels: ['product'] },
        ],
        edges: [
          {
            from: 'o',
            to: 'p',
            types: ['orderItem'],
            direction: 'out',
            optional: false,
            variableLength: { min: 1, max: 3, uniqueness: 'nodes' as const },
          },
        ],
      })

      expect(() => pass.transform(ast, reifiedSchema)).toThrow(
        'variable-length traversal on reified edge',
      )
    })

    it('moves edge.where to link node inline where', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'o', labels: ['order'] },
          { alias: 'p', labels: ['product'] },
        ],
        edges: [
          {
            from: 'o',
            to: 'p',
            types: ['orderItem'],
            direction: 'out',
            optional: false,
            where: [{ field: 'quantity', operator: 'gt', value: 5 }],
          },
        ],
      })
      const transformed = pass.transform(ast, reifiedSchema)
      const result = compile(transformed, reifiedSchema)
      const cypher = normalizeCypher(result.cypher)

      expect(cypher).toContain('quantity')
      expect(cypher).toContain('has_link')
    })

    it('preserves optionality on expanded edges', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'o', labels: ['order'] },
          { alias: 'p', labels: ['product'] },
        ],
        edges: [{ from: 'o', to: 'p', types: ['orderItem'], direction: 'out', optional: true }],
      })
      const transformed = pass.transform(ast, reifiedSchema)
      const patternStep = transformed.steps[0] as any

      // has_link and links_to edges should both be optional
      const hasLink = patternStep.edges.find((e: any) => e.types.includes('has_link'))
      const linksTo = patternStep.edges.find((e: any) => e.types.includes('links_to'))
      expect(hasLink.optional).toBe(true)
      expect(linksTo.optional).toBe(true)
    })
  })

  describe('reified + instance model', () => {
    it('with classRefs, link node uses :Link label and gets instance_of + class node', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'o', labels: ['order'] },
          { alias: 'p', labels: ['product'] },
        ],
        edges: [{ from: 'o', to: 'p', types: ['orderItem'], direction: 'out', optional: false }],
      })
      const transformed = pass.transform(ast, reifiedWithInstanceModel)
      const result = compile(transformed, reifiedWithInstanceModel)
      const cypher = normalizeCypher(result.cypher)

      // Link should use :Link label (not :OrderItem)
      expect(cypher).toContain(':Link')
      // Should have instance_of for link class discrimination
      expect(cypher).toContain('instance_of')
      // Should have link class ID in params
      expect(Object.values(result.params)).toContain('cls-order-item')
    })
  })

  describe('mixed edges', () => {
    it('handles mix of reified and non-reified pattern edges', () => {
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'c', labels: ['customer'] },
          { alias: 'o', labels: ['order'] },
          { alias: 'p', labels: ['product'] },
        ],
        edges: [
          { from: 'c', to: 'o', types: ['placedOrder'], direction: 'out', optional: false },
          { from: 'o', to: 'p', types: ['orderItem'], direction: 'out', optional: false },
        ],
      })
      const transformed = pass.transform(ast, reifiedSchema)
      const result = compile(transformed, reifiedSchema)
      const cypher = normalizeCypher(result.cypher)

      // Non-reified should be preserved
      expect(cypher).toContain('placedOrder')
      // Reified should be expanded
      expect(cypher).toContain('has_link')
      expect(cypher).toContain('links_to')
    })
  })

  describe('no-op', () => {
    it('passes PatternStep through unchanged when no edges are reified', () => {
      const noReifySchema: SchemaShape = {
        ...reifiedSchema,
        edges: {
          ...reifiedSchema.edges,
          orderItem: { ...reifiedSchema.edges.orderItem, reified: false },
        },
      }
      const ast = new QueryAST().addPattern({
        nodes: [
          { alias: 'o', labels: ['order'] },
          { alias: 'p', labels: ['product'] },
        ],
        edges: [{ from: 'o', to: 'p', types: ['orderItem'], direction: 'out', optional: false }],
      })
      const transformed = pass.transform(ast, noReifySchema)

      expect(transformed.steps).toEqual(ast.steps)
    })
  })
})

// =============================================================================
// TESTS — SUBQUERY STEP/CONDITION REIFICATION
// =============================================================================

describe('ReifyEdgesPass — SubqueryStep & SubqueryCondition', () => {
  const pass = new ReifyEdgesPass()

  it('recursively processes SubqueryStep inner steps', () => {
    const innerSteps = [
      {
        type: 'traversal' as const,
        edges: ['orderItem'],
        direction: 'out' as const,
        fromAlias: 'n0',
        toAlias: 'n1',
        toLabels: ['product'],
        optional: false,
        cardinality: 'many' as const,
      },
    ]

    const ast = new QueryAST().addMatch('order').addSubqueryStep({
      correlatedAliases: ['n0'],
      steps: innerSteps,
      exportedAliases: [],
    })

    const transformed = pass.transform(ast, reifiedSchema)

    // Inner subquery steps should be transformed
    const subqueryStep = transformed.steps.find((s) => s.type === 'subquery') as any
    expect(subqueryStep).toBeDefined()

    // Inner traversal should be expanded to has_link/links_to
    const innerHasLink = subqueryStep.steps.find(
      (s: any) => s.type === 'traversal' && s.edges.includes('has_link'),
    )
    expect(innerHasLink).toBeDefined()

    const innerLinksTo = subqueryStep.steps.find(
      (s: any) => s.type === 'traversal' && s.edges.includes('links_to'),
    )
    expect(innerLinksTo).toBeDefined()
  })

  it('recursively processes WHERE EXISTS inner query', () => {
    const innerTraversalStep = {
      type: 'traversal' as const,
      edges: ['orderItem'],
      direction: 'out' as const,
      fromAlias: 'n0',
      toAlias: 'n1',
      toLabels: ['product'],
      optional: false,
      cardinality: 'many' as const,
    }

    const ast = new QueryAST().addMatch('order').addWhere([
      {
        type: 'subquery',
        mode: 'exists',
        query: [innerTraversalStep],
        correlatedAliases: ['n0'],
      },
    ])

    const transformed = pass.transform(ast, reifiedSchema)

    // Find the subquery condition
    const whereStep = transformed.steps.find((s) => s.type === 'where') as any
    const subqueryCond = whereStep.conditions.find((c: any) => c.type === 'subquery')

    // Inner query should have been expanded
    const innerHasLink = subqueryCond.query.find(
      (s: any) => s.type === 'traversal' && s.edges.includes('has_link'),
    )
    expect(innerHasLink).toBeDefined()
  })

  it('recursively processes SubqueryCondition in logical conditions', () => {
    const innerTraversalStep = {
      type: 'traversal' as const,
      edges: ['orderItem'],
      direction: 'out' as const,
      fromAlias: 'n0',
      toAlias: 'n1',
      toLabels: ['product'],
      optional: false,
      cardinality: 'many' as const,
    }

    const ast = new QueryAST().addMatch('order').addWhere([
      {
        type: 'logical',
        operator: 'OR',
        conditions: [
          { type: 'comparison', target: 'n0', field: 'status', operator: 'eq', value: 'pending' },
          {
            type: 'subquery',
            mode: 'exists',
            query: [innerTraversalStep],
            correlatedAliases: ['n0'],
          },
        ],
      },
    ])

    const transformed = pass.transform(ast, reifiedSchema)

    // Find the logical condition
    const whereStep = transformed.steps.find((s) => s.type === 'where') as any
    const logicalCond = whereStep.conditions.find((c: any) => c.type === 'logical')
    const subqueryCond = logicalCond.conditions.find((c: any) => c.type === 'subquery')

    // Inner query should be expanded
    const innerHasLink = subqueryCond.query.find(
      (s: any) => s.type === 'traversal' && s.edges.includes('has_link'),
    )
    expect(innerHasLink).toBeDefined()
  })
})

// =============================================================================
// TESTS — REIFY + INSTANCE MODEL (FULL PIPELINE)
// =============================================================================

describe('ReifyEdgesPass + InstanceModelPass (full pipeline)', () => {
  it('produces full kernel-compliant Cypher', () => {
    const imPass = new InstanceModelPass()
    const reifyPass = new ReifyEdgesPass()

    const ast = new QueryAST().addMatch('order').addTraversal({
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

// =============================================================================
// TESTS — count() MUST GO THROUGH THE PIPELINE
// =============================================================================

describe('count() with reified edge traversals', () => {
  it('count projection through pipeline produces reified Cypher', () => {
    // Simulate what CollectionBuilder.count() should do:
    // build AST with traversal + count projection, then compile through pipeline
    const ast = new QueryAST()
      .addMatch('order')
      .addTraversal({
        edges: ['orderItem'],
        direction: 'out',
        toLabels: ['product'],
        cardinality: 'many',
      })
      .setCountProjection()

    // Compile through the pipeline (what execute() does) — this should work
    const pipeline = getQueryPipeline(reifiedSchema)
    const transformedAst = pipeline.run(ast, reifiedSchema)
    const pipelineResult = getCompiler(reifiedSchema).compile(transformedAst)
    const pipelineCypher = normalizeCypher(pipelineResult.cypher)

    expect(pipelineCypher).toContain('has_link')
    expect(pipelineCypher).toContain('links_to')
    expect(pipelineCypher).toContain('count(')

    // Compile directly (what count() was doing) — this skips reification
    const directResult = getCompiler(reifiedSchema).compile(ast)
    const directCypher = normalizeCypher(directResult.cypher)

    // BUG: direct compilation still references the raw edge type 'orderItem'
    // because ReifyEdgesPass never ran. This means count() returns wrong results.
    // After the fix, both paths should produce identical Cypher.
    expect(directCypher).toContain('orderItem') // proves direct path skips reification

    // The pipeline path should NOT contain the raw edge type
    expect(pipelineCypher).not.toContain('orderItem')
  })

  it('count projection on inbound reified traversal produces correct Cypher', () => {
    const ast = new QueryAST()
      .addMatch('product')
      .addTraversal({
        edges: ['orderItem'],
        direction: 'in',
        toLabels: ['order'],
        cardinality: 'many',
      })
      .setCountProjection()

    const pipeline = getQueryPipeline(reifiedSchema)
    const transformedAst = pipeline.run(ast, reifiedSchema)
    const result = getCompiler(reifiedSchema).compile(transformedAst)
    const cypher = normalizeCypher(result.cypher)

    // Should have reified pattern with count
    expect(cypher).toContain('has_link')
    expect(cypher).toContain('links_to')
    expect(cypher).toContain('count(')
    expect(cypher).not.toContain('orderItem')
  })
})
