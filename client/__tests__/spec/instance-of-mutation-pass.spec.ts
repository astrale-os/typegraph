/**
 * InstanceOfMutationPass Specification Tests
 *
 * Tests for the mutation pass that rewrites node labels to :Node
 * and injects instance_of links to class nodes.
 */

import { describe, it, expect } from 'vitest'

import type {
  MutationOp,
  CreateNodeOp,
  UpdateNodeOp,
  DeleteNodeOp,
  UpsertNodeOp,
  CloneNodeOp,
  BatchCreateOp,
  BatchUpdateOp,
  BatchDeleteOp,
  CreateEdgeOp,
  BatchCreateLinkNodeOp,
  BatchDeleteLinkNodeOp,
  UpdateLinkNodeOp,
  DeleteLinkNodeOp,
  DeleteLinkNodesFromOp,
  DeleteLinkNodesToOp,
} from '../../src/mutation/ast/types'
import type { SchemaShape } from '../../src/schema'

import { MutationCypherCompiler } from '../../src/mutation/cypher/compiler'
import { InstanceOfMutationPass } from '../../src/mutation/passes/instance-of-mutation-pass'
import { ClassId } from '../../src/schema'
import { normalizeCypher } from './fixtures/test-schema'

// =============================================================================
// TEST FIXTURES
// =============================================================================

const schema: SchemaShape = {
  nodes: {
    customer: { abstract: false, attributes: ['name', 'email'] },
    order: { abstract: false, attributes: ['status'] },
    product: { abstract: false, attributes: ['title', 'price'] },
  },
  edges: {
    placedOrder: {
      endpoints: {
        customer: { types: ['customer'] },
        order: { types: ['order'] },
      },
    },
    orderItem: {
      endpoints: {
        order: { types: ['order'] },
        product: { types: ['product'] },
      },
      attributes: ['quantity'],
      reified: true,
    },
  },
  classRefs: {
    customer: ClassId('cls-customer'),
    order: ClassId('cls-order'),
    product: ClassId('cls-product'),
    orderItem: ClassId('cls-order-item'),
  },
}

const compiler = new MutationCypherCompiler()

function compileOp(op: MutationOp): string {
  return normalizeCypher(compiler.compileOne(op, schema).query)
}

// =============================================================================
// TESTS
// =============================================================================

