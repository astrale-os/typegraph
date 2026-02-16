/**
 * E2E: Edge Traversal → Cypher Compilation
 *
 * Tests the traversal API (.to, .from, .via) against the e-commerce schema,
 * verifying that forward, reverse, and bidirectional edge traversals
 * produce the expected Cypher MATCH patterns.
 */

import { describe, it, expect } from 'vitest'
import { q, cypher } from './helpers'

// =============================================================================
// FORWARD TRAVERSAL (.to)
// =============================================================================

describe('forward traversal', () => {
  it('Customer → placed_order → Order', () => {
    const result = q.node('Customer').to('placed_order').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })

  it('Order → order_item → Product', () => {
    const result = q.node('Order').to('order_item').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Order:Timestamped)
      MATCH (n0)-[e2:order_item]->(n1:Product:Timestamped)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })

  it('Product → categorized_as → Category', () => {
    const result = q.node('Product').to('categorized_as').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      MATCH (n0)-[e2:categorized_as]->(n1:Category)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })

  it('Product → stocked_in → Warehouse', () => {
    const result = q.node('Product').to('stocked_in').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      MATCH (n0)-[e2:stocked_in]->(n1:Warehouse)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })

  it('Review → wrote_review → Customer', () => {
    const result = q.node('Review').to('wrote_review').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Review:Timestamped)
      MATCH (n0)-[e2:wrote_review]->(n1:Customer:Timestamped)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })
})

// =============================================================================
// REVERSE TRAVERSAL (.from)
// =============================================================================

describe('reverse traversal', () => {
  it('Order ← placed_order ← Customer', () => {
    const result = q.node('Order').from('placed_order').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Order:Timestamped)
      MATCH (n0)<-[e2:placed_order]-(n1:Customer:Timestamped)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })

  it('Product ← order_item ← Order', () => {
    const result = q.node('Product').from('order_item').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      MATCH (n0)<-[e2:order_item]-(n1:Order:Timestamped)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })

  it('Customer ← wrote_review ← Review', () => {
    const result = q.node('Customer').from('wrote_review').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      MATCH (n0)<-[e2:wrote_review]-(n1:Review:Timestamped)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })

  it('Category ← categorized_as ← Product', () => {
    const result = q.node('Category').from('categorized_as').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Category)
      MATCH (n0)<-[e2:categorized_as]-(n1:Product:Timestamped)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })
})

// =============================================================================
// BIDIRECTIONAL TRAVERSAL (.via)
// =============================================================================

describe('bidirectional traversal', () => {
  it('Customer ↔ follows ↔ Customer', () => {
    const result = q.node('Customer').via('follows').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      MATCH (n0)-[e2:follows]-(n1:Customer:Timestamped)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })

  it('Category ↔ category_parent ↔ Category', () => {
    const result = q.node('Category').via('category_parent').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Category)
      MATCH (n0)-[e2:category_parent]-(n1:Category)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })
})

// =============================================================================
// MULTI-HOP CHAINS
// =============================================================================

describe('multi-hop chains', () => {
  it('Customer → placed_order → Order → order_item → Product (2 hops)', () => {
    const result = q.node('Customer').to('placed_order').to('order_item').compile()

    expect(result.cypher).toContain('MATCH (n0:Customer:Timestamped)')
    expect(result.cypher).toContain('MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)')
    expect(result.cypher).toContain('MATCH (n1)-[e4:order_item]->(n3:Product:Timestamped)')
    expect(result.cypher).toContain('RETURN n3')
    expect(result.params).toEqual({})
  })

  it('Customer → placed_order → Order → order_item → Product → categorized_as → Category (3 hops)', () => {
    const result = q
      .node('Customer')
      .to('placed_order')
      .to('order_item')
      .to('categorized_as')
      .compile()

    expect(result.cypher).toContain('MATCH (n0:Customer:Timestamped)')
    expect(result.cypher).toContain('MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)')
    expect(result.cypher).toContain('MATCH (n1)-[e4:order_item]->(n3:Product:Timestamped)')
    expect(result.cypher).toContain('MATCH (n3)-[e6:categorized_as]->(n5:Category)')
    expect(result.cypher).toContain('RETURN n5')
    expect(result.params).toEqual({})
  })

  it('mixed forward and reverse: Product ← order_item ← Order ← placed_order ← Customer', () => {
    const result = q.node('Product').from('order_item').from('placed_order').compile()

    expect(result.cypher).toContain('MATCH (n0:Product:Timestamped)')
    expect(result.cypher).toContain('MATCH (n0)<-[e2:order_item]-(n1:Order:Timestamped)')
    expect(result.cypher).toContain('MATCH (n1)<-[e4:placed_order]-(n3:Customer:Timestamped)')
    expect(result.cypher).toContain('RETURN n3')
    expect(result.params).toEqual({})
  })

  it('Review → wrote_review → Customer → placed_order → Order (forward chain)', () => {
    const result = q.node('Review').to('wrote_review').to('placed_order').compile()

    expect(result.cypher).toContain('MATCH (n0:Review:Timestamped)')
    expect(result.cypher).toContain('MATCH (n0)-[e2:wrote_review]->(n1:Customer:Timestamped)')
    expect(result.cypher).toContain('MATCH (n1)-[e4:placed_order]->(n3:Order:Timestamped)')
    expect(result.cypher).toContain('RETURN n3')
    expect(result.params).toEqual({})
  })
})

// =============================================================================
// TRAVERSAL WITH WHERE
// =============================================================================

describe('traversal with where', () => {
  it('traverse then filter target node', () => {
    const result = q.node('Customer').to('placed_order').where('status', 'eq', 'shipped').compile()

    expect(result.cypher).toContain('MATCH (n0:Customer:Timestamped)')
    expect(result.cypher).toContain('MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)')
    expect(result.cypher).toContain('WHERE n1.status = $p0')
    expect(result.cypher).toContain('RETURN n1')
    expect(result.params).toEqual({ p0: 'shipped' })
  })

  it('filter source node then traverse', () => {
    const result = q.node('Product').where('active', 'eq', true).to('stocked_in').compile()

    expect(result.cypher).toContain('MATCH (n0:Product:Timestamped)')
    expect(result.cypher).toContain('WHERE n0.active = $p0')
    expect(result.cypher).toContain('MATCH (n0)-[e2:stocked_in]->(n1:Warehouse)')
    expect(result.cypher).toContain('RETURN n1')
    expect(result.params).toEqual({ p0: true })
  })

  it('filter source, traverse, and filter target', () => {
    const result = q
      .node('Customer')
      .where('tier', 'eq', 'premium')
      .to('placed_order')
      .where('status', 'eq', 'delivered')
      .compile()

    expect(result.cypher).toContain('MATCH (n0:Customer:Timestamped)')
    expect(result.cypher).toContain('WHERE n0.tier = $p0')
    expect(result.cypher).toContain('MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)')
    expect(result.cypher).toContain('WHERE n1.status = $p1')
    expect(result.cypher).toContain('RETURN n1')
    expect(result.params).toEqual({ p0: 'premium', p1: 'delivered' })
  })
})
