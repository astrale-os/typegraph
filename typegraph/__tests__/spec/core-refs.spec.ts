/**
 * Core Refs Tests
 *
 * Tests the full core refs feature:
 * 1. createCoreProxy() — proxy behavior, nested access, operators
 * 2. installCore() — CoreRefs building during installation
 * 3. Graph integration — graph.core.* with proper generic typing
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import { createCoreProxy } from '../../src/core-proxy'
import { installCore, type CoreDefinition, type CoreRefs } from '../../src/core'
import { createGraph, type Graph } from '../../src/graph'
import type { UntypedMap } from '../../src/schema'
import { NodeId } from '../../src/schema'
import { MockAdapter } from '../mock-adapter'
import { testSchema, type TestSchema } from './fixtures/test-schema'

// ─── Helpers ─────────────────────────────────────────────────

/** Create a CoreNodeDef inline */
function coreNode(
  type: string,
  props: Record<string, unknown>,
  children?: Record<string, ReturnType<typeof coreNode>>,
) {
  return { __type: type, props, ...(children ? { children } : {}) } as const
}

/** Create a connected graph with testSchema */
async function createTestGraph() {
  const adapter = new MockAdapter()
  await adapter.connect()
  return createGraph(testSchema, { adapter })
}

// ─── CoreRefs types for typed tests ──────────────────────────

type FlatCoreRefs = {
  admin: NodeId
  product: NodeId
}

type NestedCoreRefs = {
  admin: NodeId
  electronics: {
    phones: NodeId
    laptops: NodeId
  }
  clothing: NodeId
}

// =============================================================================
// 1. createCoreProxy — Unit Tests
// =============================================================================

describe('createCoreProxy', () => {
  it('returns leaf node IDs directly', () => {
    const refs: CoreRefs = {
      admin: NodeId('node-id-123'),
      product: NodeId('node-id-456'),
    }
    const proxy = createCoreProxy(refs)

    expect(proxy.admin).toBe('node-id-123')
    expect(proxy.product).toBe('node-id-456')
  })

  it('supports nested access through parent nodes', () => {
    const refs: CoreRefs = {
      electronics: {
        phones: NodeId('node-id-phones'),
        laptops: NodeId('node-id-laptops'),
      },
    }
    const proxy = createCoreProxy(refs)

    expect(proxy.electronics.phones).toBe('node-id-phones')
    expect(proxy.electronics.laptops).toBe('node-id-laptops')
  })

  it('supports multi-level nesting', () => {
    const refs: CoreRefs = {
      root: {
        level1: {
          level2: NodeId('node-id-deep'),
        },
      },
    }
    const proxy = createCoreProxy(refs)

    expect(proxy.root.level1.level2).toBe('node-id-deep')
  })

  it('returns undefined for missing keys', () => {
    const refs: CoreRefs = { admin: NodeId('node-id-123') }
    const proxy = createCoreProxy(refs)

    expect(proxy.nonexistent).toBeUndefined()
  })

  it('supports "in" operator', () => {
    const refs: CoreRefs = { admin: NodeId('node-id-123') }
    const proxy = createCoreProxy(refs)

    expect('admin' in proxy).toBe(true)
    expect('missing' in proxy).toBe(false)
  })

  it('supports Object.keys()', () => {
    const refs: CoreRefs = {
      admin: NodeId('node-id-1'),
      product: NodeId('node-id-2'),
      electronics: {
        phones: NodeId('node-id-3'),
      },
    }
    const proxy = createCoreProxy(refs)

    expect(Object.keys(proxy)).toEqual(['admin', 'product', 'electronics'])
  })

  it('mixes flat and nested refs', () => {
    const refs: CoreRefs = {
      admin: NodeId('node-id-admin'),
      electronics: {
        phones: NodeId('node-id-phones'),
      },
      product: NodeId('node-id-product'),
    }
    const proxy = createCoreProxy(refs)

    expect(proxy.admin).toBe('node-id-admin')
    expect(proxy.product).toBe('node-id-product')
    expect(proxy.electronics.phones).toBe('node-id-phones')
  })
})

// =============================================================================
// 2. installCore — CoreRefs Building
// =============================================================================

