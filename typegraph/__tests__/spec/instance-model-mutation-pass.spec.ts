/**
 * InstanceModelMutationPass Specification Tests
 *
 * Tests for the mutation pass that rewrites node labels to :Node
 * and injects instance_of links to class nodes.
 */

import { describe, it, expect } from 'vitest'
import { InstanceModelMutationPass } from '../../src/compiler/passes/instance-model-mutation-pass'
import { MutationCypherCompiler } from '../../src/mutation/cypher/compiler'
import type { InstanceModelConfig, SchemaShape } from '../../src/schema'
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
  },
  implementors: {},
}

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
  },
  instanceModel: instanceModelConfig,
}

const compiler = new MutationCypherCompiler()

function compileOp(op: MutationOp): string {
  return normalizeCypher(compiler.compileOne(op, schema).query)
}

// =============================================================================
// TESTS
// =============================================================================

describe('InstanceModelMutationPass', () => {
  const pass = new InstanceModelMutationPass(instanceModelConfig)

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
    it('returns op unchanged when disabled', () => {
      const disabledPass = new InstanceModelMutationPass({
        enabled: false,
        refs: {},
        implementors: {},
      })
      const op: CreateNodeOp = {
        type: 'createNode',
        label: 'customer',
        id: 'c1',
        data: { name: 'Alice' },
      }
      const result = disabledPass.transform(op, schema)
      expect(result).toEqual(op)
    })
  })

  describe('error handling', () => {
    it('throws when class ref is missing', () => {
      const partialConfig: InstanceModelConfig = {
        enabled: true,
        refs: { customer: 'cls-customer' }, // no 'order' ref
        implementors: {},
      }
      const partialPass = new InstanceModelMutationPass(partialConfig)
      const op: CreateNodeOp = {
        type: 'createNode',
        label: 'order',
        id: 'o1',
        data: {},
      }

      expect(() => partialPass.transform(op, schema)).toThrow(
        "no class ref found for type 'order'",
      )
    })
  })
})
