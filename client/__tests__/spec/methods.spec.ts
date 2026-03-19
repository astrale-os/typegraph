import { describe, it, expect, vi } from 'vitest'
import {
  collectMethodNames,
  MethodNotDispatchedError,
  enrichNode,
  enrichEdge,
  enforceConstraints,
  resolveEndpoints,
  ConstraintViolation,
} from '../../src'
import type { MethodSchemaInfo, MethodDispatchFn, ConstraintSchemaInfo } from '../../src'

// ─── Test Schema Info ────────────────────────────────────────

const schemaInfo: MethodSchemaInfo & ConstraintSchemaInfo = {
  nodes: {
    Timestamped: { abstract: true, implements: [] },
    Customer: { abstract: false, implements: ['Timestamped'] },
    Product: { abstract: false, implements: ['Timestamped'] },
    Order: { abstract: false, implements: [] },
  },
  edges: {
    placed_order: {
      endpoints: {
        customer: { types: ['Customer'] },
        order: { types: ['Order'] },
      },
      constraints: { unique: true },
    },
    parent_category: {
      endpoints: {
        child: { types: ['Product'], cardinality: { min: 0, max: 1 } },
        parent: { types: ['Product'] },
      },
      constraints: { no_self: true, acyclic: true },
    },
    order_item: {
      endpoints: {
        order: { types: ['Order'] },
        product: { types: ['Product'] },
      },
    },
  },
  methods: {
    Timestamped: {
      age: { params: {}, returns: 'Int' },
    },
    Customer: {
      displayName: { params: {}, returns: 'String' },
    },
    order_item: {
      subtotal: { params: {}, returns: 'Int' },
    },
  },
}

// ─── Method Name Collection ──────────────────────────────────

describe('collectMethodNames', () => {
  it('collects own + inherited method names', () => {
    const names = collectMethodNames(schemaInfo, 'Customer')
    expect(names).toContain('displayName')
    expect(names).toContain('age') // inherited from Timestamped
  })

  it('collects only inherited for types with no own methods', () => {
    const names = collectMethodNames(schemaInfo, 'Product')
    expect(names).toContain('age')
    expect(names).not.toContain('displayName')
  })

  it('returns empty array for types without methods', () => {
    const names = collectMethodNames(schemaInfo, 'Order')
    expect(names).toEqual([])
  })

  it('collects edge method names', () => {
    const names = collectMethodNames(schemaInfo, 'order_item')
    expect(names).toContain('subtotal')
  })
})

// ─── Enrichment ──────────────────────────────────────────────

describe('enrichment', () => {
  it('adds dispatch proxies to nodes', () => {
    const dispatch = vi.fn(async (_name, _auth, _params, self) => self.name)
    const methodNames = ['displayName']
    const raw = { id: '1', name: 'Alice', __type: 'Customer' }
    const enriched = enrichNode('Customer', raw, methodNames, dispatch, { sub: 'test' })

    expect(enriched.name).toBe('Alice')
    expect(typeof (enriched as any).displayName).toBe('function')
  })

  it('dispatches method calls with correct arguments', async () => {
    const dispatch = vi.fn(async () => 'Alice')
    const methodNames = ['displayName']
    const raw = { id: '1', name: 'Alice', __type: 'Customer' }
    const auth = { sub: 'test-user' }
    const enriched = enrichNode('Customer', raw, methodNames, dispatch, auth)

    const result = await (enriched as any).displayName()
    expect(result).toBe('Alice')
    expect(dispatch).toHaveBeenCalledWith('Customer.displayName', auth, undefined, raw)
  })

  it('passes method args as params', async () => {
    const dispatch = vi.fn(async () => [])
    const methodNames = ['recentOrders']
    const raw = { id: '1', name: 'Alice', __type: 'Customer' }
    const auth = { sub: 'test-user' }
    const enriched = enrichNode('Customer', raw, methodNames, dispatch, auth)

    await (enriched as any).recentOrders({ limit: 5 })
    expect(dispatch).toHaveBeenCalledWith('Customer.recentOrders', auth, { limit: 5 }, raw)
  })

  it('returns raw object if no method names', () => {
    const raw = { id: '1', title: 'Widget' }
    const enriched = enrichNode('Product', raw, [], undefined, undefined)
    expect(enriched).toBe(raw)
  })

  it('throws MethodNotDispatchedError if no dispatch function', () => {
    const methodNames = ['displayName']
    const raw = { id: '1', name: 'Alice', __type: 'Customer' }
    const enriched = enrichNode('Customer', raw, methodNames, undefined, undefined)

    expect(() => (enriched as any).displayName()).toThrow(MethodNotDispatchedError)
  })

  it('adds dispatch proxies to edges', async () => {
    const dispatch = vi.fn(async (_name, _auth, _params, self) => {
      return self.quantity * self.unit_price
    })
    const methodNames = ['subtotal']
    const raw = { id: 'o1:p1', quantity: 3, unit_price: 500 }
    const auth = { sub: 'test' }
    const enriched = enrichEdge('order_item', raw, methodNames, dispatch, auth)

    expect(enriched.quantity).toBe(3)
    const result = await (enriched as any).subtotal()
    expect(result).toBe(1500)
    expect(dispatch).toHaveBeenCalledWith('order_item.subtotal', auth, undefined, raw)
  })
})