describe('installCore CoreRefs', () => {
  it('builds flat CoreRefs for nodes without children', async () => {
    const graph = await createTestGraph()

    const core: CoreDefinition = {
      nodes: {
        admin: coreNode('user', { email: 'admin@test.com', name: 'Admin' }),
        blog: coreNode('post', { title: 'First Post', content: 'Hello' }),
      },
    }

    const result = await installCore(graph, core)

    // Leaf nodes are strings (IDs)
    expect(typeof result.core.admin).toBe('string')
    expect(typeof result.core.blog).toBe('string')

    // IDs are defined
    expect(result.core.admin).toBeDefined()
    expect(result.core.blog).toBeDefined()

    expect(result.created.nodes).toBe(2)
  })

  it('builds hierarchical CoreRefs for nodes with children', async () => {
    const graph = await createTestGraph()

    const core: CoreDefinition = {
      nodes: {
        electronics: coreNode(
          'category',
          { name: 'Electronics', slug: 'electronics' },
          {
            phones: coreNode('category', { name: 'Phones', slug: 'phones' }),
            laptops: coreNode('category', { name: 'Laptops', slug: 'laptops' }),
          },
        ),
      },
    }

    const result = await installCore(graph, core)

    // Parent is an object with children
    expect(typeof result.core.electronics).toBe('object')
    const electronics = result.core.electronics as CoreRefs
    expect(typeof electronics.phones).toBe('string')
    expect(typeof electronics.laptops).toBe('string')

    expect(result.created.nodes).toBe(3)
  })

  it('handles mixed flat and nested nodes', async () => {
    const graph = await createTestGraph()

    const core: CoreDefinition = {
      nodes: {
        admin: coreNode('user', { email: 'admin@test.com', name: 'Admin' }),
        electronics: coreNode(
          'category',
          { name: 'Electronics', slug: 'electronics' },
          {
            phones: coreNode('category', { name: 'Phones', slug: 'phones' }),
            laptops: coreNode('category', { name: 'Laptops', slug: 'laptops' }),
          },
        ),
        clothing: coreNode('category', { name: 'Clothing', slug: 'clothing' }),
      },
    }

    const result = await installCore(graph, core)

    // Flat leaf: admin, clothing
    expect(typeof result.core.admin).toBe('string')
    expect(typeof result.core.clothing).toBe('string')

    // Nested: electronics
    expect(typeof result.core.electronics).toBe('object')
    const electronics = result.core.electronics as CoreRefs
    expect(typeof electronics.phones).toBe('string')
    expect(typeof electronics.laptops).toBe('string')

    expect(result.created.nodes).toBe(5)
  })

  it('builds CoreRefs for nested children correctly', async () => {
    const graph = await createTestGraph()

    const core: CoreDefinition = {
      nodes: {
        root: coreNode(
          'category',
          { name: 'Root', slug: 'root' },
          {
            child: coreNode('category', { name: 'Child', slug: 'child' }),
          },
        ),
      },
    }

    const result = await installCore(graph, core)

    expect(result.created.nodes).toBe(2)

    // Nested structure preserved
    const root = result.core.root as CoreRefs
    expect(typeof root.child).toBe('string')
  })

  it('invokes beforeCreate hook on every node', async () => {
    const graph = await createTestGraph()

    const core: CoreDefinition = {
      nodes: {
        admin: coreNode('user', { email: 'admin@test.com', name: 'Admin' }),
      },
    }

    const types: string[] = []
    const result = await installCore(graph, core, {
      beforeCreate: (type, props) => {
        types.push(type)
        return { createdAt: '2024-01-01', ...props }
      },
    })

    expect(types).toEqual(['user'])
    expect(result.core.admin).toBeDefined()
  })

  it('invokes onNode callback for each node', async () => {
    const graph = await createTestGraph()

    const core: CoreDefinition = {
      nodes: {
        admin: coreNode('user', { email: 'admin@test.com', name: 'Admin' }),
        blog: coreNode('post', { title: 'Post', content: 'Content' }),
      },
    }

    const callbacks: Array<{ ref: string; type: string; id: string }> = []
    await installCore(graph, core, {
      onNode: (ref, type, id) => callbacks.push({ ref, type, id }),
    })

    expect(callbacks).toHaveLength(2)
    expect(callbacks[0].ref).toBe('admin')
    expect(callbacks[0].type).toBe('user')
    expect(callbacks[1].ref).toBe('blog')
    expect(callbacks[1].type).toBe('post')
  })
})

// =============================================================================
// 3. Graph.core — Typed Integration
// =============================================================================

