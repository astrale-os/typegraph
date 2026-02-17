/**
 * ReifyEdgesMutationPass Specification Tests
 *
 * Tests for the mutation pass that annotates edge ops with reified metadata
 * and converts certain edge ops to node ops for reified edges.
 */

import { describe, it, expect } from 'vitest'
import { ReifyEdgesMutationPass } from '../../src/compiler/passes/reify-edges-mutation-pass'
import { InstanceModelMutationPass } from '../../src/compiler/passes/instance-model-mutation-pass'
import { MutationCypherCompiler } from '../../src/mutation/cypher/compiler'
import type { SchemaShape, InstanceModelConfig } from '../../src/schema'
import type {
  MutationOp,
  CreateEdgeOp,
  UpdateEdgeOp,
  UpdateEdgeByIdOp,
  DeleteEdgeOp,
  DeleteEdgeByIdOp,
  BatchLinkOp,
  BatchUnlinkOp,
  UnlinkAllFromOp,
  UnlinkAllToOp,
  UpdateNodeOp,
  DeleteNodeOp,
} from '../../src/mutation/ast/types'
import { normalizeCypher } from './fixtures/test-schema'

// =============================================================================
// TEST FIXTURES
// =============================================================================

const instanceModelConfig: InstanceModelConfig = {
  enabled: true,
  refs: {
    customer: 'cls-customer',
    order: 'cls-order',
    product: 'cls-product',
    orderItem: 'cls-order-item',
  },
  implementors: {},
}

