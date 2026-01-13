/**
 * Query Compilation Specification - GroupBy Aggregations
 *
 * Tests the groupBy() method for grouped aggregation queries.
 * Focus: Cypher compilation verification (no database required)
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineSchema, node, edge } from '../../src/schema/builders'
import { createGraph } from '../../src/query/entry'

const groupByTestSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        status: z.enum(['active', 'inactive']),
        role: z.enum(['admin', 'user']),
        score: z.number().default(0),
      },
    }),
    post: node({
      properties: {
        status: z.enum(['draft', 'published']),
        viewCount: z.number().default(0),
        likeCount: z.number().default(0),
        category: z.string(),
      },
    }),
    order: node({
      properties: {
        total: z.number(),
        region: z.string(),
      },
    }),
  },
  edges: {
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
  },
})

const graph = createGraph(groupByTestSchema, { uri: '' })

// =============================================================================
// CORE FUNCTIONALITY
// =============================================================================

describe('GroupBy Core', () => {
  it('groups by single field with count', () => {
    const cypher = graph.node('post').groupBy('status').count().toCypher()

    expect(cypher).toContain('MATCH (n0:post)')
    expect(cypher).toContain('RETURN n0.status, count(n0) AS count')
  })

  it('groups by multiple fields', () => {
    const cypher = graph.node('post').groupBy('status', 'category').count().toCypher()

    expect(cypher).toContain('n0.status')
    expect(cypher).toContain('n0.category')
  })

  it('count with distinct option', () => {
    const cypher = graph.node('post').groupBy('category').count({ distinct: true }).toCypher()
    expect(cypher).toContain('count(DISTINCT n0)')
  })

  it('groupBy without aggregation still produces valid query', () => {
    const cypher = graph.node('post').groupBy('status').toCypher()
    expect(cypher).toContain('RETURN n0.status')
  })
})

// =============================================================================
// ALL AGGREGATION FUNCTIONS
// =============================================================================

describe('Aggregation Functions', () => {
  it('sum with default and custom alias', () => {
    expect(graph.node('post').groupBy('status').sum('viewCount').toCypher()).toContain(
      'sum(n0.viewCount) AS sum_viewCount',
    )

    expect(
      graph.node('post').groupBy('status').sum('viewCount', { alias: 'total' }).toCypher(),
    ).toContain('sum(n0.viewCount) AS total')
  })

  it('avg, min, max', () => {
    const cypher = graph
      .node('order')
      .groupBy('region')
      .avg('total', { alias: 'avgVal' })
      .min('total', { alias: 'minVal' })
      .max('total', { alias: 'maxVal' })
      .toCypher()

    expect(cypher).toContain('avg(n0.total) AS avgVal')
    expect(cypher).toContain('min(n0.total) AS minVal')
    expect(cypher).toContain('max(n0.total) AS maxVal')
  })

  it('collect and collect distinct', () => {
    expect(graph.node('post').groupBy('category').collect('status').toCypher()).toContain(
      'collect(n0.status) AS statuss',
    )

    expect(
      graph.node('post').groupBy('category').collect('status', { distinct: true }).toCypher(),
    ).toContain('collect(DISTINCT n0.status)')
  })
})

// =============================================================================
// ORDERING - CRITICAL: Aggregation aliases must NOT be prefixed
// =============================================================================

describe('OrderBy', () => {
  it('orderBy group field uses node prefix', () => {
    const cypher = graph.node('post').groupBy('status').count().orderBy('status', 'ASC').toCypher()
    expect(cypher).toContain('ORDER BY n0.status ASC')
  })

  it('orderBy aggregation alias does NOT use node prefix', () => {
    const cypher = graph
      .node('post')
      .groupBy('category')
      .count({ alias: 'cnt' })
      .orderBy('cnt', 'DESC')
      .toCypher()

    // CRITICAL: Should be "ORDER BY cnt DESC", NOT "ORDER BY n0.cnt DESC"
    expect(cypher).toContain('ORDER BY cnt DESC')
    expect(cypher).not.toContain('ORDER BY n0.cnt')
  })

  it('mixed orderBy handles both correctly', () => {
    const cypher = graph
      .node('post')
      .groupBy('status')
      .count({ alias: 'cnt' })
      .orderBy('status', 'ASC')
      .orderBy('cnt', 'DESC')
      .toCypher()

    expect(cypher).toContain('n0.status ASC')
    expect(cypher).toContain('cnt DESC')
    expect(cypher).not.toContain('n0.cnt')
  })
})

// =============================================================================
// PAGINATION
// =============================================================================

describe('Pagination', () => {
  it('limit and skip', () => {
    const cypher = graph.node('post').groupBy('category').count().skip(10).limit(5).toCypher()

    expect(cypher).toContain('SKIP 10')
    expect(cypher).toContain('LIMIT 5')
  })
})

// =============================================================================
// FILTERING BEFORE AGGREGATION
// =============================================================================

describe('Filtering Before GroupBy', () => {
  it('where before groupBy filters input rows', () => {
    const cypher = graph
      .node('post')
      .where('status', 'eq', 'published')
      .groupBy('category')
      .count()
      .toCypher()

    expect(cypher).toContain('WHERE')
    expect(cypher).toContain('RETURN n0.category')
  })
})

// =============================================================================
// TRAVERSAL + AGGREGATION
// =============================================================================

describe('GroupBy After Traversal', () => {
  it('uses correct alias (n1) after traversal', () => {
    const cypher = graph
      .node('user')
      .byId('user_123')
      .to('authored')
      .groupBy('status')
      .count({ alias: 'cnt' })
      .toCypher()

    // After traversal to post, the alias is n1
    expect(cypher).toContain('n1.status')
    expect(cypher).toContain('count(n1) AS cnt')
  })
})

// =============================================================================
// CYPHER STRUCTURE
// =============================================================================

describe('Cypher Structure', () => {
  it('clause order: MATCH -> WHERE -> RETURN -> ORDER BY -> SKIP -> LIMIT', () => {
    const cypher = graph
      .node('post')
      .where('status', 'eq', 'published')
      .groupBy('category')
      .count({ alias: 'cnt' })
      .orderBy('cnt', 'DESC')
      .skip(5)
      .limit(10)
      .toCypher()

    const matchIdx = cypher.indexOf('MATCH')
    const whereIdx = cypher.indexOf('WHERE')
    const returnIdx = cypher.indexOf('RETURN')
    const orderIdx = cypher.indexOf('ORDER BY')
    const skipIdx = cypher.indexOf('SKIP')
    const limitIdx = cypher.indexOf('LIMIT')

    expect(matchIdx).toBeLessThan(whereIdx)
    expect(whereIdx).toBeLessThan(returnIdx)
    expect(returnIdx).toBeLessThan(orderIdx)
    expect(orderIdx).toBeLessThan(skipIdx)
    expect(skipIdx).toBeLessThan(limitIdx)
  })

  it('group fields come before aggregations in RETURN', () => {
    const cypher = graph
      .node('post')
      .groupBy('status', 'category')
      .count({ alias: 'cnt' })
      .sum('viewCount', { alias: 'views' })
      .toCypher()

    const returnClause = cypher.substring(cypher.indexOf('RETURN'))
    const statusIdx = returnClause.indexOf('n0.status')
    const countIdx = returnClause.indexOf('count(n0)')

    expect(statusIdx).toBeLessThan(countIdx)
  })

  it('only one RETURN clause', () => {
    const cypher = graph.node('post').groupBy('status').count().toCypher()
    const returnCount = (cypher.match(/\bRETURN\b/g) || []).length
    expect(returnCount).toBe(1)
  })
})

// =============================================================================
// ERROR HANDLING
// =============================================================================

describe('Error Handling', () => {
  it('HAVING throws not implemented', () => {
    expect(() => {
      graph.node('post').groupBy('status').count().having('count', 'gt', 5)
    }).toThrow('HAVING not yet implemented')
  })
})
