/**
 * Integration Tests: Query Operations
 *
 * Tests query compilation and execution against a real Memgraph instance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

describe('Query Integration Tests', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  // ===========================================================================
  // BASIC NODE QUERIES
  // ===========================================================================

  describe('Basic Node Queries', () => {
    it('fetches all nodes of a type', async () => {
      const query = ctx.graph.node('user')
      const compiled = query.compile()

      expect(compiled.cypher).toContain('MATCH')
      expect(compiled.cypher).toContain(':User')

      const result = await query.execute()
      expect(result).toHaveLength(3)
    })

    it('fetches node by ID', async () => {
      const result = await ctx.graph.nodeByIdWithLabel('user', ctx.data.users.alice).execute()

      expect(result).toMatchObject({
        id: ctx.data.users.alice,
        name: 'Alice',
        email: 'alice@example.com',
      })
    })

    it('returns empty for non-existent node', async () => {
      const result = await ctx.graph.node('user').where('id', 'eq', 'non-existent-id').execute()
      expect(result).toHaveLength(0)
    })
  })

  // ===========================================================================
  // WHERE FILTERING
  // ===========================================================================

  describe('WHERE Filtering', () => {
    it('filters by equality', async () => {
      const result = await ctx.graph.node('user').where('status', 'eq', 'active').execute()

      expect(result).toHaveLength(2)
      expect(result.every((u) => u.status === 'active')).toBe(true)
    })

    it('filters by inequality', async () => {
      const result = await ctx.graph.node('user').where('status', 'neq', 'inactive').execute()
      expect(result).toHaveLength(2)
    })

    it('filters by greater than', async () => {
      const result = await ctx.graph.node('post').where('views', 'gt', 50).execute()

      expect(result).toHaveLength(2)
      expect(result.every((p) => p.views > 50)).toBe(true)
    })

    it('filters by IN list', async () => {
      const result = await ctx.graph.node('user').where('name', 'in', ['Alice', 'Bob']).execute()

      expect(result).toHaveLength(2)
      expect(result.map((u) => u.name).sort()).toEqual(['Alice', 'Bob'])
    })

    it('filters by startsWith', async () => {
      const result = await ctx.graph.node('user').where('name', 'startsWith', 'A').execute()

      expect(result).toHaveLength(1)
      expect(result[0]!.name).toBe('Alice')
    })

    it('filters by contains', async () => {
      const result = await ctx.graph.node('post').where('title', 'contains', 'World').execute()

      expect(result).toHaveLength(1)
      expect(result[0]!.title).toContain('World')
    })

    it('chains multiple WHERE conditions', async () => {
      const result = await ctx.graph
        .node('post')
        .where('views', 'gt', 50)
        .where('views', 'lt', 200)
        .execute()

      expect(result).toHaveLength(1)
      expect(result[0]!.views).toBe(100)
    })
  })

  // ===========================================================================
  // SORTING & PAGINATION
  // ===========================================================================

  describe('Sorting & Pagination', () => {
    it('orders by single field ascending', async () => {
      const result = await ctx.graph.node('post').orderBy('views', 'ASC').execute()

      const views = result.map((p) => p.views)
      expect(views).toEqual([...views].sort((a, b) => a - b))
    })

    it('orders by single field descending', async () => {
      const result = await ctx.graph.node('post').orderBy('views', 'DESC').execute()

      const views = result.map((p) => p.views)
      expect(views).toEqual([...views].sort((a, b) => b - a))
    })

    it('paginates results', async () => {
      const page1 = await ctx.graph
        .node('post')
        .orderBy('views', 'DESC')
        .paginate({ page: 1, pageSize: 2 })
        .execute()

      const page2 = await ctx.graph
        .node('post')
        .orderBy('views', 'DESC')
        .paginate({ page: 2, pageSize: 2 })
        .execute()

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(1)

      // No overlap
      const page1Ids = page1.map((p) => p.id)
      const page2Ids = page2.map((p) => p.id)
      expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0)
    })

    it('limits results', async () => {
      const result = await ctx.graph.node('user').limit(2).execute()
      expect(result).toHaveLength(2)
    })

    it('skips results', async () => {
      const all = await ctx.graph.node('user').orderBy('name', 'ASC').execute()
      const skipped = await ctx.graph.node('user').orderBy('name', 'ASC').skip(1).execute()

      expect(skipped).toHaveLength(all.length - 1)
      expect(skipped[0]!.id).toBe(all[1]!.id)
    })
  })

  // ===========================================================================
  // TRAVERSAL QUERIES
  // ===========================================================================

  describe('Traversal Queries', () => {
    it('traverses outgoing edges', async () => {
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .to('authored')
        .execute()

      expect(result).toHaveLength(2)
    })

    it('traverses incoming edges', async () => {
      // authored edge has inbound: 'one', so from() returns a single object
      const result = await ctx.graph
        .nodeByIdWithLabel('post', ctx.data.posts.hello)
        .from('authored')
        .execute()

      // inbound: 'one' means each post has exactly one author
      expect(result).toMatchObject({ id: ctx.data.users.alice })
    })

    it('chains multiple traversals', async () => {
      // Alice -> authored -> Post -> hasComment -> Comment
      const result = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .to('authored')
        .to('hasComment')
        .execute()

      expect(result.length).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // AGGREGATIONS
  // ===========================================================================

  describe('Aggregations', () => {
    it('counts nodes', async () => {
      const count = await ctx.graph.node('user').count()
      expect(count).toBe(3)
    })

    it('counts with filter', async () => {
      const count = await ctx.graph.node('user').where('status', 'eq', 'active').count()
      expect(count).toBe(2)
    })

    it('checks exists (true case)', async () => {
      const count = await ctx.graph.node('user').where('name', 'eq', 'Alice').count()
      expect(count).toBeGreaterThan(0)
    })

    it('checks exists (false case)', async () => {
      const count = await ctx.graph.node('user').where('name', 'eq', 'NonExistent').count()
      expect(count).toBe(0)
    })
  })

  // ===========================================================================
  // MULTI-NODE QUERIES (RETURNING)
  // ===========================================================================

  describe('Multi-Node Queries', () => {
    it('returns multiple aliased nodes', async () => {
      const query = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .as('author')
        .to('authored')
        .as('post')
        .to('hasComment')
        .as('comment')
        .return((q) => ({
          author: q.author,
          post: q.post,
          comment: q.comment,
        }))
      const results = await query.execute()

      expect(results.length).toBeGreaterThan(0)

      const first = results[0]!
      expect(first).toHaveProperty('author')
      expect(first).toHaveProperty('post')
      expect(first).toHaveProperty('comment')
      expect(first.author.id).toBe(ctx.data.users.alice)
    })
  })

  // ===========================================================================
  // HIERARCHY QUERIES
  // ===========================================================================

  describe('Hierarchy Queries', () => {
    it('fetches ancestors', async () => {
      const ancestors = await ctx.graph
        .nodeByIdWithLabel('folder', ctx.data.folders.work)
        .ancestors()
        .execute()

      expect(ancestors).toHaveLength(2)
      const names = ancestors.map((f) => (f as unknown as { name: string }).name)
      expect(names).toContain('Documents')
      expect(names).toContain('Root')
    })

    it('fetches descendants', async () => {
      const descendants = await ctx.graph
        .nodeByIdWithLabel('folder', ctx.data.folders.root)
        .descendants()
        .execute()

      expect(descendants).toHaveLength(2)
    })

    it('fetches root', async () => {
      const root = await ctx.graph
        .nodeByIdWithLabel('folder', ctx.data.folders.work)
        .root()
        .execute()

      expect(root.id).toBe(ctx.data.folders.root)
    })
  })

  // ===========================================================================
  // COMPILE OUTPUT VERIFICATION
  // ===========================================================================

  describe('Compile Output', () => {
    it('uses parameters for values', async () => {
      const query = ctx.graph.node('user').where('name', 'eq', 'Alice')
      const compiled = query.compile()

      // Should use parameter placeholder, not inline value
      expect(compiled.cypher).not.toContain("'Alice'")
      expect(compiled.params).toBeDefined()
      expect(Object.values(compiled.params)).toContain('Alice')
    })

    it('includes all required clauses', async () => {
      const query = ctx.graph
        .node('post')
        .where('views', 'gt', 10)
        .orderBy('views', 'DESC')
        .limit(5)
      const compiled = query.compile()

      expect(compiled.cypher).toContain('MATCH')
      expect(compiled.cypher).toContain('WHERE')
      expect(compiled.cypher).toContain('ORDER BY')
      expect(compiled.cypher).toContain('LIMIT')
      expect(compiled.cypher).toContain('RETURN')
    })
  })
})
