/**
 * E2E: Basic Query Building → Cypher Compilation
 *
 * Tests the core query builder API against the e-commerce schema,
 * verifying that SDK calls produce the expected Cypher output.
 */

import { describe, it, expect } from 'vitest'
import { q, cypher } from './helpers'

// =============================================================================
// MATCH ALL NODES
// =============================================================================

describe('match all nodes', () => {
  it('matches Customer with inherited Timestamped label', () => {
    const result = q.node('Customer').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      RETURN n0
    `)
    expect(result.params).toEqual({})
  })

  it('matches Product with inherited Timestamped label', () => {
    const result = q.node('Product').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      RETURN n0
    `)
    expect(result.params).toEqual({})
  })

  it('matches Order with inherited Timestamped label', () => {
    const result = q.node('Order').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Order:Timestamped)
      RETURN n0
    `)
    expect(result.params).toEqual({})
  })

  it('matches Review with inherited Timestamped label', () => {
    const result = q.node('Review').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Review:Timestamped)
      RETURN n0
    `)
    expect(result.params).toEqual({})
  })

  it('matches Category with single label (no inheritance)', () => {
    const result = q.node('Category').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Category)
      RETURN n0
    `)
    expect(result.params).toEqual({})
  })

  it('matches Warehouse with single label (no inheritance)', () => {
    const result = q.node('Warehouse').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Warehouse)
      RETURN n0
    `)
    expect(result.params).toEqual({})
  })
})

// =============================================================================
// MATCH BY ID
// =============================================================================

describe('match by id', () => {
  it('adds WHERE clause for Customer byId', () => {
    const result = q.node('Customer').byId('c1').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      WHERE n0.id = $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: 'c1' })
  })

  it('adds WHERE clause for Product byId', () => {
    const result = q.node('Product').byId('prod-42').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      WHERE n0.id = $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: 'prod-42' })
  })

  it('adds WHERE clause for Category byId', () => {
    const result = q.node('Category').byId('cat-electronics').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Category)
      WHERE n0.id = $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: 'cat-electronics' })
  })

  it('adds WHERE clause for Warehouse byId', () => {
    const result = q.node('Warehouse').byId('wh-west').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Warehouse)
      WHERE n0.id = $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: 'wh-west' })
  })
})

// =============================================================================
// WHERE CLAUSES
// =============================================================================

describe('where clauses', () => {
  it('compiles eq operator', () => {
    const result = q.node('Product').where('active', 'eq', true).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      WHERE n0.active = $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: true })
  })

  it('compiles gt operator', () => {
    const result = q.node('Product').where('price', 'gt', 100).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      WHERE n0.price > $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: 100 })
  })

  it('compiles gte operator', () => {
    const result = q.node('Order').where('total', 'gte', 50).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Order:Timestamped)
      WHERE n0.total >= $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: 50 })
  })

  it('compiles lt operator', () => {
    const result = q.node('Product').where('price', 'lt', 10).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      WHERE n0.price < $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: 10 })
  })

  it('compiles contains operator', () => {
    const result = q.node('Customer').where('email', 'contains', '@example.com').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      WHERE n0.email CONTAINS $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: '@example.com' })
  })

  it('compiles startsWith operator', () => {
    const result = q.node('Customer').where('username', 'startsWith', 'admin').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      WHERE n0.username STARTS WITH $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: 'admin' })
  })

  it('compiles chained where clauses with AND', () => {
    const result = q
      .node('Product')
      .where('active', 'eq', true)
      .where('price', 'gt', 50)
      .compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      WHERE n0.active = $p0 AND n0.price > $p1
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: true, p1: 50 })
  })

  it('compiles multiple chained where clauses', () => {
    const result = q
      .node('Product')
      .where('active', 'eq', true)
      .where('price', 'gte', 10)
      .where('price', 'lte', 100)
      .compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      WHERE n0.active = $p0 AND n0.price >= $p1 AND n0.price <= $p2
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: true, p1: 10, p2: 100 })
  })

  it('compiles neq operator', () => {
    const result = q.node('Order').where('status', 'neq', 'cancelled').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Order:Timestamped)
      WHERE n0.status <> $p0
      RETURN n0
    `)
    expect(result.params).toEqual({ p0: 'cancelled' })
  })

  it('compiles isNull operator', () => {
    const result = q.node('Review').where('body', 'isNull').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Review:Timestamped)
      WHERE n0.body IS NULL
      RETURN n0
    `)
    expect(result.params).toEqual({})
  })

  it('compiles isNotNull operator', () => {
    const result = q.node('Review').where('body', 'isNotNull').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Review:Timestamped)
      WHERE n0.body IS NOT NULL
      RETURN n0
    `)
    expect(result.params).toEqual({})
  })
})

// =============================================================================
// PAGINATION
// =============================================================================

describe('pagination', () => {
  it('compiles limit', () => {
    const result = q.node('Customer').limit(10).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      RETURN n0
      LIMIT 10
    `)
    expect(result.params).toEqual({})
  })

  it('compiles skip', () => {
    const result = q.node('Customer').skip(20).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      RETURN n0
      SKIP 20
    `)
    expect(result.params).toEqual({})
  })

  it('compiles limit and skip together', () => {
    const result = q.node('Product').limit(25).skip(50).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      RETURN n0
      SKIP 50
      LIMIT 25
    `)
    expect(result.params).toEqual({})
  })

  it('compiles skip and limit in reverse call order', () => {
    const result = q.node('Product').skip(10).limit(5).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      RETURN n0
      SKIP 10
      LIMIT 5
    `)
    expect(result.params).toEqual({})
  })

  it('combines where with pagination', () => {
    const result = q.node('Product').where('active', 'eq', true).limit(10).skip(0).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      WHERE n0.active = $p0
      RETURN n0
      SKIP 0
      LIMIT 10
    `)
    expect(result.params).toEqual({ p0: true })
  })
})

