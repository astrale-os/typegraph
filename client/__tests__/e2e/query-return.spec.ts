/**
 * E2E: .return() API & .as() Aliasing → Cypher Compilation
 *
 * Tests the query builder's aliasing (.as), custom return projections (.return),
 * and collect aggregation against the e-commerce schema, verifying that SDK
 * calls produce the expected Cypher output.
 */

import { describe, it, expect } from 'vitest'

import { createQueryBuilder, collect, collectDistinct } from '../../src'
import { cypher } from './helpers'
import { schema } from './schema'

const q = createQueryBuilder(schema)

// =============================================================================
// ALIASING WITH .as()
// =============================================================================

describe('aliasing with .as()', () => {
  it('compiles to standard RETURN when .as() is used without .return()', () => {
    // .as() registers the alias internally, but without .return() the
    // compiler still uses the auto-generated variable name.
    const result = q.node('Customer').as('c').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      RETURN n0
    `)
    expect(result.params).toEqual({})
  })

  it('compiles node with no inheritance and .as() without .return()', () => {
    const result = q.node('Category').as('cat').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Category)
      RETURN n0
    `)
    expect(result.params).toEqual({})
  })

  it('preserves alias through where clause (still standard RETURN)', () => {
    const result = q.node('Product').as('p').where('active', 'eq', true).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      WHERE n0.active = $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: true })
  })

  it('compiles traversal with .as() on both source and target', () => {
    const result = q.node('Customer').as('c').to('placed_order').as('o').compile()

    // Without .return(), the compiler returns the last node in the chain.
    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)
      RETURN n1
    `)
    expect(result.params).toEqual({})
  })

  it('uses lowercase edge type in traversal', () => {
    const result = q.node('Customer').as('c').to('placed_order').as('o').compile()

    // Edge type is lowercase snake_case, not UPPERCASE
    expect(result.cypher).toContain('placed_order')
  })
})

// =============================================================================
// CUSTOM RETURN PROJECTIONS
// =============================================================================

describe('custom return projections', () => {
  it('returns multiple aliased nodes via .return()', () => {
    const result = q
      .node('Customer')
      .as('c')
      .to('placed_order')
      .as('o')
      .return((q) => ({
        customer: q.c,
        order: q.o,
      }))
      .compile()

    // .return() produces RETURN with internal aliases mapped to user aliases
    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)
      RETURN n0 AS c, n1 AS o
    `)
    expect(result.params).toEqual({})
  })

  it('returns a single alias via .return()', () => {
    const result = q
      .node('Customer')
      .as('c')
      .to('placed_order')
      .as('o')
      .return((q) => ({
        order: q.o,
      }))
      .compile()

    expect(result.cypher).toContain('RETURN')
    expect(result.cypher).toContain('AS o')
  })

  it('handles three-hop traversal with aliases and .return()', () => {
    const result = q
      .node('Customer')
      .as('c')
      .to('placed_order')
      .as('o')
      .to('order_item')
      .as('p')
      .return((q) => ({
        customer: q.c,
        order: q.o,
        product: q.p,
      }))
      .compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)
      MATCH (n1)-[e4:order_item]->(n3:Product:Timestamped)
      RETURN n0 AS c, n1 AS o, n3 AS p
    `)
    expect(result.params).toEqual({})
  })

  it('returns only a subset of the aliased nodes', () => {
    const result = q
      .node('Customer')
      .as('c')
      .to('placed_order')
      .as('o')
      .to('order_item')
      .as('p')
      .return((q) => ({
        product: q.p,
      }))
      .compile()

    expect(result.cypher).toContain('RETURN')
    expect(result.cypher).toContain('AS p')
    // Should still have all three MATCH clauses
    expect(result.cypher).toContain('Customer')
    expect(result.cypher).toContain('placed_order')
    expect(result.cypher).toContain('order_item')
  })
})

// =============================================================================
// COLLECT AGGREGATION
// =============================================================================

describe('collect aggregation', () => {
  it('produces collect() in RETURN clause', () => {
    const result = q
      .node('Customer')
      .as('c')
      .to('placed_order')
      .as('o')
      .return((q) => ({
        customer: q.c,
        orders: collect(q.o),
      }))
      .compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)
      RETURN n0 AS c, collect(n1) AS orders
    `)
    expect(result.params).toEqual({})
  })

  it('produces collect(DISTINCT ...) via collectDistinct()', () => {
    const result = q
      .node('Customer')
      .as('c')
      .to('placed_order')
      .as('o')
      .return((q) => ({
        customer: q.c,
        orders: collectDistinct(q.o),
      }))
      .compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)
      RETURN n0 AS c, collect(DISTINCT n1) AS orders
    `)
    expect(result.params).toEqual({})
  })

  it('collect with three-hop traversal', () => {
    const result = q
      .node('Customer')
      .as('c')
      .to('placed_order')
      .as('o')
      .to('order_item')
      .as('p')
      .return((q) => ({
        customer: q.c,
        products: collect(q.p),
      }))
      .compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      MATCH (n0)-[e2:placed_order]->(n1:Order:Timestamped)
      MATCH (n1)-[e4:order_item]->(n3:Product:Timestamped)
      RETURN n0 AS c, collect(n3) AS products
    `)
    expect(result.params).toEqual({})
  })

  it('collect uses callback key as the AS alias', () => {
    const result = q
      .node('Customer')
      .as('c')
      .to('placed_order')
      .as('o')
      .return((q) => ({
        person: q.c,
        allOrders: collect(q.o),
      }))
      .compile()

    // The .return() callback key 'allOrders' becomes the AS alias for collect
    expect(result.cypher).toContain('collect(')
    expect(result.cypher).toContain('AS allOrders')
    // The node reference 'person' key does not appear — it uses the .as() alias instead
    expect(result.cypher).toContain('AS c')
  })
})