describe('Graph.core typed integration', () => {
  it('exposes typed core refs via graph.core<C>', async () => {
    const adapter = new MockAdapter()
    await adapter.connect()

    const coreRefs: CoreRefs = {
      admin: NodeId('node-id-admin'),
      product: NodeId('node-id-product'),
    }

    const graph = await createGraph<TestSchema, UntypedMap, FlatCoreRefs>(
      testSchema,
      { adapter, coreRefs },
    )

    // Type check: graph.core is FlatCoreRefs | undefined
    expectTypeOf(graph.core).toEqualTypeOf<FlatCoreRefs | undefined>()

    // Runtime check
    expect(graph.core).toBeDefined()
    const core = graph.core!

    // Type check: core.admin is NodeId
    expectTypeOf(core.admin).toEqualTypeOf<NodeId>()
    expectTypeOf(core.product).toEqualTypeOf<NodeId>()

    // Runtime check
    expect(core.admin).toBe('node-id-admin')
    expect(core.product).toBe('node-id-product')
  })

  it('exposes nested typed core refs', async () => {
    const adapter = new MockAdapter()
    await adapter.connect()

    const coreRefs: CoreRefs = {
      admin: NodeId('node-id-admin'),
      electronics: {
        phones: NodeId('node-id-phones'),
        laptops: NodeId('node-id-laptops'),
      },
      clothing: NodeId('node-id-clothing'),
    }

    const graph = await createGraph<TestSchema, UntypedMap, NestedCoreRefs>(
      testSchema,
      { adapter, coreRefs },
    )

    // Type check: graph.core is NestedCoreRefs | undefined
    expectTypeOf(graph.core).toEqualTypeOf<NestedCoreRefs | undefined>()

    const core = graph.core!

    // Type check: leaf refs are NodeId
    expectTypeOf(core.admin).toEqualTypeOf<NodeId>()
    expectTypeOf(core.clothing).toEqualTypeOf<NodeId>()

    // Type check: nested refs have proper structure
    expectTypeOf(core.electronics).toEqualTypeOf<{ phones: NodeId; laptops: NodeId }>()
    expectTypeOf(core.electronics.phones).toEqualTypeOf<NodeId>()
    expectTypeOf(core.electronics.laptops).toEqualTypeOf<NodeId>()

    // Runtime check
    expect(core.admin).toBe('node-id-admin')
    expect(core.electronics.phones).toBe('node-id-phones')
    expect(core.electronics.laptops).toBe('node-id-laptops')
    expect(core.clothing).toBe('node-id-clothing')
  })

  it('graph.core is undefined when no coreRefs provided', async () => {
    const adapter = new MockAdapter()
    await adapter.connect()

    const graph = await createGraph(testSchema, { adapter })

    expect(graph.core).toBeUndefined()
  })

  it('full flow: installCore → typed graph.core.* access', async () => {
    const adapter = new MockAdapter()
    await adapter.connect()
    const graph = await createGraph(testSchema, { adapter })

    const coreDef: CoreDefinition = {
      nodes: {
        admin: coreNode('user', { email: 'admin@test.com', name: 'Admin' }),
        electronics: coreNode(
          'category',
          { name: 'Electronics', slug: 'electronics' },
          {
            phones: coreNode('category', { name: 'Phones', slug: 'phones' }),
            laptops: coreNode('category', { name: 'Laptops', slug: 'laptops' }),
          },
        ),
        clothing: coreNode('category', { name: 'Clothing', slug: 'clothing' }),
      },
    }

    const result = await installCore(graph, coreDef)

    // Wire core refs and cast graph to typed version
    graph.extendSchema({ coreRefs: result.core } as any)
    const typed = graph as Graph<TestSchema, UntypedMap, NestedCoreRefs>

    // Type check: typed.core is NestedCoreRefs | undefined
    expectTypeOf(typed.core).toEqualTypeOf<NestedCoreRefs | undefined>()

    const refs = typed.core!

    // Type check: all refs properly typed
    expectTypeOf(refs.admin).toEqualTypeOf<NodeId>()
    expectTypeOf(refs.electronics.phones).toEqualTypeOf<NodeId>()
    expectTypeOf(refs.electronics.laptops).toEqualTypeOf<NodeId>()
    expectTypeOf(refs.clothing).toEqualTypeOf<NodeId>()

    // Runtime: IDs match core refs tree
    expect(refs.admin).toBe(result.core.admin)
    expect(refs.clothing).toBe(result.core.clothing)
    const electronics = result.core.electronics as CoreRefs
    expect(refs.electronics.phones).toBe(electronics.phones)
    expect(refs.electronics.laptops).toBe(electronics.laptops)
  })

  it('graph.core refs are valid node IDs usable in mutations', async () => {
    const adapter = new MockAdapter()
    await adapter.connect()

    const coreRefs: CoreRefs = {
      alice: NodeId('user_alice-id'),
      tech: NodeId('category_tech-id'),
    }

    type TestRefs = { alice: NodeId; tech: NodeId }
    const graph = await createGraph<TestSchema, UntypedMap, TestRefs>(
      testSchema,
      { adapter, coreRefs },
    )

    const core = graph.core!

    // Type check: these are NodeId, not any
    expectTypeOf(core.alice).toEqualTypeOf<NodeId>()
    expectTypeOf(core.tech).toEqualTypeOf<NodeId>()

    // Runtime: values are the branded NodeIds we passed in
    expect(core.alice).toBe('user_alice-id')
    expect(core.tech).toBe('category_tech-id')
  })
})
