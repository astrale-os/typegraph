/**
 * Integration Tests: Clone Operations
 *
 * Tests clone and cloneSubtree operations against a real database instance.
 * These operations create copies of nodes and subtrees with optional property
 * overrides and hierarchy preservation.
 *
 * Note: FalkorDB does not support ACID transactions with rollback.
 * Tests requiring transactions (cloneSubtree) are skipped when running against FalkorDB.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import {
  setupIntegrationTest,
  teardownIntegrationTest,
  clearDatabase,
  seedTestData,
  type TestContext,
} from './setup'

// FalkorDB doesn't support ACID transactions - skip cloneSubtree tests
const isFalkorDB = (process.env.TEST_DB_TYPE ?? 'falkordb') === 'falkordb'

describe('Clone Operations Integration Tests', () => {
  let ctx: TestContext

  beforeAll(async () => {
    ctx = await setupIntegrationTest()
  }, 30000)

  afterAll(async () => {
    await teardownIntegrationTest(ctx)
  })

  // Reset data before each test to ensure isolation
  beforeEach(async () => {
    await clearDatabase(ctx.adapter)
    ctx.data = await seedTestData(ctx.graph, ctx.adapter)
  })

  /**
   * Helper to get a folder's parent using a raw Cypher query.
   * Returns null if no parent, or the parent folder object.
   */
  async function getParentFolder(
    folderId: string,
  ): Promise<{ id: string; name: string; path: string } | null> {
    const results = await ctx.graph.raw<{ id: string; name: string; path: string }>(
      `MATCH (child:Folder {id: $id})-[:hasParent]->(parent:Folder)
       RETURN parent.id as id, parent.name as name, parent.path as path`,
      { id: folderId },
    )
    return results[0] ?? null
  }

  // ===========================================================================
  // SINGLE NODE CLONE
  // ===========================================================================

  describe('Single Node Clone', () => {
    it('clone creates new node with same properties', async () => {
      // Get the original user
      const original = await ctx.graph.nodeByIdWithLabel('user', ctx.data.users.alice).execute()

      // Clone the user
      const cloned = await ctx.graph.mutate.clone('user', ctx.data.users.alice)

      // Cloned node should have different ID
      expect(cloned.id).not.toBe(ctx.data.users.alice)

      // Cloned node should have same properties (except id)
      expect(cloned.data.name).toBe(original.name)
      expect(cloned.data.email).toBe(original.email)
      expect(cloned.data.status).toBe(original.status)

      // Verify the clone exists in the database
      const fetched = await ctx.graph.nodeByIdWithLabel('user', cloned.id).execute()
      expect(fetched).toMatchObject({ name: 'Alice' })
    })

    it('clone with property overrides', async () => {
      const cloned = await ctx.graph.mutate.clone('user', ctx.data.users.alice, {
        name: 'Alice Clone',
        email: 'alice.clone@example.com',
      })

      // Overridden properties
      expect(cloned.data.name).toBe('Alice Clone')
      expect(cloned.data.email).toBe('alice.clone@example.com')

      // Original status should be preserved
      expect(cloned.data.status).toBe('active')

      // Verify in database
      const fetched = await ctx.graph.nodeByIdWithLabel('user', cloned.id).execute()
      expect(fetched).toMatchObject({
        name: 'Alice Clone',
        email: 'alice.clone@example.com',
      })
    })

    it('clone does not copy outgoing edges', async () => {
      // Alice has authored posts - verify first
      const originalPosts = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .to('authored')
        .execute()
      expect(originalPosts.length).toBeGreaterThan(0)

      // Clone Alice
      const cloned = await ctx.graph.mutate.clone('user', ctx.data.users.alice)

      // Verify cloned user has no outgoing authored edges
      const clonedPosts = await ctx.graph
        .nodeByIdWithLabel('user', cloned.id)
        .to('authored')
        .execute()

      expect(clonedPosts).toHaveLength(0)
    })

    it('clone does not copy incoming edges', async () => {
      // Alice has incoming follows edges (Bob and Charlie follow her)
      const originalFollowers = await ctx.graph
        .nodeByIdWithLabel('user', ctx.data.users.alice)
        .from('follows')
        .execute()
      expect(originalFollowers.length).toBeGreaterThan(0)

      // Clone Alice
      const cloned = await ctx.graph.mutate.clone('user', ctx.data.users.alice)

      // Verify cloned user has no incoming follows edges
      const clonedFollowers = await ctx.graph
        .nodeByIdWithLabel('user', cloned.id)
        .from('follows')
        .execute()

      expect(clonedFollowers).toHaveLength(0)
    })

    it('clone preserves all properties including optional ones', async () => {
      // Create a user with optional age field
      const original = await ctx.graph.mutate.create('user', {
        email: 'withage@example.com',
        name: 'User With Age',
        status: 'active',
        age: 30,
      })

      const cloned = await ctx.graph.mutate.clone('user', original.id)

      expect(cloned.data.age).toBe(30)
      expect(cloned.data.name).toBe('User With Age')
    })
  })

  // ===========================================================================
  // CLONE WITH HIERARCHY
  // ===========================================================================

  describe('Clone with Hierarchy', () => {
    it('clone with preserveParent keeps same parent relationship', async () => {
      // folder-docs has parent folder-root
      const cloned = await ctx.graph.mutate.clone(
        'folder',
        ctx.data.folders.docs,
        { name: 'Documents Copy' },
        { preserveParent: true, edge: 'hasParent' },
      )

      expect(cloned.data.name).toBe('Documents Copy')

      // Verify parent relationship is preserved
      const parent = await getParentFolder(cloned.id)
      expect(parent).not.toBeNull()
      expect(parent!.id).toBe(ctx.data.folders.root)
    })

    it('clone with new parentId creates edge to specified parent', async () => {
      // Clone docs folder but put it under work instead of root
      const cloned = await ctx.graph.mutate.clone(
        'folder',
        ctx.data.folders.docs,
        { name: 'Docs Under Work' },
        { parentId: ctx.data.folders.work, edge: 'hasParent' },
      )

      expect(cloned.data.name).toBe('Docs Under Work')

      // Verify parent is now work folder
      const parent = await getParentFolder(cloned.id)
      expect(parent).not.toBeNull()
      expect(parent!.id).toBe(ctx.data.folders.work)
    })

    it('clone without hierarchy options creates orphan node', async () => {
      // Clone docs folder without preserveParent or parentId
      const cloned = await ctx.graph.mutate.clone('folder', ctx.data.folders.docs, {
        name: 'Orphan Docs',
      })

      expect(cloned.data.name).toBe('Orphan Docs')

      // Verify no parent relationship
      const parent = await getParentFolder(cloned.id)
      expect(parent).toBeNull()
    })
  })

  // ===========================================================================
  // CLONE SUBTREE
  // Note: cloneSubtree uses transactions internally, which FalkorDB does not support.
  // These tests are skipped when running against FalkorDB.
  // ===========================================================================

  describe('CloneSubtree', () => {
    it.skipIf(isFalkorDB)('cloneSubtree copies node and all descendants', async () => {
      // Hierarchy: root -> docs -> work
      // Cloning docs should include work
      const result = await ctx.graph.mutate.cloneSubtree(ctx.data.folders.docs, {
        edge: 'hasParent',
      })

      expect(result.root).toBeDefined()
      expect(result.root.id).not.toBe(ctx.data.folders.docs)
      // Should clone docs and work = 2 nodes
      expect(result.clonedNodes).toBe(2)
      expect(Object.keys(result.idMapping)).toHaveLength(2)

      // Verify ID mapping
      expect(result.idMapping[ctx.data.folders.docs]).toBe(result.root.id)
      expect(result.idMapping[ctx.data.folders.work]).toBeDefined()
    })

    it.skipIf(isFalkorDB)('cloneSubtree preserves internal hierarchy structure', async () => {
      // Clone docs subtree (docs -> work)
      const result = await ctx.graph.mutate.cloneSubtree(ctx.data.folders.docs, {
        edge: 'hasParent',
      })

      // Get the cloned work folder ID
      const clonedWorkId = result.idMapping[ctx.data.folders.work]
      expect(clonedWorkId).toBeDefined()

      // Verify the cloned work folder has the cloned docs folder as parent
      const parent = await getParentFolder(clonedWorkId!)
      expect(parent).not.toBeNull()
      expect(parent!.id).toBe(result.root.id)
    })

    it.skipIf(isFalkorDB)('cloneSubtree with maxDepth limits clone depth', async () => {
      // Clone root with maxDepth=1 (only root and its direct children)
      // Hierarchy: root (depth 0) -> docs (depth 1) -> work (depth 2)
      const result = await ctx.graph.mutate.cloneSubtree(ctx.data.folders.root, {
        edge: 'hasParent',
        maxDepth: 1,
      })

      // Should clone root and docs, but NOT work
      expect(result.clonedNodes).toBe(2)
      expect(result.idMapping[ctx.data.folders.root]).toBeDefined()
      expect(result.idMapping[ctx.data.folders.docs]).toBeDefined()
      expect(result.idMapping[ctx.data.folders.work]).toBeUndefined()
    })

    it.skipIf(isFalkorDB)('cloneSubtree with maxDepth=0 clones only the root', async () => {
      const result = await ctx.graph.mutate.cloneSubtree(ctx.data.folders.docs, {
        edge: 'hasParent',
        maxDepth: 0,
      })

      // Should clone only docs
      expect(result.clonedNodes).toBe(1)
      expect(result.idMapping[ctx.data.folders.docs]).toBeDefined()
      expect(result.idMapping[ctx.data.folders.work]).toBeUndefined()
    })

    it.skipIf(isFalkorDB)('cloneSubtree with transform function modifies cloned data', async () => {
      const result = await ctx.graph.mutate.cloneSubtree(ctx.data.folders.docs, {
        edge: 'hasParent',
        transform: (node) => ({
          name: `Copy of ${node.name}`,
        }),
      })

      // Verify root was transformed
      expect(result.root.data.name).toBe('Copy of Documents')

      // Verify descendant was also transformed
      const clonedWorkId = result.idMapping[ctx.data.folders.work]
      const clonedWork = await ctx.graph.nodeByIdWithLabel('folder', clonedWorkId!).execute()
      expect(clonedWork.name).toBe('Copy of Work')
    })

    it.skipIf(isFalkorDB)('cloneSubtree with transform receives depth parameter', async () => {
      const depthsReceived: number[] = []

      await ctx.graph.mutate.cloneSubtree(ctx.data.folders.docs, {
        edge: 'hasParent',
        transform: (_node, depth) => {
          depthsReceived.push(depth)
          return {}
        },
      })

      // docs is at depth 0, work is at depth 1
      expect(depthsReceived).toContain(0)
      expect(depthsReceived).toContain(1)
    })

    it.skipIf(isFalkorDB)(
      'cloneSubtree with parentId attaches cloned root to specified parent',
      async () => {
        // Create a new folder to be the parent of the cloned subtree
        const newParent = await ctx.graph.mutate.create('folder', {
          name: 'New Parent',
          path: '/new-parent',
        })

        const result = await ctx.graph.mutate.cloneSubtree(ctx.data.folders.docs, {
          edge: 'hasParent',
          parentId: newParent.id,
        })

        // Verify cloned root has the new parent
        const parent = await getParentFolder(result.root.id)
        expect(parent).not.toBeNull()
        expect(parent!.id).toBe(newParent.id)
      },
    )

    it.skipIf(isFalkorDB)('cloneSubtree without parentId creates orphan subtree', async () => {
      const result = await ctx.graph.mutate.cloneSubtree(ctx.data.folders.docs, {
        edge: 'hasParent',
      })

      // Verify cloned root has no parent
      const parent = await getParentFolder(result.root.id)
      expect(parent).toBeNull()
    })

    it.skipIf(isFalkorDB)('cloneSubtree returns correct idMapping for all cloned nodes', async () => {
      const result = await ctx.graph.mutate.cloneSubtree(ctx.data.folders.root, {
        edge: 'hasParent',
      })

      // Should map all 3 folders: root, docs, work
      expect(Object.keys(result.idMapping)).toHaveLength(3)

      // All original IDs should be present as keys
      expect(result.idMapping[ctx.data.folders.root]).toBeDefined()
      expect(result.idMapping[ctx.data.folders.docs]).toBeDefined()
      expect(result.idMapping[ctx.data.folders.work]).toBeDefined()

      // All new IDs should be different from originals
      expect(result.idMapping[ctx.data.folders.root]).not.toBe(ctx.data.folders.root)
      expect(result.idMapping[ctx.data.folders.docs]).not.toBe(ctx.data.folders.docs)
      expect(result.idMapping[ctx.data.folders.work]).not.toBe(ctx.data.folders.work)

      // All new IDs should be unique
      const newIds = Object.values(result.idMapping)
      expect(new Set(newIds).size).toBe(newIds.length)
    })

    it.skipIf(isFalkorDB)('cloneSubtree does not affect original nodes', async () => {
      // Get original data
      const originalDocs = await ctx.graph
        .nodeByIdWithLabel('folder', ctx.data.folders.docs)
        .execute()

      // Clone with transform
      await ctx.graph.mutate.cloneSubtree(ctx.data.folders.docs, {
        edge: 'hasParent',
        transform: () => ({
          name: 'Transformed Name',
        }),
      })

      // Verify original is unchanged
      const docsAfter = await ctx.graph
        .nodeByIdWithLabel('folder', ctx.data.folders.docs)
        .execute()

      expect(docsAfter.name).toBe(originalDocs.name)
    })

    it.skipIf(isFalkorDB)('cloneSubtree handles single node subtree (leaf node)', async () => {
      // work folder is a leaf node (no children with hasParent pointing to it)
      const result = await ctx.graph.mutate.cloneSubtree(ctx.data.folders.work, {
        edge: 'hasParent',
      })

      expect(result.clonedNodes).toBe(1)
      expect(result.root.data.name).toBe('Work')
      expect(Object.keys(result.idMapping)).toHaveLength(1)
    })
  })

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================

  describe('Error Handling', () => {
    it('clone throws error when source node does not exist', async () => {
      await expect(ctx.graph.mutate.clone('user', 'nonexistent-id')).rejects.toThrow()
    })

    it.skipIf(isFalkorDB)('cloneSubtree throws error when source root does not exist', async () => {
      await expect(
        ctx.graph.mutate.cloneSubtree('nonexistent-id', { edge: 'hasParent' }),
      ).rejects.toThrow()
    })
  })
})
