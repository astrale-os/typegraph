import { describe, it, expect } from 'vitest'
import {
  validateMethodImplementations,
  collectRequiredMethods,
  MethodNotImplementedError,
  enrichNode,
  enrichEdge,
  enforceConstraints,
  resolveEndpoints,
  ConstraintViolation,
} from '../../src'
import type { MethodSchemaInfo, MethodsConfig, ConstraintSchemaInfo } from '../../src'

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

// ─── Method Validation ───────────────────────────────────────

describe('method validation', () => {
  it('passes when all methods are implemented', () => {
    const methods: MethodsConfig = {
      Customer: { age: () => 42, displayName: () => 'John' },
      Product: { age: () => 100 },
      order_item: { subtotal: () => 500 },
    }
    expect(() => validateMethodImplementations(schemaInfo, methods)).not.toThrow()
  })

  it('fails when a node method is missing', () => {
    const methods: MethodsConfig = {
      Customer: { displayName: () => 'John' }, // missing age
      Product: { age: () => 100 },
      order_item: { subtotal: () => 500 },
    }
    expect(() => validateMethodImplementations(schemaInfo, methods)).toThrow(
      MethodNotImplementedError,
    )
  })

  it('fails when an inherited method is missing', () => {
    const methods: MethodsConfig = {
      Customer: { displayName: () => 'John' }, // missing inherited age
      Product: {}, // missing inherited age
      order_item: { subtotal: () => 500 },
    }
    try {
      validateMethodImplementations(schemaInfo, methods)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(MethodNotImplementedError)
      const err = e as MethodNotImplementedError
      expect(err.missing.some((m) => m.includes('inherited from Timestamped'))).toBe(true)
    }
  })

  it('fails when an edge method is missing', () => {
    const methods: MethodsConfig = {
      Customer: { age: () => 42, displayName: () => 'John' },
      Product: { age: () => 100 },
      // missing order_item.subtotal
    }
    expect(() => validateMethodImplementations(schemaInfo, methods)).toThrow(
      MethodNotImplementedError,
    )
  })

  it('skips abstract types', () => {
    // Timestamped is abstract — no direct implementation required
    const methods: MethodsConfig = {
      Customer: { age: () => 42, displayName: () => 'John' },
      Product: { age: () => 100 },
      order_item: { subtotal: () => 500 },
    }
    expect(() => validateMethodImplementations(schemaInfo, methods)).not.toThrow()
  })

  it('passes with empty methods when schema has none', () => {
    const noMethodsSchema: MethodSchemaInfo = {
      nodes: { User: { abstract: false } },
      edges: {},
      methods: {},
    }
    expect(() => validateMethodImplementations(noMethodsSchema, undefined)).not.toThrow()
  })
})

describe('collectRequiredMethods', () => {
  it('collects own + inherited methods', () => {
    const required = collectRequiredMethods(schemaInfo, 'Customer')
    expect(required.get('displayName')).toBe('Customer')
    expect(required.get('age')).toBe('Timestamped')
  })

  it('collects only inherited for types with no own methods', () => {
    const required = collectRequiredMethods(schemaInfo, 'Product')
    expect(required.get('age')).toBe('Timestamped')
    expect(required.has('displayName')).toBe(false)
  })
})

// ─── Enrichment ──────────────────────────────────────────────

describe('enrichment', () => {
  it('adds method proxies to nodes', () => {
    const methods: MethodsConfig = {
      Customer: {
        displayName: (ctx) => (ctx.self as any).name,
      },
    }
    const raw = { id: '1', name: 'Alice', __type: 'Customer' }
    const enriched = enrichNode('Customer', raw, methods, null)

    expect(enriched.name).toBe('Alice')
    expect(typeof (enriched as any).displayName).toBe('function')
    expect((enriched as any).displayName()).toBe('Alice')
  })

  it('returns raw object if no methods for type', () => {
    const raw = { id: '1', title: 'Widget' }
    const enriched = enrichNode('Product', raw, {}, null)
    expect(enriched).toBe(raw) // same reference, no proxy
  })

  it('adds method proxies to edges', () => {
    const methods: MethodsConfig = {
      order_item: {
        subtotal: (ctx) => {
          const s = ctx.self as Record<string, unknown>
          return (s.quantity as number) * (s.unit_price as number)
        },
      },
    }
    const raw = { quantity: 3, unit_price: 500, endpoints: { order: 'o1', product: 'p1' } }
    const enriched = enrichEdge('order_item', raw, methods, null)

    expect(enriched.quantity).toBe(3)
    expect((enriched as any).subtotal()).toBe(1500)
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
  // Create a mock adapter for constraint testing
  function mockAdapter(overrides: Partial<Record<string, unknown[]>> = {}) {
    return {
      name: 'mock',
      connect: async () => {},
      close: async () => {},
      isConnected: async () => true,
      query: async <T>(cypher: string, _params?: Record<string, unknown>): Promise<T[]> => {
        // Default: no edges exist
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
