/**
 * Query Compilation Specification - Union/Intersect Patterns
 *
 * Tests the union(), unionAll(), and intersect() methods.
 * Focus: Cypher compilation verification (no database required)
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineSchema, node, edge } from '../../src/schema/builders'
import { createGraph } from '../../src/query/entry'

const unionTestSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        status: z.enum(['active', 'inactive']),
        role: z.enum(['admin', 'user']),
        score: z.number().default(0),
        verified: z.boolean().default(false),
      },
    }),
    post: node({
      properties: {
        status: z.enum(['draft', 'published']),
        featured: z.boolean().default(false),
      },
    }),
  },
  edges: {
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
    likes: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
  },
})

const graph = createGraph(unionTestSchema, { uri: '' })

// =============================================================================
// UNION
// =============================================================================

describe('Union', () => {
  it('unions two queries with UNION (distinct by default)', () => {
    const cypher = graph
      .union(
        graph.node('user').where('status', 'eq', 'active'),
        graph.node('user').where('role', 'eq', 'admin'),
      )
      .toCypher()

    expect(cypher).toContain('UNION')
    expect(cypher).not.toContain('UNION ALL')
    expect(cypher).toContain('RETURN n0')
  })

  it('unions three queries - two UNION keywords', () => {
    const cypher = graph
      .union(
        graph.node('user').where('status', 'eq', 'active'),
        graph.node('user').where('role', 'eq', 'admin'),
        graph.node('user').where('verified', 'eq', true),
      )
      .toCypher()

    const unionCount = (cypher.match(/\bUNION\b/g) || []).length
    expect(unionCount).toBe(2)
  })

  it('each branch has its own RETURN clause', () => {
    const cypher = graph
      .union(
        graph.node('user').where('status', 'eq', 'active'),
        graph.node('user').where('role', 'eq', 'admin'),
      )
      .toCypher()

    const returnCount = (cypher.match(/\bRETURN\b/g) || []).length
    expect(returnCount).toBe(2)

    // First RETURN before UNION, second after
    const unionIdx = cypher.indexOf('UNION')
    const firstReturn = cypher.indexOf('RETURN')
    const lastReturn = cypher.lastIndexOf('RETURN')

    expect(firstReturn).toBeLessThan(unionIdx)
    expect(lastReturn).toBeGreaterThan(unionIdx)
  })

  it('parameters are unique across branches', () => {
    const compiled = graph
      .union(
        graph.node('user').where('status', 'eq', 'active'),
        graph.node('user').where('status', 'eq', 'inactive'),
      )
      .compile()

    // Both branches have where clauses - should have different param names
    expect(Object.keys(compiled.params).length).toBeGreaterThanOrEqual(2)
    expect(compiled.params.p0).toBe('active')
    expect(compiled.params.p1).toBe('inactive')
  })
})

// =============================================================================
// UNION ALL
// =============================================================================

describe('UnionAll', () => {
  it('uses UNION ALL to preserve duplicates', () => {
    const cypher = graph
      .unionAll(
        graph.node('user').where('status', 'eq', 'active'),
        graph.node('user').where('role', 'eq', 'admin'),
      )
      .toCypher()

    expect(cypher).toContain('UNION ALL')
  })
})

// =============================================================================
// UNION WITH TRAVERSALS
// =============================================================================

describe('Union with Traversals', () => {
  it('unions queries with different traversal depths', () => {
    const cypher = graph
      .union(
        graph.node('user').where('role', 'eq', 'admin'), // depth 0
        graph.node('user').byId('u1').to('authored'), // depth 1
      )
      .toCypher()

    expect(cypher).toContain('UNION')
    expect(cypher).toContain(':authored')

    // Both branches have RETURN
    const returnCount = (cypher.match(/\bRETURN\b/g) || []).length
    expect(returnCount).toBe(2)
  })

  it('unions queries with different edges', () => {
    const cypher = graph
      .union(
        graph.node('user').byId('user1').to('authored'),
        graph.node('user').byId('user2').to('likes'),
      )
      .toCypher()

    expect(cypher).toContain(':authored')
    expect(cypher).toContain(':likes')
  })
})

// =============================================================================
// INTERSECT - CRITICAL: Must have RETURN clause
// =============================================================================

describe('Intersect', () => {
  it('intersects two queries with WITH chaining', () => {
    const cypher = graph
      .intersect(
        graph.node('user').where('status', 'eq', 'active'),
        graph.node('user').where('role', 'eq', 'admin'),
      )
      .toCypher()

    expect(cypher).toContain('WITH n0')
  })

  it('MUST have a RETURN clause', () => {
    const cypher = graph
      .intersect(
        graph.node('user').where('status', 'eq', 'active'),
        graph.node('user').where('role', 'eq', 'admin'),
      )
      .toCypher()

    // CRITICAL: Without RETURN, query is invalid
    expect(cypher).toContain('RETURN n0')
  })

  it('intersects three queries - two WITH clauses', () => {
    const cypher = graph
      .intersect(
        graph.node('user').where('status', 'eq', 'active'),
        graph.node('user').where('role', 'eq', 'admin'),
        graph.node('user').where('score', 'gt', 100),
      )
      .toCypher()

    const withCount = (cypher.match(/\bWITH\b/g) || []).length
    expect(withCount).toBe(2)
    expect(cypher).toContain('RETURN n0')
  })
})

// =============================================================================
// ERROR HANDLING
// =============================================================================

describe('Error Handling', () => {
  it('union requires at least 2 queries', () => {
    expect(() => graph.union(graph.node('user'))).toThrow('union() requires at least 2 queries')
  })

  it('unionAll requires at least 2 queries', () => {
    expect(() => graph.unionAll(graph.node('user'))).toThrow(
      'unionAll() requires at least 2 queries',
    )
  })

  it('intersect requires at least 2 queries', () => {
    expect(() => graph.intersect(graph.node('user'))).toThrow(
      'intersect() requires at least 2 queries',
    )
  })
})
