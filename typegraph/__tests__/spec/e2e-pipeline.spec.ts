/**
 * E2E Pipeline Specification Tests
 *
 * Full integration test exercising InstanceModel + ReifyEdges compilation
 * pipeline on an e-commerce schema. Verifies that both query and mutation
 * passes produce kernel-compliant Cypher output.
 */

import { describe, it, expect } from 'vitest'
import { QueryAST } from '../../src/query/ast'
import { CypherCompiler } from '../../src/query/compiler/cypher/compiler'
import { InstanceModelPass } from '../../src/query/compiler/passes/instance-model-pass'
import { ReifyEdgesPass } from '../../src/query/compiler/passes/reify-edges-pass'
import { InstanceModelMutationPass } from '../../src/mutation/passes/instance-model-mutation-pass'
import { ReifyEdgesMutationPass } from '../../src/mutation/passes/reify-edges-mutation-pass'
import type { InstanceModelConfig } from '../../src/schema'
import { MutationCypherCompiler } from '../../src/mutation/cypher/compiler'
import { MutationCompilationPipeline } from '../../src/mutation/ast/pipeline'
import type { SchemaShape } from '../../src/schema'
import type { MutationOp } from '../../src/mutation/ast/types'
import { normalizeCypher } from './fixtures/test-schema'

// =============================================================================
// E-COMMERCE SCHEMA
// =============================================================================

const ecommerceSchema: SchemaShape = {
  nodes: {
    // Interfaces (abstract)
    timestamped: { abstract: true, attributes: ['createdAt', 'updatedAt'], implements: [] },
    hasSlug: { abstract: true, attributes: ['slug'], implements: [] },
    priceable: { abstract: true, attributes: ['priceCents', 'currency'], implements: ['timestamped'] },
    identity: { abstract: true, attributes: [], implements: [] },

    // Concrete types
    customer: { abstract: false, attributes: ['email', 'name', 'phone'], implements: ['identity', 'timestamped'] },
    product: { abstract: false, attributes: ['title', 'sku', 'inStock'], implements: ['timestamped', 'hasSlug', 'priceable'] },
    category: { abstract: false, attributes: ['name'], implements: ['hasSlug'] },
    order: { abstract: false, attributes: ['status', 'totalCents'], implements: ['timestamped'] },
    review: { abstract: false, attributes: ['rating', 'body'], implements: ['timestamped'] },
  },
  edges: {
    // Non-reified (direct relationships)
    categorizedAs: {
      endpoints: {
        product: { types: ['product'] },
        category: { types: ['category'] },
      },
    },
    categoryParent: {
      endpoints: {
        child: { types: ['category'] },
        parent: { types: ['category'] },
      },
    },
    placedBy: {
      endpoints: {
        order: { types: ['order'] },
        customer: { types: ['customer'] },
      },
    },

    // Reified (link nodes)
    orderItem: {
      endpoints: {
        order: { types: ['order'] },
        product: { types: ['product'] },
      },
      attributes: ['quantity', 'unitPriceCents'],
      reified: true,
    },
    reviewOf: {
      endpoints: {
        review: { types: ['review'] },
        product: { types: ['product'] },
      },
      attributes: ['helpful'],
      reified: true,
    },
  },
  reifyEdges: false,
}

// Test-only instance model config with deterministic IDs
const instanceModel: InstanceModelConfig = {
  enabled: true,
  refs: {
    // Concrete types
    customer: 'cls-customer',
    product: 'cls-product',
    category: 'cls-category',
    order: 'cls-order',
    review: 'cls-review',
    // Abstract types
    timestamped: 'iface-timestamped',
    hasSlug: 'iface-hasSlug',
    priceable: 'iface-priceable',
    identity: 'iface-identity',
    // Reified edges
    orderItem: 'lcls-orderItem',
    reviewOf: 'lcls-reviewOf',
  },
  implementors: {
    timestamped: ['cls-customer', 'cls-product', 'cls-order', 'cls-review'],
    hasSlug: ['cls-product', 'cls-category'],
    priceable: ['cls-product'],
    identity: ['cls-customer'],
  },
}