// =============================================================================
// ORDERING
// =============================================================================

describe('ordering', () => {
  it('compiles orderBy ascending (default)', () => {
    const result = q.node('Product').orderBy('name').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      RETURN n0
      ORDER BY n0.name ASC
    `)
    expect(result.params).toEqual({})
  })

  it('compiles orderBy ascending (explicit)', () => {
    const result = q.node('Product').orderBy('price', 'ASC').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      RETURN n0
      ORDER BY n0.price ASC
    `)
    expect(result.params).toEqual({})
  })

  it('compiles orderBy descending', () => {
    const result = q.node('Product').orderBy('price', 'DESC').compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      RETURN n0
      ORDER BY n0.price DESC
    `)
    expect(result.params).toEqual({})
  })

  it('combines orderBy with where', () => {
    const result = q
      .node('Product')
      .where('active', 'eq', true)
      .orderBy('price', 'DESC')
      .compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      WHERE n0.active = $p0
      RETURN n0
      ORDER BY n0.price DESC
    `)
    expect(result.params).toEqual({ p0: true })
  })

  it('combines orderBy with pagination', () => {
    const result = q.node('Customer').orderBy('username', 'ASC').limit(10).skip(20).compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      RETURN n0
      ORDER BY n0.username ASC
      SKIP 20
      LIMIT 10
    `)
    expect(result.params).toEqual({})
  })

  it('combines where, orderBy, and pagination', () => {
    const result = q
      .node('Order')
      .where('status', 'eq', 'pending')
      .orderBy('total', 'DESC')
      .limit(5)
      .compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Order:Timestamped)
      WHERE n0.status = $p0
      RETURN n0
      ORDER BY n0.total DESC
      LIMIT 5
    `)
    expect(result.params).toEqual({ p0: 'pending' })
  })
})

// =============================================================================
// DISTINCT
// =============================================================================

describe('distinct', () => {
  it('compiles distinct return', () => {
    const result = q.node('Customer').distinct().compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Customer:Timestamped)
      RETURN DISTINCT n0
    `)
    expect(result.params).toEqual({})
  })

  it('combines distinct with where', () => {
    const result = q.node('Product').where('active', 'eq', true).distinct().compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      WHERE n0.active = $p0
      RETURN DISTINCT n0
    `)
    expect(result.params).toEqual({ p0: true })
  })

  it('combines distinct with orderBy and pagination', () => {
    const result = q
      .node('Product')
      .distinct()
      .orderBy('name', 'ASC')
      .limit(10)
      .compile()

    expect(result.cypher).toBe(cypher`
      MATCH (n0:Product:Timestamped)
      RETURN DISTINCT n0
      ORDER BY n0.name ASC
      LIMIT 10
    `)
    expect(result.params).toEqual({})
  })
})
