/**
 * Integration Tests: Complex Query Patterns
 *
 * Tests advanced query patterns including multi-edge traversals, optional paths,
 * self-referencing edges, and complex return structures.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

describe('Complex Query Patterns', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  it('self-referencing edge - user following other users', async () => {
    const alice = ctx.data.users.alice

    // Query followers (incoming)
    const followers = await ctx.graph
      .nodeByIdWithLabel('user', alice)
      .from('follows')
      .execute()

    expect(followers.length).toBeGreaterThan(0)
    expect(followers.every((u) => u.id !== alice)).toBe(true) // Not including self

    // Query following (outgoing)
    const following = await ctx.graph.nodeByIdWithLabel('user', alice).to('follows').execute()

    // Should be User[] type
    expect(Array.isArray(following)).toBe(true)
  })

  it('self-loop - user following themselves', async () => {
    const narcissist = await ctx.graph.create('user', {
      id: 'self-follower',
      name: 'Narcissist',
      email: 'narcissist@test.com',
      status: 'active' as const,
    })

    // Create self-loop
    await ctx.graph.link('follows', narcissist.id, narcissist.id)

    // Query
    const following = await ctx.graph
      .nodeByIdWithLabel('user', narcissist.id)
      .to('follows')
      .execute()

    expect(following).toHaveLength(1)
    expect(following[0]!.id).toBe(narcissist.id)

    // Query from opposite direction
    const followers = await ctx.graph
      .nodeByIdWithLabel('user', narcissist.id)
      .from('follows')
      .execute()

    expect(followers).toHaveLength(1)
    expect(followers[0]!.id).toBe(narcissist.id)
  })

  it('mutual relationships - users following each other', async () => {
    const user1 = await ctx.graph.create('user', {
      id: 'mutual-1',
      name: 'Mutual1',
      email: 'mutual1@test.com',
      status: 'active' as const,
    })

    const user2 = await ctx.graph.create('user', {
      id: 'mutual-2',
      name: 'Mutual2',
      email: 'mutual2@test.com',
      status: 'active' as const,
    })

    // Create bidirectional relationship
    await ctx.graph.link('follows', user1.id, user2.id)
    await ctx.graph.link('follows', user2.id, user1.id)

    // Find mutual followers: user1 -> follows -> X -> follows -> user1
    const mutual = await ctx.graph
      .nodeByIdWithLabel('user', user1.id)
      .to('follows')
      .as('followed')
      .to('follows')
      .where('id', 'eq', user1.id)
      .returning('followed')
      .execute()

    expect(mutual).toHaveLength(1)
    expect(mutual[0]!.followed.id).toBe(user2.id)
  })

  it('optional traversal returning null', async () => {
    const userWithoutParent = await ctx.graph.create('folder', {
      id: 'orphan-folder',
      name: 'Orphan',
      path: '/orphan',
    })

    // Query optional parent
    const query = ctx.graph.nodeByIdWithLabel('folder', userWithoutParent.id).parent()

    const result = await ctx.executor.executeOptional(query.compile())
    expect(result.data).toBeNull()
  })

  it('optional traversal returning value', async () => {
    const childFolder = ctx.data.folders.work

    const parent = await ctx.graph.nodeByIdWithLabel('folder', childFolder).parent()

    expect(parent).not.toBeNull()
    expect(parent?.id).toBe(ctx.data.folders.docs)
  })

  it('chained optional traversals', async () => {
    // Create: A -> B (no parent for A)
    const folderB = await ctx.graph.create('folder', {
      id: 'optional-chain-b',
      name: 'Folder B',
      path: '/b',
    })

    const folderA = await ctx.graph.createChild('folder', folderB.id, {
      id: 'optional-chain-a',
      name: 'Folder A',
      path: '/b/a',
    })

    // Query: A -> parent -> parent (should return null since B has no parent)
    const query = ctx.graph
      .nodeByIdWithLabel('folder', folderA.id)
      .toOptional('hasParent')
      .toOptional('hasParent')

    const result = await ctx.executor.executeOptional(query.compile())
    expect(result.data).toBeNull()
  })

  it('multi-node return with deeply nested aliases', async () => {
    const alice = ctx.data.users.alice

    const query = ctx.graph
      .nodeByIdWithLabel('user', alice)
      .as('author')
      .to('authored')
      .as('post')
      .to('hasComment')
      .as('comment')
      .from('wroteComment')
      .as('commenter')
      .returning('author', 'post', 'comment', 'commenter')

    const results = await ctx.executor.executeMultiNode(query.compile())

    expect(results.data.length).toBeGreaterThan(0)

    const first = results.data[0]!
    expect(first).toHaveProperty('author')
    expect(first).toHaveProperty('post')
    expect(first).toHaveProperty('comment')
    expect(first).toHaveProperty('commenter')

    expect(first.author.id).toBe(alice)
  })

  it('edge existence filtering', async () => {
    // Users who have authored posts
    const authorsQuery = ctx.graph.node('user').hasEdge('authored', 'out')
    const authors = await ctx.executor.execute(authorsQuery.compile())

    expect(authors.data.length).toBeGreaterThan(0)
    expect(
      (authors.data as Array<{ id: string }>).every((u) =>
        [ctx.data.users.alice, ctx.data.users.bob].includes(u.id),
      ),
    ).toBe(true)

    // Users who have NOT authored posts
    const nonAuthorsQuery = ctx.graph.node('user').hasNoEdge('authored', 'out')
    const nonAuthors = await ctx.executor.execute(nonAuthorsQuery.compile())

    expect(nonAuthors.data.length).toBeGreaterThan(0)
    expect(
      (nonAuthors.data as Array<{ id: string }>).every(
        (u) => ![ctx.data.users.alice, ctx.data.users.bob].includes(u.id),
      ),
    ).toBe(true)
  })

  it('whereConnectedTo optimization', async () => {
    const alice = ctx.data.users.alice

    // Find posts liked by Alice
    const query = ctx.graph.node('post').whereConnectedTo('likes', alice, 'in')

    const compiled = query.compile()

    // Should use MATCH pattern (optimized)
    expect(compiled.cypher).toContain('MATCH')

    const results = await ctx.executor.execute(compiled)
    expect(results.data.length).toBeGreaterThan(0)
  })

  it('variable length path - followers at distance 2-3', async () => {
    // Create chain: A -> B -> C -> D
    const users = []
    for (let i = 0; i < 4; i++) {
      const user = await ctx.graph.create('user', {
        id: `varlen-${i}`,
        name: `VarLen${i}`,
        email: `varlen${i}@test.com`,
        status: 'active' as const,
      })
      users.push(user)
    }

    for (let i = 0; i < users.length - 1; i++) {
      await ctx.graph.link('follows', users[i]!.id, users[i + 1]!.id)
    }

    // Query: Find users at depth 2-3 from user 0
    const query = ctx.graph
      .nodeByIdWithLabel('user', users[0]!.id)
      .to('follows', { depth: { min: 2, max: 3 } })

    const compiled = query.compile()
    expect(compiled.cypher).toContain('*2..3')

    const results = await ctx.executor.execute(compiled)

    // Should find users at positions 2 and 3 (0-indexed)
    const ids = (results.data as Array<{ id: string }>).map((u) => u.id)
    expect(ids).toContain(users[2]!.id)
    expect(ids).toContain(users[3]!.id)
    expect(ids).not.toContain(users[0]!.id) // Starting node
    expect(ids).not.toContain(users[1]!.id) // Depth 1
  })

  it('distinct removes duplicates from variable length paths', async () => {
    // Create diamond: A -> B -> D, A -> C -> D
    const users = []
    for (let i = 0; i < 4; i++) {
      const user = await ctx.graph.create('user', {
        id: `diamond-${i}`,
        name: `Diamond${i}`,
        email: `diamond${i}@test.com`,
        status: 'active' as const,
      })
      users.push(user)
    }

    // A -> B, A -> C
    await ctx.graph.link('follows', users[0]!.id, users[1]!.id)
    await ctx.graph.link('follows', users[0]!.id, users[2]!.id)
    // B -> D, C -> D
    await ctx.graph.link('follows', users[1]!.id, users[3]!.id)
    await ctx.graph.link('follows', users[2]!.id, users[3]!.id)

    // Query: All users reachable via 1-2 hops (should include D twice without distinct)
    const query = ctx.graph
      .nodeByIdWithLabel('user', users[0]!.id)
      .to('follows', { depth: { min: 1, max: 2 } })
      .distinct()

    const results = await ctx.executor.execute(query.compile())

    const ids = (results.data as Array<{ id: string }>).map((u) => u.id)
    const uniqueIds = [...new Set(ids)]
    expect(ids).toEqual(uniqueIds) // Should be deduplicated

    // Should include B, C, D
    expect(ids).toContain(users[1]!.id)
    expect(ids).toContain(users[2]!.id)
    expect(ids).toContain(users[3]!.id)
  })

  it('hierarchy - ancestors with depth', async () => {
    const deepFolder = ctx.data.folders.work

    const ancestors = await ctx.graph
      .nodeByIdWithLabel('folder', deepFolder)
      .ancestors()
      .execute()

    expect(ancestors.length).toBe(2) // docs and root
    const names = ancestors.map((f) => f.name)
    expect(names).toContain('Documents')
    expect(names).toContain('Root')
  })

  it('hierarchy - descendants', async () => {
    const rootFolder = ctx.data.folders.root

    const descendants = await ctx.graph
      .nodeByIdWithLabel('folder', rootFolder)
      .descendants()
      .execute()

    expect(descendants.length).toBe(2) // docs and work
    const names = descendants.map((f) => f.name)
    expect(names).toContain('Documents')
    expect(names).toContain('Work')
  })

  it('hierarchy - siblings', async () => {
    // Create two children under same parent
    const parent = await ctx.graph.create('folder', {
      id: 'sibling-parent',
      name: 'Parent',
      path: '/parent',
    })

    const child1 = await ctx.graph.createChild('folder', parent.id, {
      id: 'sibling-1',
      name: 'Sibling1',
      path: '/parent/sibling1',
    })

    const child2 = await ctx.graph.createChild('folder', parent.id, {
      id: 'sibling-2',
      name: 'Sibling2',
      path: '/parent/sibling2',
    })

    // Query siblings of child1
    const siblings = await ctx.graph
      .nodeByIdWithLabel('folder', child1.id)
      .siblings()
      .execute()

    expect(siblings).toHaveLength(1)
    expect(siblings[0]!.id).toBe(child2.id)
  })

  it('hierarchy - root navigation', async () => {
    const deepFolder = ctx.data.folders.work

    const root = await ctx.graph.nodeByIdWithLabel('folder', deepFolder).root().execute()

    expect(root.id).toBe(ctx.data.folders.root)
    expect(root.name).toBe('Root')
  })

  it('complex WHERE with AND/OR/NOT', async () => {
    const query = ctx.graph.node('user').whereComplex((where) =>
      where.or(
        // Active users named Alice
        where.and(
          where.field('status', 'eq', 'active'),
          where.field('name', 'eq', 'Alice'),
        ),
        // NOT (inactive AND name starts with C)
        where.not(
          where.and(
            where.field('status', 'eq', 'inactive'),
            where.field('name', 'startsWith', 'C'),
          ),
        ),
      ),
    )

    const results = await ctx.executor.execute(query.compile())

    // Should include Alice (active) and Bob (not inactive+C)
    // Should exclude Charlie (inactive AND starts with C)
    const names = (results.data as Array<{ name: string }>).map((u) => u.name)
    expect(names).toContain('Alice')
    expect(names).toContain('Bob')
    expect(names).not.toContain('Charlie')
  })

  it('orderBy multiple fields', async () => {
    // Create posts with same views (non-unique sort key)
    await ctx.graph.createMany('post', [
      { id: 'multi-sort-1', title: 'ZZZ Post', views: 100 },
      { id: 'multi-sort-2', title: 'AAA Post', views: 100 },
      { id: 'multi-sort-3', title: 'MMM Post', views: 100 },
    ])

    const query = ctx.graph
      .node('post')
      .where('views', 'eq', 100)
      .orderByMultiple([
        { field: 'views', direction: 'DESC' },
        { field: 'title', direction: 'ASC' },
      ])

    const results = await ctx.executor.execute(query.compile())

    const titles = (results.data as Array<{ title: string }>).map((p) => p.title)

    // Should be sorted by title when views are equal
    const relevantTitles = titles.filter((t) =>
      ['AAA Post', 'MMM Post', 'ZZZ Post'].includes(t),
    )
    expect(relevantTitles).toEqual(['AAA Post', 'MMM Post', 'ZZZ Post'])
  })

  it('pagination consistency with stable sort', async () => {
    // Create posts with identical views
    const posts = await ctx.graph.createMany(
      'post',
      Array.from({ length: 10 }, (_, i) => ({
        id: `pagination-stable-${i}`,
        title: `Stable Post ${i}`,
        views: 50, // All same
      })),
    )

    // Get two pages with non-unique sort
    const page1 = await ctx.graph
      .node('post')
      .where('title', 'startsWith', 'Stable Post')
      .orderByMultiple([
        { field: 'views', direction: 'DESC' },
        { field: 'id', direction: 'ASC' }, // Add stable secondary sort
      ])
      .paginate({ page: 1, pageSize: 5 })
      .execute()

    const page2 = await ctx.graph
      .node('post')
      .where('title', 'startsWith', 'Stable Post')
      .orderByMultiple([
        { field: 'views', direction: 'DESC' },
        { field: 'id', direction: 'ASC' },
      ])
      .paginate({ page: 2, pageSize: 5 })
      .execute()

    // Verify no overlap
    const page1Ids = page1.map((p) => p.id)
    const page2Ids = page2.map((p) => p.id)

    const overlap = page1Ids.filter((id) => page2Ids.includes(id))
    expect(overlap).toHaveLength(0)
  })
})
