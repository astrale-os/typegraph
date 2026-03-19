/**
 * Integration Tests: Graph Topology & Pathological Cases
 *
 * Tests unusual graph structures: disconnected components, high fan-out,
 * cycles, and other graph topology edge cases.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { setupIntegrationTest, teardownIntegrationTest, type TestContext } from './setup'

describe('Graph Topology', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  it('disconnected components - reachable should not cross', async () => {
    // Create two separate components
    const comp1Root = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Component1',
        email: 'c1@test.com',
        status: 'active' as const,
      },
      { id: 'component-1-root' },
    )

    const comp1Child = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Component1Child',
        email: 'c1child@test.com',
        status: 'active' as const,
      },
      { id: 'component-1-child' },
    )

    await ctx.graph.mutate.link('follows', comp1Root.id, comp1Child.id)

    const comp2Root = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Component2',
        email: 'c2@test.com',
        status: 'active' as const,
      },
      { id: 'component-2-root' },
    )

    const comp2Child = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Component2Child',
        email: 'c2child@test.com',
        status: 'active' as const,
      },
      { id: 'component-2-child' },
    )

    await ctx.graph.mutate.link('follows', comp2Root.id, comp2Child.id)

    // Query reachable from component 1
    const reachable = await ctx.graph
      .nodeByIdWithLabel('user', comp1Root.id)
      .selfAndReachable(['follows'])
      .execute()

    const reachableIds = reachable.map((u) => u.id)

    // Should include component 1 nodes
    expect(reachableIds).toContain(comp1Root.id)
    expect(reachableIds).toContain(comp1Child.id)

    // Should NOT include component 2 nodes
    expect(reachableIds).not.toContain(comp2Root.id)
    expect(reachableIds).not.toContain(comp2Child.id)
  })

  it('high fan-out - hub node with 100 connections', async () => {
    const hub = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Hub',
        email: 'hub@test.com',
        status: 'active' as const,
      },
      { id: 'hub-node' },
    )

    // Create 100 followers
    const followers = await ctx.graph.mutate.createMany(
      'user',
      Array.from({ length: 100 }, (_, i) => ({
        name: `Follower${i}`,
        email: `follower${i}@hub.com`,
        status: 'active' as const,
      })),
    )

    // Link all to hub
    await ctx.graph.mutate.linkMany(
      'follows',
      followers.map((f) => ({ from: f.id, to: hub.id })),
    )

    // Query all followers
    const startTime = Date.now()
    const allFollowers = await ctx.graph.nodeByIdWithLabel('user', hub.id).from('follows').execute()
    const duration = Date.now() - startTime

    expect(allFollowers).toHaveLength(100)
    expect(duration).toBeLessThan(2000) // Should handle efficiently
  })

  it('high fan-in - node with 100 outgoing connections', async () => {
    const superFollower = await ctx.graph.mutate.create(
      'user',
      {
        name: 'SuperFollower',
        email: 'superfollower@test.com',
        status: 'active' as const,
      },
      { id: 'super-follower' },
    )

    // Create 100 targets
    const targets = await ctx.graph.mutate.createMany(
      'user',
      Array.from({ length: 100 }, (_, i) => ({
        name: `Target${i}`,
        email: `target${i}@fanin.com`,
        status: 'active' as const,
      })),
    )

    // Link to all targets
    await ctx.graph.mutate.linkMany(
      'follows',
      targets.map((t) => ({ from: superFollower.id, to: t.id })),
    )

    // Query all following
    const following = await ctx.graph
      .nodeByIdWithLabel('user', superFollower.id)
      .to('follows')
      .execute()

    expect(following).toHaveLength(100)
  })

  it('cycle in non-hierarchy edges', async () => {
    // Create cycle: A -> B -> C -> A
    const userA = await ctx.graph.mutate.create(
      'user',
      { name: 'CycleA', email: 'cyclea@test.com', status: 'active' as const },
      { id: 'cycle-a' },
    )
    const userB = await ctx.graph.mutate.create(
      'user',
      { name: 'CycleB', email: 'cycleb@test.com', status: 'active' as const },
      { id: 'cycle-b' },
    )
    const userC = await ctx.graph.mutate.create(
      'user',
      { name: 'CycleC', email: 'cyclec@test.com', status: 'active' as const },
      { id: 'cycle-c' },
    )

    await ctx.graph.mutate.link('follows', userA.id, userB.id)
    await ctx.graph.mutate.link('follows', userB.id, userC.id)
    await ctx.graph.mutate.link('follows', userC.id, userA.id) // Completes cycle

    // Query using raw Cypher to test cycle with variable length path
    const results = await ctx.graph.raw<{ id: string }>(
      `MATCH (start:User {id: $startId})-[:follows*1..5]->(reachable:User)
       RETURN DISTINCT reachable.id as id`,
      { startId: userA.id },
    )

    // Should find all 3 users in cycle (including A via C->A)
    expect(results).toHaveLength(3)

    const ids = results.map((u) => u.id)
    expect(ids).toContain(userA.id)
    expect(ids).toContain(userB.id)
    expect(ids).toContain(userC.id)
  })

  it('reachable with cycles - no infinite loop', async () => {
    // Create mutual follows
    const user1 = await ctx.graph.mutate.create(
      'user',
      {
        name: 'ReachableCycle1',
        email: 'rc1@test.com',
        status: 'active' as const,
      },
      { id: 'reachable-cycle-1' },
    )

    const user2 = await ctx.graph.mutate.create(
      'user',
      {
        name: 'ReachableCycle2',
        email: 'rc2@test.com',
        status: 'active' as const,
      },
      { id: 'reachable-cycle-2' },
    )

    await ctx.graph.mutate.link('follows', user1.id, user2.id)
    await ctx.graph.mutate.link('follows', user2.id, user1.id)

    // Query reachable
    const reachable = await ctx.graph
      .nodeByIdWithLabel('user', user1.id)
      .selfAndReachable(['follows'])
      .execute()

    // Should return both users without infinite loop
    expect(reachable).toHaveLength(2)
    const ids = reachable.map((u) => u.id)
    expect(ids).toContain(user1.id)
    expect(ids).toContain(user2.id)
  })

  it('fully connected clique - every node connected to every other', async () => {
    // Create 5 users all following each other
    const clique = await ctx.graph.mutate.createMany(
      'user',
      Array.from({ length: 5 }, (_, i) => ({
        name: `Clique${i}`,
        email: `clique${i}@test.com`,
        status: 'active' as const,
      })),
    )

    // Create all pairs of follows relationships
    const links = []
    for (let i = 0; i < clique.length; i++) {
      for (let j = 0; j < clique.length; j++) {
        if (i !== j) {
          links.push({ from: clique[i]!.id, to: clique[j]!.id })
        }
      }
    }

    await ctx.graph.mutate.linkMany('follows', links)

    // Query: Each user should have 4 followers
    for (const user of clique) {
      const followers = await ctx.graph.nodeByIdWithLabel('user', user.id).from('follows').execute()
      expect(followers).toHaveLength(4)
    }

    // Reachable should find all 5 from any starting point
    const reachable = await ctx.graph
      .nodeByIdWithLabel('user', clique[0]!.id)
      .selfAndReachable(['follows'])
      .execute()

    expect(reachable).toHaveLength(5)
  })

  it('star topology - central hub', async () => {
    const center = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Center',
        email: 'center@test.com',
        status: 'active' as const,
      },
      { id: 'star-center' },
    )

    // Create 10 spokes
    const spokes = await ctx.graph.mutate.createMany(
      'user',
      Array.from({ length: 10 }, (_, i) => ({
        name: `Spoke${i}`,
        email: `spoke${i}@test.com`,
        status: 'active' as const,
      })),
    )

    // All spokes follow center
    await ctx.graph.mutate.linkMany(
      'follows',
      spokes.map((s) => ({ from: s.id, to: center.id })),
    )

    // Spokes don't follow each other
    // Query from spoke should only reach center
    const reachable = await ctx.graph
      .nodeByIdWithLabel('user', spokes[0]!.id)
      .reachable(['follows'])
      .execute()

    expect(reachable).toHaveLength(1)
    expect(reachable[0]!.id).toBe(center.id)
  })

  it('chain topology - linear sequence', async () => {
    // Create A -> B -> C -> D -> E
    const chain = []
    for (let i = 0; i < 5; i++) {
      const user = await ctx.graph.mutate.create(
        'user',
        {
          name: `Chain${i}`,
          email: `chain${i}@test.com`,
          status: 'active' as const,
        },
        { id: `chain-${i}` },
      )
      chain.push(user)
    }

    for (let i = 0; i < chain.length - 1; i++) {
      await ctx.graph.mutate.link('follows', chain[i]!.id, chain[i + 1]!.id)
    }

    // Reachable from start should find all
    const reachable = await ctx.graph
      .nodeByIdWithLabel('user', chain[0]!.id)
      .reachable(['follows'])
      .execute()

    expect(reachable).toHaveLength(4)

    // Reachable from end should find none (no outgoing)
    const fromEnd = await ctx.graph
      .nodeByIdWithLabel('user', chain[4]!.id)
      .reachable(['follows'])
      .execute()

    expect(fromEnd).toHaveLength(0)
  })

  it('isolated node - no connections', async () => {
    const isolated = await ctx.graph.mutate.create(
      'user',
      {
        name: 'Isolated',
        email: 'isolated@test.com',
        status: 'active' as const,
      },
      { id: 'isolated-node' },
    )

    // Query followers
    const followers = await ctx.graph
      .nodeByIdWithLabel('user', isolated.id)
      .from('follows')
      .execute()
    expect(followers).toHaveLength(0)

    // Query following
    const following = await ctx.graph.nodeByIdWithLabel('user', isolated.id).to('follows').execute()
    expect(following).toHaveLength(0)

    // Reachable should only include self
    const reachable = await ctx.graph
      .nodeByIdWithLabel('user', isolated.id)
      .selfAndReachable(['follows'])
      .execute()
    expect(reachable).toHaveLength(1)
    expect(reachable[0]!.id).toBe(isolated.id)
  })

  it('tree topology - no cycles', async () => {
    // Create binary tree: root -> [left, right], left -> [ll, lr], right -> [rl, rr]
    const root = await ctx.graph.mutate.create(
      'folder',
      {
        name: 'Root',
        path: '/tree',
      },
      { id: 'tree-root' },
    )

    const left = await ctx.graph.mutate.createChild('folder', root.id, {
      name: 'Left',
      path: '/tree/left',
    })

    const right = await ctx.graph.mutate.createChild('folder', root.id, {
      name: 'Right',
      path: '/tree/right',
    })

    const ll = await ctx.graph.mutate.createChild('folder', left.id, {
      name: 'LeftLeft',
      path: '/tree/left/left',
    })

    const lr = await ctx.graph.mutate.createChild('folder', left.id, {
      name: 'LeftRight',
      path: '/tree/left/right',
    })

    // Query descendants from root
    const descendants = await ctx.graph.nodeByIdWithLabel('folder', root.id).descendants().execute()

    expect(descendants).toHaveLength(4)

    // Query ancestors from leaf
    const ancestors = await ctx.graph.nodeByIdWithLabel('folder', ll.id).ancestors().execute()

    expect(ancestors).toHaveLength(2)
    // Use type assertion since ancestors() return type may not include all folder properties
    const ancestorNames = ancestors.map((f) => (f as unknown as { name: string }).name)
    expect(ancestorNames).toContain('Left')
    expect(ancestorNames).toContain('Root')
  })
})