describe('InstanceOfMutationPass', () => {
  const pass = new InstanceOfMutationPass()

  describe('CreateNodeOp', () => {
    it('relabels to Node and adds instance_of link', () => {
      const op: CreateNodeOp = {
        type: 'createNode',
        label: 'customer',
        id: 'c1',
        data: { name: 'Alice' },
      }
      const result = pass.transform(op, schema)
      const transformed = Array.isArray(result) ? result[0]! : result

      expect(transformed.type).toBe('createNode')
      const create = transformed as CreateNodeOp
      expect(create.label).toBe('Node')
      expect(create.links).toHaveLength(1)
      expect(create.links![0]).toEqual({
        edgeType: 'instance_of',
        targetId: 'cls-customer',
      })
    })

    it('compiles to Cypher with :Node label and instance_of edge', () => {
      const op: CreateNodeOp = {
        type: 'createNode',
        label: 'customer',
        id: 'c1',
        data: { name: 'Alice' },
      }
      const result = pass.transform(op, schema) as CreateNodeOp
      const cypher = compileOp(result)

      expect(cypher).toContain(':Node')
      expect(cypher).toContain('instance_of')
      expect(cypher).not.toContain(':Customer')
    })

    it('preserves existing links', () => {
      const op: CreateNodeOp = {
        type: 'createNode',
        label: 'customer',
        id: 'c1',
        data: { name: 'Alice' },
        links: [{ edgeType: 'belongs_to', targetId: 'org-1' }],
      }
      const result = pass.transform(op, schema) as CreateNodeOp

      expect(result.links).toHaveLength(2)
      expect(result.links![0]).toEqual({ edgeType: 'belongs_to', targetId: 'org-1' })
      expect(result.links![1]).toEqual({ edgeType: 'instance_of', targetId: 'cls-customer' })
    })
  })

  describe('UpdateNodeOp', () => {
    it('relabels to Node (no instance_of link needed)', () => {
      const op: UpdateNodeOp = {
        type: 'updateNode',
        label: 'customer',
        id: 'c1',
        data: { name: 'Bob' },
      }
      const result = pass.transform(op, schema) as UpdateNodeOp

      expect(result.label).toBe('Node')
      expect(result.id).toBe('c1')
      expect(result.data).toEqual({ name: 'Bob' })
    })

    it('compiles to Cypher matching :Node by ID', () => {
      const op: UpdateNodeOp = {
        type: 'updateNode',
        label: 'customer',
        id: 'c1',
        data: { name: 'Bob' },
      }
      const result = pass.transform(op, schema) as UpdateNodeOp
      const cypher = compileOp(result)

      expect(cypher).toContain(':Node')
      expect(cypher).not.toContain(':Customer')
    })
  })

  describe('DeleteNodeOp', () => {
    it('relabels to Node', () => {
      const op: DeleteNodeOp = {
        type: 'deleteNode',
        label: 'customer',
        id: 'c1',
        detach: true,
      }
      const result = pass.transform(op, schema) as DeleteNodeOp

      expect(result.label).toBe('Node')
    })
  })

  describe('UpsertNodeOp', () => {
    it('relabels to Node and adds instance_of link', () => {
      const op: UpsertNodeOp = {
        type: 'upsertNode',
        label: 'order',
        id: 'o1',
        data: { status: 'pending' },
      }
      const result = pass.transform(op, schema) as UpsertNodeOp

      expect(result.label).toBe('Node')
      expect(result.links).toHaveLength(1)
      expect(result.links![0]).toEqual({
        edgeType: 'instance_of',
        targetId: 'cls-order',
      })
    })

    it('compiles to Cypher with MERGE :Node and instance_of', () => {
      const op: UpsertNodeOp = {
        type: 'upsertNode',
        label: 'order',
        id: 'o1',
        data: { status: 'pending' },
      }
      const result = pass.transform(op, schema) as UpsertNodeOp
      const cypher = compileOp(result)

      expect(cypher).toContain('MERGE (n:Node')
      expect(cypher).toContain('instance_of')
    })
  })

  describe('CloneNodeOp', () => {
    it('relabels to Node and adds instance_of link', () => {
      const op: CloneNodeOp = {
        type: 'cloneNode',
        label: 'product',
        sourceId: 'p1',
        newId: 'p2',
        overrides: { title: 'Clone' },
      }
      const result = pass.transform(op, schema) as CloneNodeOp

      expect(result.label).toBe('Node')
      expect(result.links).toHaveLength(1)
      expect(result.links![0]).toEqual({
        edgeType: 'instance_of',
        targetId: 'cls-product',
      })
    })

    it('compiles to Cypher with :Node and instance_of edge', () => {
      const op: CloneNodeOp = {
        type: 'cloneNode',
        label: 'product',
        sourceId: 'p1',
        newId: 'p2',
        overrides: { title: 'Clone' },
      }
      const result = pass.transform(op, schema) as CloneNodeOp
      const cypher = compileOp(result)

      expect(cypher).toContain(':Node')
      expect(cypher).toContain('instance_of')
      expect(cypher).not.toContain(':Product')
    })
  })

  describe('BatchCreateOp', () => {
    it('relabels to Node and adds instance_of link', () => {
      const op: BatchCreateOp = {
        type: 'batchCreate',
        label: 'customer',
        items: [
          { id: 'c1', data: { name: 'Alice' } },
          { id: 'c2', data: { name: 'Bob' } },
        ],
      }
      const result = pass.transform(op, schema) as BatchCreateOp

      expect(result.label).toBe('Node')
      expect(result.links).toHaveLength(1)
      expect(result.links![0]).toEqual({
        edgeType: 'instance_of',
        targetId: 'cls-customer',
      })
    })
  })

  describe('BatchUpdateOp', () => {
    it('relabels to Node', () => {
      const op: BatchUpdateOp = {
        type: 'batchUpdate',
        label: 'customer',
        updates: [{ id: 'c1', data: { name: 'Updated' } }],
      }
      const result = pass.transform(op, schema) as BatchUpdateOp

      expect(result.label).toBe('Node')
    })
  })

  describe('BatchDeleteOp', () => {
    it('relabels to Node', () => {
      const op: BatchDeleteOp = {
        type: 'batchDelete',
        label: 'customer',
        ids: ['c1', 'c2'],
      }
      const result = pass.transform(op, schema) as BatchDeleteOp

      expect(result.label).toBe('Node')
    })
  })

  // =========================================================================
  // Link-Node Ops (from ReifyEdgesMutationPass)
  // =========================================================================

  describe('BatchCreateLinkNodeOp', () => {
    it('relabels to Link/Node and adds instance_of link', () => {
      const op: BatchCreateLinkNodeOp = {
        type: 'batchCreateLinkNode',
        edgeType: 'orderItem',
        linkLabel: 'OrderItem',
        fromLabels: ['Order'],
        toLabels: ['Product'],
        items: [{ id: 'oi-1', fromId: 'o1', toId: 'p1', data: { quantity: 3 } }],
      }
      const result = pass.transform(op, schema) as BatchCreateLinkNodeOp

      expect(result.linkLabel).toBe('Link')
      expect(result.fromLabels).toEqual(['Node'])
      expect(result.toLabels).toEqual(['Node'])
      expect(result.links).toHaveLength(1)
      expect(result.links![0]).toEqual({
        edgeType: 'instance_of',
        targetId: 'cls-order-item',
      })
    })

    it('preserves existing links on BatchCreateLinkNodeOp', () => {
      const op: BatchCreateLinkNodeOp = {
        type: 'batchCreateLinkNode',
        edgeType: 'orderItem',
        linkLabel: 'OrderItem',
        fromLabels: ['Order'],
        toLabels: ['Product'],
        items: [{ id: 'oi-1', fromId: 'o1', toId: 'p1' }],
        links: [{ edgeType: 'tagged_as', targetId: 'tag-1' }],
      }
      const result = pass.transform(op, schema) as BatchCreateLinkNodeOp

      expect(result.links).toHaveLength(2)
      expect(result.links![0]).toEqual({ edgeType: 'tagged_as', targetId: 'tag-1' })
      expect(result.links![1]).toEqual({ edgeType: 'instance_of', targetId: 'cls-order-item' })
    })

    it('compiles to Cypher with :Link, has_link, links_to, instance_of', () => {
      const op: BatchCreateLinkNodeOp = {
        type: 'batchCreateLinkNode',
        edgeType: 'orderItem',
        linkLabel: 'OrderItem',
        fromLabels: ['Order'],
        toLabels: ['Product'],
        items: [{ id: 'oi-1', fromId: 'o1', toId: 'p1', data: { quantity: 3 } }],
      }
      const result = pass.transform(op, schema) as BatchCreateLinkNodeOp
      const cypher = compileOp(result)

      expect(cypher).toContain(':Link')
      expect(cypher).toContain(':Node')
      expect(cypher).toContain('has_link')
      expect(cypher).toContain('links_to')
      expect(cypher).toContain('instance_of')
    })
  })

  describe('BatchDeleteLinkNodeOp', () => {
    it('relabels to Link/Node', () => {
      const op: BatchDeleteLinkNodeOp = {
        type: 'batchDeleteLinkNode',
        linkLabel: 'OrderItem',
        fromLabels: ['Order'],
        toLabels: ['Product'],
        links: [{ fromId: 'o1', toId: 'p1' }],
      }
      const result = pass.transform(op, schema) as BatchDeleteLinkNodeOp

      expect(result.linkLabel).toBe('Link')
      expect(result.fromLabels).toEqual(['Node'])
      expect(result.toLabels).toEqual(['Node'])
    })
  })

  describe('UpdateLinkNodeOp', () => {
    it('relabels to Link/Node', () => {
      const op: UpdateLinkNodeOp = {
        type: 'updateLinkNode',
        linkLabel: 'OrderItem',
        fromLabels: ['Order'],
        toLabels: ['Product'],
        fromId: 'o1',
        toId: 'p1',
        data: { quantity: 5 },
      }
      const result = pass.transform(op, schema) as UpdateLinkNodeOp

      expect(result.linkLabel).toBe('Link')
      expect(result.fromLabels).toEqual(['Node'])
      expect(result.toLabels).toEqual(['Node'])
      expect(result.data).toEqual({ quantity: 5 })
    })

    it('compiles to Cypher with :Link and has_link/links_to pattern', () => {
      const op: UpdateLinkNodeOp = {
        type: 'updateLinkNode',
        linkLabel: 'OrderItem',
        fromLabels: ['Order'],
        toLabels: ['Product'],
        fromId: 'o1',
        toId: 'p1',
        data: { quantity: 5 },
      }
      const result = pass.transform(op, schema) as UpdateLinkNodeOp
      const cypher = compileOp(result)

      expect(cypher).toContain(':Link')
      expect(cypher).toContain('has_link')
      expect(cypher).toContain('links_to')
      expect(cypher).toContain('SET linkNode')
    })
  })

  describe('DeleteLinkNodeOp', () => {
    it('relabels to Link/Node', () => {
      const op: DeleteLinkNodeOp = {
        type: 'deleteLinkNode',
        linkLabel: 'OrderItem',
        fromLabels: ['Order'],
        toLabels: ['Product'],
        fromId: 'o1',
        toId: 'p1',
      }
      const result = pass.transform(op, schema) as DeleteLinkNodeOp

      expect(result.linkLabel).toBe('Link')
      expect(result.fromLabels).toEqual(['Node'])
      expect(result.toLabels).toEqual(['Node'])
    })
  })

  describe('DeleteLinkNodesFromOp', () => {
    it('relabels linkLabel and fromLabels', () => {
      const op: DeleteLinkNodesFromOp = {
        type: 'deleteLinkNodesFrom',
        linkLabel: 'OrderItem',
        fromLabels: ['Order'],
        fromId: 'o1',
      }
      const result = pass.transform(op, schema) as DeleteLinkNodesFromOp

      expect(result.linkLabel).toBe('Link')
      expect(result.fromLabels).toEqual(['Node'])
    })
  })

  describe('DeleteLinkNodesToOp', () => {
    it('relabels linkLabel and toLabels', () => {
      const op: DeleteLinkNodesToOp = {
        type: 'deleteLinkNodesTo',
        linkLabel: 'OrderItem',
        toLabels: ['Product'],
        toId: 'p1',
      }
      const result = pass.transform(op, schema) as DeleteLinkNodesToOp

      expect(result.linkLabel).toBe('Link')
      expect(result.toLabels).toEqual(['Node'])
    })
  })

  describe('Edge ops — passthrough', () => {
    it('does not modify edge ops', () => {
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

    it('edge endpoints resolve to :Node when instance model enabled', () => {
      const op: CreateEdgeOp = {
        type: 'createEdge',
        edgeType: 'placedOrder',
        fromId: 'c1',
        toId: 'o1',
        edgeId: 'e1',
      }
      const cypher = compileOp(op)

      // With instance model, endpoints should be :Node
      expect(cypher).toContain('a:Node')
      expect(cypher).toContain('b:Node')
    })
  })

  describe('disabled pass', () => {
    it('returns op unchanged when classRefs is absent', () => {
      const schemaNoRefs: SchemaShape = {
        nodes: schema.nodes,
        edges: schema.edges,
      }
      const op: CreateNodeOp = {
        type: 'createNode',
        label: 'customer',
        id: 'c1',
        data: { name: 'Alice' },
      }
      const result = pass.transform(op, schemaNoRefs)
      expect(result).toEqual(op)
    })
  })

  describe('error handling', () => {
    it('throws when class ref is missing', () => {
      const schemaPartialRefs: SchemaShape = {
        ...schema,
        classRefs: { customer: ClassId('cls-customer') },
      }
      const op: CreateNodeOp = {
        type: 'createNode',
        label: 'order',
        id: 'o1',
        data: {},
      }

      expect(() => pass.transform(op, schemaPartialRefs)).toThrow(
        "no class ref found for type 'order'",
      )
    })
  })
})