// Enrich schema with instance model config
const schema: SchemaShape = { ...ecommerceSchema, instanceModel }

// =============================================================================
// QUERY PIPELINE HELPERS
// =============================================================================

function compileQuery(ast: QueryAST): { cypher: string; params: Record<string, unknown> } {
  const imPass = new InstanceModelPass(instanceModel)
  const reifyPass = new ReifyEdgesPass()
  const compiler = new CypherCompiler(schema)

  const afterIM = imPass.transform(ast, schema)
  const afterReify = reifyPass.transform(afterIM, schema)
  return compiler.compile(afterReify, schema)
}

const mutationCompiler = new MutationCypherCompiler()
const mutationPipeline = new MutationCompilationPipeline([
  new ReifyEdgesMutationPass(),
  new InstanceModelMutationPass(instanceModel),
])

function compileMutation(op: MutationOp): { query: string; params: Record<string, unknown> } {
  const ops = mutationPipeline.run(op, schema)
  return mutationCompiler.compile(ops, schema)
}

// =============================================================================
// TESTS — BOOTSTRAP CONFIG
// =============================================================================

describe('E2E: Bootstrap config computation', () => {
  it('assigns correct refs for all concrete types', () => {
    expect(instanceModel.refs.customer).toBe('cls-customer')
    expect(instanceModel.refs.product).toBe('cls-product')
    expect(instanceModel.refs.category).toBe('cls-category')
    expect(instanceModel.refs.order).toBe('cls-order')
    expect(instanceModel.refs.review).toBe('cls-review')
  })

  it('assigns correct refs for abstract types', () => {
    expect(instanceModel.refs.timestamped).toBe('iface-timestamped')
    expect(instanceModel.refs.hasSlug).toBe('iface-hasSlug')
    expect(instanceModel.refs.priceable).toBe('iface-priceable')
    expect(instanceModel.refs.identity).toBe('iface-identity')
  })

  it('assigns correct refs for reified edge types', () => {
    expect(instanceModel.refs.orderItem).toBe('lcls-orderItem')
    expect(instanceModel.refs.reviewOf).toBe('lcls-reviewOf')
    // Non-reified edges should not have refs
    expect(instanceModel.refs.categorizedAs).toBeUndefined()
    expect(instanceModel.refs.placedBy).toBeUndefined()
  })

  it('computes correct implementors for interfaces', () => {
    // timestamped: customer, product, order, review implement it directly.
    // priceable extends timestamped, and product implements priceable.
    const timestampedImpl = instanceModel.implementors.timestamped!
    expect(timestampedImpl).toContain('cls-customer')
    expect(timestampedImpl).toContain('cls-product')
    expect(timestampedImpl).toContain('cls-order')
    expect(timestampedImpl).toContain('cls-review')

    // hasSlug: category, product
    const hasSlugImpl = instanceModel.implementors.hasSlug!
    expect(hasSlugImpl).toContain('cls-product')
    expect(hasSlugImpl).toContain('cls-category')
    expect(hasSlugImpl).not.toContain('cls-customer')

    // identity: customer only
    const identityImpl = instanceModel.implementors.identity!
    expect(identityImpl).toContain('cls-customer')
    expect(identityImpl).toHaveLength(1)

    // priceable: product only (priceable extends timestamped, product implements priceable)
    const priceableImpl = instanceModel.implementors.priceable!
    expect(priceableImpl).toContain('cls-product')
    expect(priceableImpl).toHaveLength(1)
  })
})

// =============================================================================
// TESTS — QUERY PIPELINE
// =============================================================================

