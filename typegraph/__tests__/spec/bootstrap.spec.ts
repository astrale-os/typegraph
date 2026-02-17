/**
 * Bootstrap Specification Tests
 *
 * Tests for bootstrapSchema (DB-backed meta-model creation).
 * Uses a minimal mock adapter that handles UNWIND/MERGE patterns.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { bootstrapSchema } from '../../src/bootstrap'
import type { SchemaShape } from '../../src/schema'
import type { GraphAdapter, TransactionContext } from '../../src/adapter'

// =============================================================================
// MOCK ADAPTER (handles bootstrap Cypher patterns)
// =============================================================================

class BootstrapMockAdapter implements GraphAdapter {
  readonly name = 'bootstrap-mock'
  /** All mutate() calls recorded for inspection */
  readonly calls: { cypher: string; params: Record<string, unknown> }[] = []

  async connect() {}
  async close() {}
  async isConnected() { return true }
  async query<T>(): Promise<T[]> { return [] }
  async transaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ run: () => Promise.resolve([]) })
  }

  async mutate<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    this.calls.push({ cypher, params: params ?? {} })

    // Handle UNWIND + MERGE patterns — return key/id pairs
    if (cypher.includes('UNWIND') && cypher.includes('RETURN')) {
      const items = (params?.items ?? params?.edges ?? []) as { key?: string; newId?: string }[]
      return items
        .filter((item) => item.key && item.newId)
        .map((item) => ({ key: item.key, id: item.newId })) as T[]
    }

    return [] as T[]
  }
}

// =============================================================================
// TEST FIXTURES
// =============================================================================

const simpleSchema: SchemaShape = {
  nodes: {
    customer: { abstract: false, attributes: ['name'] },
    order: { abstract: false, attributes: ['status'] },
    product: { abstract: false, attributes: ['title'] },
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
      reified: true,
    },
  },
}

const polymorphicSchema: SchemaShape = {
  nodes: {
    timestamped: { abstract: true, attributes: ['createdAt', 'updatedAt'] },
    identifiable: { abstract: true, attributes: ['slug'], implements: ['timestamped'] },
    customer: { abstract: false, attributes: ['name'], implements: ['timestamped'] },
    product: { abstract: false, attributes: ['title'], implements: ['identifiable'] },
    order: { abstract: false, attributes: ['status'] },
  },
  edges: {},
}

const ROOT_ID = 'root-123'

// =============================================================================
// TESTS
// =============================================================================

