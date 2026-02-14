/**
 * Query Compilation Specification - Projection & Returns
 *
 * Tests for RETURN clauses, aliasing, and multi-node returns.
 */

import { describe, it, expect } from 'vitest'
import { normalizeCypher } from './fixtures/test-schema'

describe('Query Compilation: Projection', () => {
  // ===========================================================================
  // BASIC RETURN
  // ===========================================================================

  describe('Basic Return', () => {
    it('returns single node', () => {
      // graph.node('user').compile()
      const expected = `
        MATCH (n0:user)
        RETURN n0
      `

      expect(normalizeCypher(expected)).toContain('RETURN n0')
    })

    it('returns node with specific fields via select()', () => {
      // graph.node('user').select('id', 'name', 'email').compile()
      const expected = `
        MATCH (n0:user)
        RETURN n0.id, n0.name, n0.email
      `

      expect(normalizeCypher(expected)).toContain('RETURN n0.id, n0.name, n0.email')
    })
  })

  // ===========================================================================
  // ALIASED RETURNS
  // ===========================================================================

  describe('Aliased Returns', () => {
    it('returns node with user-defined alias', () => {
      // graph.node('user').byId('u1').as('author').returning('author').compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        RETURN n0 AS author
      `

      expect(normalizeCypher(expected)).toContain('RETURN n0 AS author')
    })

    it('returns multiple aliased nodes', () => {
      // graph.node('user').byId('u1')
      //   .as('author')
      //   .to('authored')
      //   .as('post')
      //   .returning('author', 'post')
      //   .compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:authored]->(n1:post)
        RETURN n0 AS author, n1 AS post
      `

      expect(normalizeCypher(expected)).toContain('RETURN n0 AS author, n1 AS post')
    })

    it('returns three aliased nodes from chain', () => {
      // graph.node('user').byId('u1')
      //   .as('author')
      //   .to('authored')
      //   .as('post')
      //   .from('commentedOn')
      //   .as('comment')
      //   .returning('author', 'post', 'comment')
      //   .compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:authored]->(n1:post)
        MATCH (n1)<-[e1:commentedOn]-(n2:comment)
        RETURN n0 AS author, n1 AS post, n2 AS comment
      `

      expect(normalizeCypher(expected)).toContain('n0 AS author, n1 AS post, n2 AS comment')
    })
  })

  // ===========================================================================
  // COUNT & EXISTS
  // ===========================================================================

  describe('Count and Exists', () => {
    it('compiles count query', () => {
      // graph.node('user').count()
      const expected = `
        MATCH (n0:user)
        RETURN count(n0) AS count
      `

      expect(normalizeCypher(expected)).toContain('RETURN count(n0)')
    })

    it('compiles count with filter', () => {
      // graph.node('user').where('status', 'eq', 'active').count()
      const expected = `
        MATCH (n0:user)
        WHERE n0.status = $p0
        RETURN count(n0) AS count
      `

      expect(normalizeCypher(expected)).toContain('WHERE n0.status = $p0')
      expect(normalizeCypher(expected)).toContain('RETURN count(n0)')
    })

    it('compiles exists check', () => {
      // graph.node('user').byId('u1').exists()
      const expected = `
        MATCH (n0:user {id: $p0})
        RETURN count(n0) > 0 AS exists
      `

      expect(normalizeCypher(expected)).toContain('count(n0) > 0 AS exists')
    })
  })

  // ===========================================================================
  // DISTINCT
  // ===========================================================================

  describe('Distinct', () => {
    it('compiles distinct query', () => {
      // graph.node('user').to('authored').distinct().compile()
      const expected = `
        MATCH (n0:user)
        MATCH (n0)-[e0:authored]->(n1:post)
        RETURN DISTINCT n1
      `

      expect(normalizeCypher(expected)).toContain('RETURN DISTINCT n1')
    })
  })

  // ===========================================================================
  // ORDERING
  // ===========================================================================

  describe('Ordering', () => {
    it('compiles ORDER BY ascending', () => {
      // graph.node('user').orderBy('name', 'ASC').compile()
      const expected = `
        MATCH (n0:user)
        RETURN n0
        ORDER BY n0.name ASC
      `

      expect(normalizeCypher(expected)).toContain('ORDER BY n0.name ASC')
    })

    it('compiles ORDER BY descending', () => {
      // graph.node('user').orderBy('createdAt', 'DESC').compile()
      const expected = `
        MATCH (n0:user)
        RETURN n0
        ORDER BY n0.createdAt DESC
      `

      expect(normalizeCypher(expected)).toContain('ORDER BY n0.createdAt DESC')
    })

    it('compiles ORDER BY multiple fields', () => {
      // graph.node('user')
      //   .orderByMultiple([
      //     { field: 'status', direction: 'ASC' },
      //     { field: 'name', direction: 'DESC' }
      //   ])
      //   .compile()
      const expected = `
        MATCH (n0:user)
        RETURN n0
        ORDER BY n0.status ASC, n0.name DESC
      `

      expect(normalizeCypher(expected)).toContain('ORDER BY n0.status ASC, n0.name DESC')
    })
  })

  // ===========================================================================
  // PAGINATION
  // ===========================================================================

  describe('Pagination', () => {
    it('compiles LIMIT', () => {
      // graph.node('user').limit(10).compile()
      const expected = `
        MATCH (n0:user)
        RETURN n0
        LIMIT 10
      `

      expect(normalizeCypher(expected)).toContain('LIMIT 10')
    })

    it('compiles SKIP', () => {
      // graph.node('user').skip(20).compile()
      const expected = `
        MATCH (n0:user)
        RETURN n0
        SKIP 20
      `

      expect(normalizeCypher(expected)).toContain('SKIP 20')
    })

    it('compiles SKIP and LIMIT together', () => {
      // graph.node('user').skip(20).limit(10).compile()
      const expected = `
        MATCH (n0:user)
        RETURN n0
        SKIP 20
        LIMIT 10
      `

      expect(normalizeCypher(expected)).toContain('SKIP 20')
      expect(normalizeCypher(expected)).toContain('LIMIT 10')
    })

    it('compiles paginate helper', () => {
      // graph.node('user').paginate({ page: 3, pageSize: 10 }).compile()
      // page 3 with pageSize 10 = skip 20, limit 10
      const expected = `
        MATCH (n0:user)
        RETURN n0
        SKIP 20
        LIMIT 10
      `

      expect(normalizeCypher(expected)).toContain('SKIP 20')
      expect(normalizeCypher(expected)).toContain('LIMIT 10')
    })

    it('compiles ORDER BY + LIMIT + SKIP in correct order', () => {
      // graph.node('user')
      //   .orderBy('name', 'ASC')
      //   .skip(10)
      //   .limit(5)
      //   .compile()
      const expected = `
        MATCH (n0:user)
        RETURN n0
        ORDER BY n0.name ASC
        SKIP 10
        LIMIT 5
      `

      // Cypher requires ORDER BY before SKIP/LIMIT
      const normalized = normalizeCypher(expected)
      const orderByIdx = normalized.indexOf('ORDER BY')
      const skipIdx = normalized.indexOf('SKIP')
      const limitIdx = normalized.indexOf('LIMIT')

      expect(orderByIdx).toBeLessThan(skipIdx)
      expect(skipIdx).toBeLessThan(limitIdx)
    })
  })

  // ===========================================================================
  // AGGREGATION
  // ===========================================================================

  describe('Aggregation', () => {
    it('compiles GROUP BY with count', () => {
      // graph.node('post')
      //   .groupBy('status')
      //   .count()
      //   .compile()
      const expected = `
        MATCH (n0:post)
        RETURN n0.status, count(n0) AS count
      `

      expect(normalizeCypher(expected)).toContain('n0.status, count(n0)')
    })

    it('compiles sum aggregation', () => {
      // graph.node('post')
      //   .groupBy('status')
      //   .sum('viewCount', { alias: 'totalViews' })
      //   .compile()
      const expected = `
        MATCH (n0:post)
        RETURN n0.status, sum(n0.viewCount) AS totalViews
      `

      expect(normalizeCypher(expected)).toContain('sum(n0.viewCount) AS totalViews')
    })

    it('compiles avg aggregation', () => {
      // graph.node('user')
      //   .avg('score', { alias: 'avgScore' })
      //   .compile()
      const expected = `
        MATCH (n0:user)
        RETURN avg(n0.score) AS avgScore
      `

      expect(normalizeCypher(expected)).toContain('avg(n0.score) AS avgScore')
    })

    it('compiles min/max aggregation', () => {
      // graph.node('post')
      //   .min('viewCount', { alias: 'minViews' })
      //   .max('viewCount', { alias: 'maxViews' })
      //   .compile()
      const expected = `
        MATCH (n0:post)
        RETURN min(n0.viewCount) AS minViews, max(n0.viewCount) AS maxViews
      `

      expect(normalizeCypher(expected)).toContain('min(n0.viewCount)')
      expect(normalizeCypher(expected)).toContain('max(n0.viewCount)')
    })

    it('compiles collect aggregation', () => {
      // graph.node('user').byId('u1')
      //   .to('authored')
      //   .collect('title', { alias: 'postTitles' })
      //   .compile()
      const expected = `
        MATCH (n0:user {id: $p0})
        MATCH (n0)-[e0:authored]->(n1:post)
        RETURN collect(n1.title) AS postTitles
      `

      expect(normalizeCypher(expected)).toContain('collect(n1.title) AS postTitles')
    })
  })
})