describe('E2E: Query pipeline (InstanceModel + ReifyEdges)', () => {
  it('concrete type match → :Node + instance_of join', () => {
    const ast = new QueryAST().addMatch('customer')
    const { cypher, params } = compileQuery(ast)
    const c = normalizeCypher(cypher)

    expect(c).toContain(':Node')
    expect(c).not.toContain(':Customer')
    expect(c).toContain('instance_of')
    expect(c).toContain(':Node:Class')
    expect(Object.values(params)).toContain('cls-customer')
  })

  it('traversal with non-reified edge keeps edge name', () => {
    const ast = new QueryAST()
      .addMatch('order')
      .addTraversal({
        edges: ['placedBy'],
        direction: 'out',
        toLabels: ['customer'],
        cardinality: 'one',
      })
    const { cypher, params } = compileQuery(ast)
    const c = normalizeCypher(cypher)

    // Edge type preserved (not reified)
    expect(c).toContain(':placedBy')
    // Both nodes become :Node with instance_of joins
    expect(c).toContain('instance_of')
    expect(Object.values(params)).toContain('cls-order')
    expect(Object.values(params)).toContain('cls-customer')
  })

  it('traversal with reified edge → has_link/links_to through :Link', () => {
    const ast = new QueryAST()
      .addMatch('order')
      .addTraversal({
        edges: ['orderItem'],
        direction: 'out',
        toLabels: ['product'],
        cardinality: 'many',
      })
    const { cypher, params } = compileQuery(ast)
    const c = normalizeCypher(cypher)

    // Source gets instance_of join
    expect(c).toContain('instance_of')
    expect(Object.values(params)).toContain('cls-order')

    // Reified edge becomes has_link → :Link → links_to
    expect(c).toContain('has_link')
    expect(c).toContain(':Link')
    expect(c).toContain('links_to')

    // Link gets its own instance_of to link class
    expect(Object.values(params)).toContain('lcls-orderItem')

    // Target gets instance_of join
    expect(Object.values(params)).toContain('cls-product')
  })

  it('reified edge with edgeWhere → node WHERE on link node', () => {
    const ast = new QueryAST()
      .addMatch('order')
      .addTraversal({
        edges: ['orderItem'],
        direction: 'out',
        toLabels: ['product'],
        cardinality: 'many',
        edgeWhere: [{ field: 'quantity', operator: 'gt', value: 5 }],
      })
    const { cypher } = compileQuery(ast)
    const c = normalizeCypher(cypher)

    expect(c).toContain('has_link')
    expect(c).toContain('quantity')
    expect(c).toContain('links_to')
  })

  it('inbound reified edge → reversed hops', () => {
    const ast = new QueryAST()
      .addMatch('product')
      .addTraversal({
        edges: ['orderItem'],
        direction: 'in',
        toLabels: ['order'],
        cardinality: 'many',
      })
    const { cypher } = compileQuery(ast)
    const c = normalizeCypher(cypher)

    // Both structural edges should appear (reversed direction)
    expect(c).toContain('links_to')
    expect(c).toContain('has_link')
  })

  it('multi-hop: order → orderItem (reified) → product → review (reified)', () => {
    const ast = new QueryAST()
      .addMatch('order')
      .addTraversal({
        edges: ['orderItem'],
        direction: 'out',
        toLabels: ['product'],
        cardinality: 'many',
      })
      .addTraversal({
        edges: ['reviewOf'],
        direction: 'in',
        toLabels: ['review'],
        cardinality: 'many',
      })
    const { cypher, params } = compileQuery(ast)
    const c = normalizeCypher(cypher)

    // First reified hop (orderItem)
    expect(c).toContain('has_link')
    expect(Object.values(params)).toContain('lcls-orderItem')

    // Second reified hop (reviewOf) - reversed
    expect(c).toContain('links_to')
    expect(Object.values(params)).toContain('lcls-reviewOf')

    // All three nodes get instance_of
    expect(Object.values(params)).toContain('cls-order')
    expect(Object.values(params)).toContain('cls-product')
    expect(Object.values(params)).toContain('cls-review')
  })
})

// =============================================================================
// TESTS — MUTATION PIPELINE
// =============================================================================

