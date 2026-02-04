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
    const comp1Root = await ctx.graph.create('user', {
      id: 'component-1-root',
      name: 'Component1',
      email: 'c1@test.com',
      status: 'active' as const,
    })

    const comp1Child = await ctx.graph.create('user', {
      id: 'component-1-child',
      name: 'Component1Child',
      email: 'c1child@test.com',
      status: 'active' as const,
    })

    await ctx.graph.link('follows', comp1Root.id, comp1Child.id)

    const comp2Root = await ctx.graph.create('user', {
      id: 'component-2-root',
      name: 'Component2',
      email: 'c2@test.com',
      status: 'active' as const,
    })

    const comp2Child = await ctx.graph.create('user', {
      id: 'component-2-child',
      name: 'Component2Child',
      email: 'c2child@test.com',
      status: 'active' as const,
    })

    await ctx.graph.link('follows', comp2Root.id, comp2Child.id)

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
    const hub = await ctx.graph.create('user', {
      id: 'hub-node',
      name: 'Hub',
      email: 'hub@test.com',
      status: 'active' as const,
    })

    // Create 100 followers
    const followers = await ctx.graph.createMany(
      'user',
      Array.from({ length: 100 }, (_, i) => ({
        id: `hub-follower-${i}`,
        name: `Follower${i}`,
        email: `follower${i}@hub.com`,
        status: 'active' as const,
      })),
    )

    // Link all to hub
    await ctx.graph.linkMany(
      'follows',
      followers.map((f) => ({ from: f.id, to: hub.id })),
    )

    // Query all followers
    const startTime = Date.now()
    const allFollowers = await ctx.graph
      .nodeByIdWithLabel('user', hub.id)
      .from('follows')
      .execute()
    const duration = Date.now() - startTime

    expect(allFollowers).toHaveLength(100)
    expect(duration).toBeLessThan(2000) // Should handle efficiently
  })

  it('high fan-in - node with 100 outgoing connections', async () => {
    const superFollower = await ctx.graph.create('user', {
      id: 'super-follower',
      name: 'SuperFollower',
      email: 'superfollower@test.com',
      status: 'active' as const,
    })

    // Create 100 targets
    const targets = await ctx.graph.createMany(
      'user',
      Array.from({ length: 100 }, (_, i) => ({
        id: `fanin-target-${i}`,
        name: `Target${i}`,
        email: `target${i}@fanin.com`,
        status: 'active' as const,
      })),
    )

    // Link to all targets
    await ctx.graph.linkMany(
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
    const users = await ctx.graph.createMany('user', [
      { id: 'cycle-a', name: 'CycleA', email: 'cyclea@test.com', status: 'active' as const },
      { id: 'cycle-b', name: 'CycleB', email: 'cycleb@test.com', status: 'active' as const },
      { id: 'cycle-c', name: 'CycleC', email: 'cyclec@test.com', status: 'active' as const },
    ])

    await ctx.graph.link('follows', users[0]!.id, users[1]!.id)
    await ctx.graph.link('follows', users[1]!.id, users[2]!.id)
    await ctx.graph.link('follows', users[2]!.id, users[0]!.id) // Completes cycle

    // Query: Follow chain should handle cycle gracefully with variable length
    const query = ctx.graph
      .nodeByIdWithLabel('user', users[0]!.id)
      .to('follows', { depth: { min: 1, max: 5 } })
      .distinct()

    const results = await ctx.executor.execute(query.compile())

    // Should find all 3 users in cycle
    expect(results.data).toHaveLength(3)

    const ids = (results.data as Array<{ id: string }>).map((u) => u.id)
    expect(ids).toContain(users[0]!.id)
    expect(ids).toContain(users[1]!.id)
    expect(ids).toContain(users[2]!.id)
  })

  it('reachable with cycles - no infinite loop', async () => {
    // Create mutual follows
    const user1 = await ctx.graph.create('user', {
      id: 'reachable-cycle-1',
      name: 'ReachableCycle1',
      email: 'rc1@test.com',
      status: 'active' as const,
    })

    const user2 = await ctx.graph.create('user', {
      id: 'reachable-cycle-2',
      name: 'ReachableCycle2',
      email: 'rc2@test.com',
      status: 'active' as const,
    })

    await ctx.graph.link('follows', user1.id, user2.id)
    await ctx.graph.link('follows', user2.id, user1.id)

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
    const clique = await ctx.graph.createMany(
      'user',
      Array.from({ length: 5 }, (_, i) => ({
        id: `clique-${i}`,
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

    await ctx.graph.linkMany('follows', links)

    // Query: Each user should have 4 followers
    for (const user of clique) {
      const followers = await ctx.graph
        .nodeByIdWithLabel('user', user.id)
        .from('follows')
        .execute()
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
    const center = await ctx.graph.create('user', {
      id: 'star-center',
      name: 'Center',
      email: 'center@test.com',
      status: 'active' as const,
    })

    // Create 10 spokes
    const spokes = await ctx.graph.createMany(
      'user',
      Array.from({ length: 10 }, (_, i) => ({
        id: `star-spoke-${i}`,
        name: `Spoke${i}`,
        email: `spoke${i}@test.com`,
        status: 'active' as const,
      })),
    )

    // All spokes follow center
    await ctx.graph.linkMany(
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
      const user = await ctx.graph.create('user', {
        id: `chain-${i}`,
        name: `Chain${i}`,
        email: `chain${i}@test.com`,
        status: 'active' as const,
      })
      chain.push(user)
    }

    for (let i = 0; i < chain.length - 1; i++) {
      await ctx.graph.link('follows', chain[i]!.id, chain[i + 1]!.id)
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
    const isolated = await ctx.graph.create('user', {
      id: 'isolated-node',
      name: 'Isolated',
      email: 'isolated@test.com',
      status: 'active' as const,
    })

    // Query followers
    const followers = await ctx.graph
      .nodeByIdWithLabel('user', isolated.id)
      .from('follows')
      .execute()
    expect(followers).toHaveLength(0)

    // Query following
    const following = await ctx.graph
      .nodeByIdWithLabel('user', isolated.id)
      .to('follows')
      .execute()
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
    const root = await ctx.graph.create('folder', {
      id: 'tree-root',
      name: 'Root',
      path: '/tree',
    })

    const left = await ctx.graph.createChild('folder', root.id, {
      id: 'tree-left',
      name: 'Left',
      path: '/tree/left',
    })

    const right = await ctx.graph.createChild('folder', root.id, {
      id: 'tree-right',
      name: 'Right',
      path: '/tree/right',
    })

    const ll = await ctx.graph.createChild('folder', left.id, {
      id: 'tree-ll',
      name: 'LeftLeft',
      path: '/tree/left/left',
    })

    const lr = await ctx.graph.createChild('folder', left.id, {
      id: 'tree-lr',
      name: 'LeftRight',
      path: '/tree/left/right',
    })

    // Query descendants from root
    const descendants = await ctx.graph
      .nodeByIdWithLabel('folder', root.id)
      .descendants()
      .execute()

    expect(descendants).toHaveLength(4)

    // Query ancestors from leaf
    const ancestors = await ctx.graph.nodeByIdWithLabel('folder', ll.id).ancestors().execute()

    expect(ancestors).toHaveLength(2)
    const ancestorNames = ancestors.map((f) => f.name)
    expect(ancestorNames).toContain('Left')
    expect(ancestorNames).toContain('Root')
  })
})
