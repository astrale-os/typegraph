/**
 * ReifyEdgesMutationPass Specification Tests
 *
 * Tests for the mutation pass that converts edge ops to link-node op types
 * for reified edges. The pass is purely structural — no instance model knowledge.
 */

import { describe, it, expect } from 'vitest'
import { ReifyEdgesMutationPass } from '../../src/mutation/passes/reify-edges-mutation-pass'
import { InstanceOfMutationPass } from '../../src/mutation/passes/instance-of-mutation-pass'
import { MutationCypherCompiler } from '../../src/mutation/cypher/compiler'
import type { SchemaShape } from '../../src/schema'
import { ClassId } from '../../src/schema'
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
  BatchCreateLinkNodeOp,
  BatchDeleteLinkNodeOp,
  UpdateLinkNodeOp,
  DeleteLinkNodeOp,
  DeleteLinkNodesFromOp,
  DeleteLinkNodesToOp,
} from '../../src/mutation/ast/types'
import { normalizeCypher } from './fixtures/test-schema'

// =============================================================================
// TEST FIXTURES
// =============================================================================

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
    },
  },
  classRefs: {
    customer: ClassId('cls-customer'),
    order: ClassId('cls-order'),
    product: ClassId('cls-product'),
    orderItem: ClassId('cls-order-item'),
  },
  reifyEdges: false,
}