describe('E2E: Mutation pipeline (InstanceModel + ReifyEdges)', () => {
  it('createNode → :Node + instance_of link', () => {
    const { query, params } = compileMutation({
      type: 'createNode',
      label: 'customer',
      id: 'c-1',
      data: { name: 'Alice', email: 'alice@test.com' },
    })
    const c = normalizeCypher(query)

    expect(c).toContain(':Node')
    expect(c).not.toContain(':Customer')
    expect(c).toContain('instance_of')
    expect(Object.values(params)).toContain('cls-customer')
  })

  it('createEdge on reified edge → BatchLinkOp with has_link/links_to', () => {
    const { query, params } = compileMutation({
      type: 'createEdge',
      edgeType: 'orderItem',
      fromId: 'o-1',
      toId: 'p-1',
      edgeId: 'oi-1',
      data: { quantity: 3, unitPriceCents: 999 },
    })
    const c = normalizeCypher(query)

    expect(c).toContain(':Link')
    expect(c).toContain('has_link')
    expect(c).toContain('links_to')
    expect(c).toContain('instance_of')
    expect(Object.values(params)).toContain('lcls-orderItem')
    // Endpoint labels should be :Node
    expect(c).toContain(':Node')
  })

  it('createEdge on non-reified edge → direct relationship', () => {
    const { query } = compileMutation({
      type: 'createEdge',
      edgeType: 'placedBy',
      fromId: 'o-1',
      toId: 'c-1',
      edgeId: 'e-1',
    })
    const c = normalizeCypher(query)

    expect(c).toContain(':placedBy')
    expect(c).not.toContain('has_link')
    expect(c).not.toContain('links_to')
    // Endpoints resolve to :Node (instance model enabled)
    expect(c).toContain(':Node')
  })

  it('updateEdge on reified edge → has_link/links_to match + SET on linkNode', () => {
    const { query } = compileMutation({
      type: 'updateEdge',
      edgeType: 'orderItem',
      fromId: 'o-1',
      toId: 'p-1',
      data: { quantity: 10 },
    })
    const c = normalizeCypher(query)

    expect(c).toContain('has_link')
    expect(c).toContain(':Link')
    expect(c).toContain('links_to')
    expect(c).toContain('SET linkNode')
  })

  it('deleteEdge on reified edge → DETACH DELETE link node', () => {
    const { query } = compileMutation({
      type: 'deleteEdge',
      edgeType: 'reviewOf',
      fromId: 'r-1',
      toId: 'p-1',
    })
    const c = normalizeCypher(query)

    expect(c).toContain('has_link')
    expect(c).toContain(':Link')
    expect(c).toContain('DETACH DELETE')
  })

  it('updateEdgeById on reified → becomes UpdateNodeOp on :Node', () => {
    const { query } = compileMutation({
      type: 'updateEdgeById',
      edgeType: 'orderItem',
      edgeId: 'oi-1',
      data: { quantity: 20 },
    })
    const c = normalizeCypher(query)

    // Converted to UpdateNodeOp by Reify, then relabeled to :Node by IM
    expect(c).toContain(':Node')
    expect(c).toContain('SET n')
    expect(c).not.toContain('has_link')
  })

  it('deleteEdgeById on reified → becomes DeleteNodeOp on :Node', () => {
    const { query } = compileMutation({
      type: 'deleteEdgeById',
      edgeType: 'reviewOf',
      edgeId: 'rv-1',
    })
    const c = normalizeCypher(query)

    // Converted to DeleteNodeOp by Reify, then relabeled to :Node by IM
    expect(c).toContain(':Node')
    expect(c).toContain('DETACH DELETE')
  })

  it('batchLink on reified edge → link nodes with instance_of', () => {
    const { query, params } = compileMutation({
      type: 'batchLink',
      edgeType: 'orderItem',
      links: [
        { fromId: 'o-1', toId: 'p-1', edgeId: 'oi-1', data: { quantity: 2 } },
        { fromId: 'o-1', toId: 'p-2', edgeId: 'oi-2', data: { quantity: 1 } },
      ],
    })
    const c = normalizeCypher(query)

    expect(c).toContain(':Link')
    expect(c).toContain('has_link')
    expect(c).toContain('links_to')
    expect(c).toContain('instance_of')
    expect(Object.values(params)).toContain('lcls-orderItem')
  })

  it('upsertNode → MERGE :Node with instance_of', () => {
    const { query, params } = compileMutation({
      type: 'upsertNode',
      label: 'product',
      id: 'p-1',
      data: { title: 'Widget', sku: 'W-001' },
    })
    const c = normalizeCypher(query)

    expect(c).toContain('MERGE (n:Node')
    expect(c).toContain('instance_of')
    expect(Object.values(params)).toContain('cls-product')
  })
})