const schema: SchemaShape = {
  nodes: {
    customer: { abstract: false, attributes: ['name'] },
    order: { abstract: false, attributes: ['status'] },
    product: { abstract: false, attributes: ['title'] },
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
  instanceModel: instanceModelConfig,
  reifyEdges: false,
}

const schemaNoIM: SchemaShape = {
  ...schema,
  instanceModel: undefined,
}

const compiler = new MutationCypherCompiler()

function compile(op: MutationOp): string {
  return normalizeCypher(compiler.compileOne(op, schema).query)
}

function compileNoIM(op: MutationOp): string {
  return normalizeCypher(compiler.compileOne(op, schemaNoIM).query)
}

// =============================================================================
// TESTS
// =============================================================================

describe('ReifyEdgesMutationPass', () => {
  const pass = new ReifyEdgesMutationPass()

  describe('CreateEdgeOp → BatchLinkOp conversion', () => {
    it('converts reified CreateEdgeOp to BatchLinkOp', () => {
      const op: CreateEdgeOp = {
        type: 'createEdge',
        edgeType: 'orderItem',
        fromId: 'order-1',
        toId: 'prod-1',
        edgeId: 'oi-1',
        data: { quantity: 3 },
      }
      const result = pass.transform(op, schema) as BatchLinkOp

      expect(result.type).toBe('batchLink')
      expect(result.edgeType).toBe('orderItem')
      expect(result.links).toHaveLength(1)
      expect(result.links[0]!.fromId).toBe('order-1')
      expect(result.links[0]!.toId).toBe('prod-1')
      expect(result.links[0]!.edgeId).toBe('oi-1')
      expect(result.links[0]!.data).toEqual({ quantity: 3 })
      expect(result.reified).toBeDefined()
      expect(result.reified!.linkLabel).toBe('Link')
      expect(result.reified!.instanceOfTargetId).toBe('cls-order-item')
    })

    it('does not convert non-reified CreateEdgeOp', () => {
      const op: CreateEdgeOp = {
        type: 'createEdge',
        edgeType: 'placedOrder',
        fromId: 'c1',
        toId: 'o1',
        edgeId: 'e1',
      }
      const result = pass.transform(op, schema)
      expect(result).toEqual(op)
    })

    it('compiles reified BatchLinkOp to has_link/links_to Cypher', () => {
      const op: CreateEdgeOp = {
        type: 'createEdge',
        edgeType: 'orderItem',
        fromId: 'order-1',
        toId: 'prod-1',
        edgeId: 'oi-1',
        data: { quantity: 3 },
      }
      const result = pass.transform(op, schema) as BatchLinkOp
      const cypher = compile(result)

      expect(cypher).toContain('has_link')
      expect(cypher).toContain('links_to')
      expect(cypher).toContain('linkCls')
      expect(cypher).toContain('instance_of')
      expect(cypher).toContain(':Link')
    })
  })

  describe('UpdateEdgeOp annotation', () => {
    it('annotates reified UpdateEdgeOp', () => {
      const op: UpdateEdgeOp = {
        type: 'updateEdge',
        edgeType: 'orderItem',
        fromId: 'order-1',
        toId: 'prod-1',
        data: { quantity: 5 },
      }
      const result = pass.transform(op, schema) as UpdateEdgeOp

      expect(result.type).toBe('updateEdge')
      expect(result.reified).toEqual({
        linkLabel: 'Link',
        instanceOfTargetId: 'cls-order-item',
      })
    })

    it('compiles annotated UpdateEdgeOp to has_link/links_to pattern', () => {
      const op: UpdateEdgeOp = {
        type: 'updateEdge',
        edgeType: 'orderItem',
        fromId: 'order-1',
        toId: 'prod-1',
        data: { quantity: 5 },
      }
      const result = pass.transform(op, schema) as UpdateEdgeOp
      const cypher = compile(result)

      expect(cypher).toContain('has_link')
      expect(cypher).toContain('links_to')
      expect(cypher).toContain(':Link')
    })
  })

  describe('UpdateEdgeByIdOp → UpdateNodeOp', () => {
    it('converts to UpdateNodeOp for reified edge', () => {
      const op: UpdateEdgeByIdOp = {
        type: 'updateEdgeById',
        edgeType: 'orderItem',
        edgeId: 'oi-1',
        data: { quantity: 10 },
      }
      const result = pass.transform(op, schema) as UpdateNodeOp

      expect(result.type).toBe('updateNode')
      expect(result.label).toBe('Link')
      expect(result.id).toBe('oi-1')
      expect(result.data).toEqual({ quantity: 10 })
    })
  })

  describe('DeleteEdgeOp annotation', () => {
    it('annotates reified DeleteEdgeOp', () => {
      const op: DeleteEdgeOp = {
        type: 'deleteEdge',
        edgeType: 'orderItem',
        fromId: 'order-1',
        toId: 'prod-1',
      }
      const result = pass.transform(op, schema) as DeleteEdgeOp

      expect(result.reified).toEqual({
        linkLabel: 'Link',
        instanceOfTargetId: 'cls-order-item',
      })
    })
  })

  describe('DeleteEdgeByIdOp → DeleteNodeOp', () => {
    it('converts to DeleteNodeOp for reified edge', () => {
      const op: DeleteEdgeByIdOp = {
        type: 'deleteEdgeById',
        edgeType: 'orderItem',
        edgeId: 'oi-1',
      }
      const result = pass.transform(op, schema) as DeleteNodeOp

      expect(result.type).toBe('deleteNode')
      expect(result.label).toBe('Link')
      expect(result.id).toBe('oi-1')
      expect(result.detach).toBe(true)
    })
  })

  describe('BatchLinkOp annotation', () => {
    it('annotates reified BatchLinkOp', () => {
      const op: BatchLinkOp = {
        type: 'batchLink',
        edgeType: 'orderItem',
        links: [
          { fromId: 'o1', toId: 'p1', edgeId: 'oi-1' },
          { fromId: 'o1', toId: 'p2', edgeId: 'oi-2' },
        ],
      }
      const result = pass.transform(op, schema) as BatchLinkOp

      expect(result.reified).toBeDefined()
      expect(result.reified!.linkLabel).toBe('Link')
      expect(result.reified!.instanceOfTargetId).toBe('cls-order-item')
    })
  })

  describe('BatchUnlinkOp annotation', () => {
    it('annotates reified BatchUnlinkOp', () => {
      const op: BatchUnlinkOp = {
        type: 'batchUnlink',
        edgeType: 'orderItem',
        links: [{ fromId: 'o1', toId: 'p1' }],
      }
      const result = pass.transform(op, schema) as BatchUnlinkOp

      expect(result.reified).toBeDefined()
      expect(result.reified!.linkLabel).toBe('Link')
    })
  })

  describe('UnlinkAllFrom/To annotation', () => {
    it('annotates reified UnlinkAllFromOp', () => {
      const op: UnlinkAllFromOp = {
        type: 'unlinkAllFrom',
        edgeType: 'orderItem',
        fromId: 'o1',
      }
      const result = pass.transform(op, schema) as UnlinkAllFromOp

      expect(result.reified).toBeDefined()
      expect(result.reified!.linkLabel).toBe('Link')
    })

    it('annotates reified UnlinkAllToOp', () => {
      const op: UnlinkAllToOp = {
        type: 'unlinkAllTo',
        edgeType: 'orderItem',
        toId: 'p1',
      }
      const result = pass.transform(op, schema) as UnlinkAllToOp

      expect(result.reified).toBeDefined()
      expect(result.reified!.linkLabel).toBe('Link')
    })
  })

  describe('non-reified edges — passthrough', () => {
    it('does not annotate non-reified edge ops', () => {
      const op: UpdateEdgeOp = {
        type: 'updateEdge',
        edgeType: 'placedOrder',
        fromId: 'c1',
        toId: 'o1',
        data: { note: 'test' },
      }
      const result = pass.transform(op, schema) as UpdateEdgeOp

      expect(result.reified).toBeUndefined()
    })
  })

  describe('without instance model', () => {
    it('uses capitalize-first link label', () => {
      const op: CreateEdgeOp = {
        type: 'createEdge',
        edgeType: 'orderItem',
        fromId: 'o1',
        toId: 'p1',
        edgeId: 'oi-1',
      }
      const result = pass.transform(op, schemaNoIM) as BatchLinkOp

      expect(result.reified!.linkLabel).toBe('OrderItem')
      expect(result.reified!.instanceOfTargetId).toBeUndefined()
    })

    it('compiles without instance_of edge', () => {
      const op: CreateEdgeOp = {
        type: 'createEdge',
        edgeType: 'orderItem',
        fromId: 'o1',
        toId: 'p1',
        edgeId: 'oi-1',
      }
      const result = pass.transform(op, schemaNoIM) as BatchLinkOp
      const cypher = compileNoIM(result)

      expect(cypher).toContain('has_link')
      expect(cypher).toContain('links_to')
      expect(cypher).toContain(':OrderItem')
      expect(cypher).not.toContain('instance_of')
    })
  })

  describe('full pipeline (InstanceModel + Reify)', () => {
    it('produces kernel-compliant mutation Cypher', () => {
      const imPass = new InstanceModelMutationPass(instanceModelConfig)
      const reifyPass = new ReifyEdgesMutationPass()

      // Create a node (goes through InstanceModelMutationPass)
      const createOp: MutationOp = {
        type: 'createNode',
        label: 'order',
        id: 'o-1',
        data: { status: 'pending' },
      }
      const afterIM = imPass.transform(createOp, schema)
      const createResult = Array.isArray(afterIM) ? afterIM : [afterIM]
      const afterReify = createResult.flatMap((op) => {
        const r = reifyPass.transform(op, schema)
        return Array.isArray(r) ? r : [r]
      })
      const createCypher = compile(afterReify[0]!)

      expect(createCypher).toContain(':Node')
      expect(createCypher).toContain('instance_of')

      // Create an edge (goes through ReifyEdgesMutationPass only)
      const edgeOp: CreateEdgeOp = {
        type: 'createEdge',
        edgeType: 'orderItem',
        fromId: 'o-1',
        toId: 'p-1',
        edgeId: 'oi-1',
        data: { quantity: 2 },
      }
      const reifiedOp = reifyPass.transform(edgeOp, schema) as BatchLinkOp
      const edgeCypher = compile(reifiedOp)

      expect(edgeCypher).toContain(':Link')
      expect(edgeCypher).toContain('has_link')
      expect(edgeCypher).toContain('links_to')
      expect(edgeCypher).toContain('instance_of')
      expect(edgeCypher).toContain(':Node')
    })
  })
})