const schemaNoIM: SchemaShape = {
  ...schema,
  classRefs: undefined,
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

  describe('CreateEdgeOp → BatchCreateLinkNodeOp', () => {
    it('converts reified CreateEdgeOp to BatchCreateLinkNodeOp', () => {
      const op: CreateEdgeOp = {
        type: 'createEdge',
        edgeType: 'orderItem',
        fromId: 'order-1',
        toId: 'prod-1',
        edgeId: 'oi-1',
        data: { quantity: 3 },
      }
      const result = pass.transform(op, schema) as BatchCreateLinkNodeOp

      expect(result.type).toBe('batchCreateLinkNode')
      expect(result.edgeType).toBe('orderItem')
      expect(result.linkLabel).toBe('OrderItem')
      expect(result.fromLabels).toEqual(['Order'])
      expect(result.toLabels).toEqual(['Product'])
      expect(result.items).toHaveLength(1)
      expect(result.items[0]!.fromId).toBe('order-1')
      expect(result.items[0]!.toId).toBe('prod-1')
      expect(result.items[0]!.id).toBe('oi-1')
      expect(result.items[0]!.data).toEqual({ quantity: 3 })
      // No instance model knowledge
      expect(result.links).toBeUndefined()
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

    it('compiles to has_link/links_to Cypher (no IM)', () => {
      const op: CreateEdgeOp = {
        type: 'createEdge',
        edgeType: 'orderItem',
        fromId: 'o1',
        toId: 'p1',
        edgeId: 'oi-1',
        data: { quantity: 3 },
      }
      const result = pass.transform(op, schemaNoIM) as BatchCreateLinkNodeOp
      const cypher = compileNoIM(result)

      expect(cypher).toContain('has_link')
      expect(cypher).toContain('links_to')
      expect(cypher).toContain(':OrderItem')
      expect(cypher).not.toContain('instance_of')
    })
  })

  describe('BatchLinkOp → BatchCreateLinkNodeOp', () => {
    it('converts reified BatchLinkOp', () => {
      const op: BatchLinkOp = {
        type: 'batchLink',
        edgeType: 'orderItem',
        links: [
          { fromId: 'o1', toId: 'p1', edgeId: 'oi-1' },
          { fromId: 'o1', toId: 'p2', edgeId: 'oi-2' },
        ],
      }
      const result = pass.transform(op, schema) as BatchCreateLinkNodeOp

      expect(result.type).toBe('batchCreateLinkNode')
      expect(result.edgeType).toBe('orderItem')
      expect(result.linkLabel).toBe('OrderItem')
      expect(result.items).toHaveLength(2)
      expect(result.items[0]!.id).toBe('oi-1')
      expect(result.items[1]!.id).toBe('oi-2')
    })
  })

  describe('BatchUnlinkOp → BatchDeleteLinkNodeOp', () => {
    it('converts reified BatchUnlinkOp', () => {
      const op: BatchUnlinkOp = {
        type: 'batchUnlink',
        edgeType: 'orderItem',
        links: [{ fromId: 'o1', toId: 'p1' }],
      }
      const result = pass.transform(op, schema) as BatchDeleteLinkNodeOp

      expect(result.type).toBe('batchDeleteLinkNode')
      expect(result.linkLabel).toBe('OrderItem')
      expect(result.fromLabels).toEqual(['Order'])
      expect(result.toLabels).toEqual(['Product'])
    })
  })

  describe('UpdateEdgeOp → UpdateLinkNodeOp', () => {
    it('converts reified UpdateEdgeOp', () => {
      const op: UpdateEdgeOp = {
        type: 'updateEdge',
        edgeType: 'orderItem',
        fromId: 'order-1',
        toId: 'prod-1',
        data: { quantity: 5 },
      }
      const result = pass.transform(op, schema) as UpdateLinkNodeOp

      expect(result.type).toBe('updateLinkNode')
      expect(result.linkLabel).toBe('OrderItem')
      expect(result.fromId).toBe('order-1')
      expect(result.toId).toBe('prod-1')
      expect(result.data).toEqual({ quantity: 5 })
    })

    it('compiles to has_link/links_to pattern', () => {
      const op: UpdateEdgeOp = {
        type: 'updateEdge',
        edgeType: 'orderItem',
        fromId: 'order-1',
        toId: 'prod-1',
        data: { quantity: 5 },
      }
      const result = pass.transform(op, schemaNoIM) as UpdateLinkNodeOp
      const cypher = compileNoIM(result)

      expect(cypher).toContain('has_link')
      expect(cypher).toContain('links_to')
      expect(cypher).toContain(':OrderItem')
    })
  })

  describe('DeleteEdgeOp → DeleteLinkNodeOp', () => {
    it('converts reified DeleteEdgeOp', () => {
      const op: DeleteEdgeOp = {
        type: 'deleteEdge',
        edgeType: 'orderItem',
        fromId: 'order-1',
        toId: 'prod-1',
      }
      const result = pass.transform(op, schema) as DeleteLinkNodeOp

      expect(result.type).toBe('deleteLinkNode')
      expect(result.linkLabel).toBe('OrderItem')
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
      expect(result.label).toBe('OrderItem')
      expect(result.id).toBe('oi-1')
      expect(result.data).toEqual({ quantity: 10 })
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
      expect(result.label).toBe('OrderItem')
      expect(result.id).toBe('oi-1')
      expect(result.detach).toBe(true)
    })
  })

  describe('UnlinkAllFrom/To → DeleteLinkNodesFrom/To', () => {
    it('converts reified UnlinkAllFromOp', () => {
      const op: UnlinkAllFromOp = {
        type: 'unlinkAllFrom',
        edgeType: 'orderItem',
        fromId: 'o1',
      }
      const result = pass.transform(op, schema) as DeleteLinkNodesFromOp

      expect(result.type).toBe('deleteLinkNodesFrom')
      expect(result.linkLabel).toBe('OrderItem')
      expect(result.fromLabels).toEqual(['Order'])
    })

    it('converts reified UnlinkAllToOp', () => {
      const op: UnlinkAllToOp = {
        type: 'unlinkAllTo',
        edgeType: 'orderItem',
        toId: 'p1',
      }
      const result = pass.transform(op, schema) as DeleteLinkNodesToOp

      expect(result.type).toBe('deleteLinkNodesTo')
      expect(result.linkLabel).toBe('OrderItem')
      expect(result.toLabels).toEqual(['Product'])
    })
  })

  describe('non-reified edges — passthrough', () => {
    it('does not transform non-reified edge ops', () => {
      const op: UpdateEdgeOp = {
        type: 'updateEdge',
        edgeType: 'placedOrder',
        fromId: 'c1',
        toId: 'o1',
        data: { note: 'test' },
      }
      const result = pass.transform(op, schema) as UpdateEdgeOp

      expect(result.type).toBe('updateEdge')
    })
  })

  describe('full pipeline (Reify → IM)', () => {
    it('produces kernel-compliant mutation Cypher', () => {
      const reifyPass = new ReifyEdgesMutationPass()
      const imPass = new InstanceOfMutationPass()

      // Create an edge — reify first, then IM
      const edgeOp: CreateEdgeOp = {
        type: 'createEdge',
        edgeType: 'orderItem',
        fromId: 'o-1',
        toId: 'p-1',
        edgeId: 'oi-1',
        data: { quantity: 2 },
      }

      // Pass 1: Reify
      const afterReify = reifyPass.transform(edgeOp, schema)
      const reifiedOps = Array.isArray(afterReify) ? afterReify : [afterReify]

      // Pass 2: IM
      const afterIM = reifiedOps.flatMap((op) => {
        const r = imPass.transform(op, schema)
        return Array.isArray(r) ? r : [r]
      })

      const finalOp = afterIM[0]! as BatchCreateLinkNodeOp
      expect(finalOp.type).toBe('batchCreateLinkNode')
      expect(finalOp.linkLabel).toBe('Link')
      expect(finalOp.fromLabels).toEqual(['Node'])
      expect(finalOp.toLabels).toEqual(['Node'])
      expect(finalOp.links).toBeDefined()
      expect(finalOp.links![0]!.edgeType).toBe('instance_of')
      expect(finalOp.links![0]!.targetId).toBe('cls-order-item')

      const cypher = compile(finalOp)
      expect(cypher).toContain(':Link')
      expect(cypher).toContain('has_link')
      expect(cypher).toContain('links_to')
      expect(cypher).toContain('instance_of')
      expect(cypher).toContain(':Node')
    })

    it('creates node correctly in full pipeline', () => {
      const reifyPass = new ReifyEdgesMutationPass()
      const imPass = new InstanceOfMutationPass()

      const createOp: MutationOp = {
        type: 'createNode',
        label: 'order',
        id: 'o-1',
        data: { status: 'pending' },
      }

      // Pass 1: Reify (no-op for createNode)
      const afterReify = reifyPass.transform(createOp, schema)
      const reifiedOps = Array.isArray(afterReify) ? afterReify : [afterReify]

      // Pass 2: IM
      const afterIM = reifiedOps.flatMap((op) => {
        const r = imPass.transform(op, schema)
        return Array.isArray(r) ? r : [r]
      })

      const createCypher = compile(afterIM[0]!)
      expect(createCypher).toContain(':Node')
      expect(createCypher).toContain('instance_of')
    })
  })
})