describe('bootstrapSchema', () => {
  let adapter: BootstrapMockAdapter

  beforeEach(() => {
    adapter = new BootstrapMockAdapter()
  })

  describe('refs map', () => {
    it('creates refs for all concrete types', async () => {
      const result = await bootstrapSchema(simpleSchema, adapter, ROOT_ID)

      expect(result.refs.customer).toBeDefined()
      expect(result.refs.order).toBeDefined()
      expect(result.refs.product).toBeDefined()
    })

    it('creates refs for abstract types', async () => {
      const result = await bootstrapSchema(polymorphicSchema, adapter, ROOT_ID)

      expect(result.refs.timestamped).toBeDefined()
      expect(result.refs.identifiable).toBeDefined()
    })

    it('creates refs for reified edge types (link classes)', async () => {
      const result = await bootstrapSchema(simpleSchema, adapter, ROOT_ID)

      expect(result.refs.orderItem).toBeDefined()
      // Non-reified edge should not have a ref
      expect(result.refs.placedOrder).toBeUndefined()
    })

    it('auto-generates unique IDs (not deterministic)', async () => {
      const result = await bootstrapSchema(simpleSchema, adapter, ROOT_ID)

      // IDs should be UUID-based, not deterministic cls-/iface- format
      expect(result.refs.customer).toMatch(/^Class_/)
      expect(result.refs.orderItem).toMatch(/^Class_/)
    })
  })

  describe('implementors map', () => {
    it('maps abstract types to their concrete implementor IDs', async () => {
      const result = await bootstrapSchema(polymorphicSchema, adapter, ROOT_ID)

      // customer implements timestamped directly
      expect(result.implementors.timestamped).toContain(result.refs.customer)
      // product implements identifiable which extends timestamped
      expect(result.implementors.timestamped).toContain(result.refs.product)
      // order has no implements
      expect(result.implementors.timestamped).not.toContain(result.refs.order)
    })

    it('handles transitive implements', async () => {
      const result = await bootstrapSchema(polymorphicSchema, adapter, ROOT_ID)

      // product implements identifiable directly
      expect(result.implementors.identifiable).toContain(result.refs.product)
      // customer does NOT implement identifiable
      expect(result.implementors.identifiable).not.toContain(result.refs.customer)
    })
  })

  describe('stats', () => {
    it('counts classes including link classes', async () => {
      const result = await bootstrapSchema(simpleSchema, adapter, ROOT_ID)

      // 3 node-classes + 1 link-class
      expect(result.stats.classesCreated).toBe(4)
      expect(result.stats.interfacesCreated).toBe(0)
    })

    it('counts interfaces', async () => {
      const result = await bootstrapSchema(polymorphicSchema, adapter, ROOT_ID)

      expect(result.stats.interfacesCreated).toBe(2)
    })

    it('counts hasParent edges for all nodes', async () => {
      const result = await bootstrapSchema(simpleSchema, adapter, ROOT_ID)

      // 3 concrete + 1 link-class = 4 hasParent edges
      expect(result.stats.hasParentEdges).toBe(4)
    })

    it('counts implements edges', async () => {
      const result = await bootstrapSchema(polymorphicSchema, adapter, ROOT_ID)

      // customer→timestamped, product→identifiable = 2
      expect(result.stats.implementsEdges).toBe(2)
    })

    it('counts extends edges', async () => {
      const result = await bootstrapSchema(polymorphicSchema, adapter, ROOT_ID)

      // identifiable extends timestamped = 1
      expect(result.stats.extendsEdges).toBe(1)
    })
  })

  describe('Cypher queries', () => {
    it('executes exactly 5 queries', async () => {
      await bootstrapSchema(polymorphicSchema, adapter, ROOT_ID)

      // classes, interfaces, implements, extends, hasParent
      expect(adapter.calls.length).toBe(5)
    })

    it('uses MERGE on key (not id)', async () => {
      await bootstrapSchema(simpleSchema, adapter, ROOT_ID)

      const classQuery = adapter.calls[0].cypher
      expect(classQuery).toContain('MERGE')
      expect(classQuery).toContain('{key:')
    })

    it('passes rootId for hasParent query', async () => {
      await bootstrapSchema(simpleSchema, adapter, ROOT_ID)

      const hasParentCall = adapter.calls[adapter.calls.length - 1]
      expect(hasParentCall.params.rootId).toBe(ROOT_ID)
    })
  })

  describe('callbacks', () => {
    it('calls onNode for each created node', async () => {
      const nodes: { kind: string; key: string; id: string }[] = []

      await bootstrapSchema(simpleSchema, adapter, ROOT_ID, {
        onNode: (kind, key, id) => nodes.push({ kind, key, id }),
      })

      // 3 concrete + 1 link-class = 4 class nodes
      const classNodes = nodes.filter((n) => n.kind === 'class')
      expect(classNodes.length).toBe(4)
      expect(classNodes.map((n) => n.key)).toContain('customer')
      expect(classNodes.map((n) => n.key)).toContain('orderItem')
    })

    it('calls onEdge for structural edges', async () => {
      const edges: { type: string; from: string; to: string }[] = []

      await bootstrapSchema(polymorphicSchema, adapter, ROOT_ID, {
        onEdge: (type, from, to) => edges.push({ type, from, to }),
      })

      const implEdges = edges.filter((e) => e.type === 'implements')
      const extEdges = edges.filter((e) => e.type === 'extends')
      const parentEdges = edges.filter((e) => e.type === 'has_parent')

      expect(implEdges.length).toBe(2)
      expect(extEdges.length).toBe(1)
      expect(parentEdges.length).toBe(5) // 3 classes + 2 interfaces
    })
  })

  describe('reifyEdges: true (global)', () => {
    it('creates link classes for ALL edges when reifyEdges is true', async () => {
      const globalReifySchema: SchemaShape = {
        ...simpleSchema,
        reifyEdges: true,
      }
      const result = await bootstrapSchema(globalReifySchema, adapter, ROOT_ID)

      expect(result.refs.orderItem).toBeDefined()
      expect(result.refs.placedOrder).toBeDefined()
    })
  })
})