// ─── Constraint Enforcement ──────────────────────────────────

describe('resolveEndpoints', () => {
  it('resolves named endpoints to from/to', () => {
    const resolved = resolveEndpoints('placed_order', { customer: 'c1', order: 'o1' }, schemaInfo)
    expect(resolved.from).toBe('c1')
    expect(resolved.to).toBe('o1')
    expect(resolved.fromParam).toBe('customer')
    expect(resolved.toParam).toBe('order')
  })

  it('throws on missing endpoint', () => {
    expect(() => resolveEndpoints('placed_order', { customer: 'c1' }, schemaInfo)).toThrow(
      "Missing endpoint 'order'",
    )
  })

  it('throws on unknown edge type', () => {
    expect(() => resolveEndpoints('fake_edge', { a: '1', b: '2' }, schemaInfo)).toThrow(
      'Unknown edge type',
    )
  })
})

describe('enforceConstraints', () => {
  function mockAdapter(overrides: Partial<Record<string, unknown[]>> = {}) {
    return {
      name: 'mock',
      connect: async () => {},
      close: async () => {},
      isConnected: async () => true,
      query: async <T>(cypher: string, _params?: Record<string, unknown>): Promise<T[]> => {
        if (cypher.includes('count(*)')) return [{ c: 0 }] as T[]
        if (cypher.includes('count(path)')) return [{ c: 0 }] as T[]
        return (overrides[cypher] ?? []) as T[]
      },
      mutate: async <T>(): Promise<T[]> => [],
      transaction: async <T>(fn: (tx: any) => Promise<T>) => fn({ run: async () => [] }),
    }
  }

  it('allows valid edge creation', async () => {
    const endpoints = resolveEndpoints('placed_order', { customer: 'c1', order: 'o1' }, schemaInfo)
    await expect(
      enforceConstraints(mockAdapter(), 'placed_order', endpoints, schemaInfo),
    ).resolves.not.toThrow()
  })

  it('rejects self-loop on no_self constraint', async () => {
    const endpoints = resolveEndpoints('parent_category', { child: 'p1', parent: 'p1' }, schemaInfo)
    await expect(
      enforceConstraints(mockAdapter(), 'parent_category', endpoints, schemaInfo),
    ).rejects.toThrow(ConstraintViolation)
  })

  it('rejects duplicate on unique constraint', async () => {
    const adapter = {
      ...mockAdapter(),
      query: async <T>(cypher: string): Promise<T[]> => {
        if (cypher.includes('count(*)')) return [{ c: 1 }] as T[]
        return [{ c: 0 }] as T[]
      },
    }
    const endpoints = resolveEndpoints('placed_order', { customer: 'c1', order: 'o1' }, schemaInfo)
    await expect(
      enforceConstraints(adapter, 'placed_order', endpoints, schemaInfo),
    ).rejects.toThrow(ConstraintViolation)
  })

  it('rejects cycle on acyclic constraint', async () => {
    const adapter = {
      ...mockAdapter(),
      query: async <T>(cypher: string): Promise<T[]> => {
        if (cypher.includes('count(path)')) return [{ c: 1 }] as T[]
        return [{ c: 0 }] as T[]
      },
    }
    const endpoints = resolveEndpoints('parent_category', { child: 'p1', parent: 'p2' }, schemaInfo)
    await expect(
      enforceConstraints(adapter, 'parent_category', endpoints, schemaInfo),
    ).rejects.toThrow(ConstraintViolation)
  })
})
