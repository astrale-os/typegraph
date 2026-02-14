/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
/**
 * Advanced Kernel-like Scenarios Tests
 *
 * Tests that mirror real-world usage patterns from the Astrale kernel:
 * - Module hierarchies with parent-child relationships
 * - Type assignments (ofType edges)
 * - Application definitions and instances (definedBy edges)
 * - Symlinks between modules
 * - Permission edges
 * - Complex traversals and queries
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { defineSchema, node, edge } from '@astrale/typegraph'
import { z } from 'zod'
import { createInMemoryGraph, type InMemoryGraph } from '../src'

// =============================================================================
// KERNEL-LIKE SCHEMA (simplified version of the actual kernel schema)
// =============================================================================

const kernelSchema = defineSchema({
  nodes: {
    root: node({
      properties: {},
      description: 'Root node - top of the hierarchy',
    }),
    space: node({
      properties: {
        name: z.string(),
        slug: z.string(),
      },
      indexes: ['slug'],
      description: 'Space - isolated tenant environment',
    }),
    avatar: node({
      properties: {
        email: z.string(),
        displayName: z.string().optional(),
      },
      indexes: ['email'],
      description: 'Avatar - identity within a space',
    }),
    module: node({
      properties: {
        name: z.string().optional(),
        role: z.enum(['container', 'item', 'slot']).optional(),
        contentType: z.string().optional(),
      },
      indexes: ['name'],
      description: 'Module - container for user content',
    }),
    type: node({
      properties: {
        name: z.string(),
        title: z.string(),
        icon: z.string().optional(),
      },
      indexes: ['name'],
      description: 'Type definition for modules',
    }),
    application: node({
      properties: {
        name: z.string(),
        slug: z.string(),
        version: z.string(),
        isDefinition: z.boolean().optional(),
      },
      indexes: ['slug'],
      description: 'Application definition',
    }),
  },
  edges: {
    // Hierarchy edge - module parent relationships
    hasParent: edge({
      from: 'module',
      to: 'module',
      cardinality: { outbound: 'optional', inbound: 'many' },
      description: 'Parent-child hierarchy relationship',
    }),
    // Type assignment
    ofType: edge({
      from: 'module',
      to: 'type',
      cardinality: { outbound: 'optional', inbound: 'many' },
      description: 'Module type assignment',
    }),
    // Type implementation by app
    implementedBy: edge({
      from: 'type',
      to: 'application',
      cardinality: { outbound: 'optional', inbound: 'many' },
      description: 'Type implementation by application',
    }),
    // App definition relationship
    definedBy: edge({
      from: 'application',
      to: 'application',
      cardinality: { outbound: 'optional', inbound: 'many' },
      description: 'Application definition relationship',
    }),
    // Symlinks between modules
    symlink: edge({
      from: 'module',
      to: 'module',
      cardinality: { outbound: 'many', inbound: 'many' },
      description: 'Symbolic link between modules',
    }),
    // Permission edge with properties
    hasPerm: edge({
      from: 'avatar',
      to: 'module',
      cardinality: { outbound: 'many', inbound: 'many' },
      properties: {
        effect: z.enum(['allow', 'deny']),
        read: z.boolean().optional(),
        edit: z.boolean().optional(),
      },
      description: 'Permission grant from avatar to module',
    }),
    // Avatar belongs to space
    memberOf: edge({
      from: 'avatar',
      to: 'space',
      cardinality: { outbound: 'optional', inbound: 'many' },
      description: 'Avatar membership in space',
    }),
  },
  hierarchy: {
    defaultEdge: 'hasParent',
    direction: 'up',
  },
})

type KernelSchema = typeof kernelSchema

// =============================================================================
// TESTS
// =============================================================================

describe('Kernel-like Scenarios', () => {
  let graph: InMemoryGraph<KernelSchema>

  beforeEach(() => {
    graph = createInMemoryGraph(kernelSchema)
  })

  // ---------------------------------------------------------------------------
  // MODULE HIERARCHY TESTS
  // ---------------------------------------------------------------------------

  describe('Module Hierarchies', () => {
    it('should create a deep module hierarchy', async () => {
      // Create: root > workspace > project > folder > document
      const workspace = await graph.mutate.create('module', {
        name: 'My Workspace',
        role: 'container',
      })

      const project = await graph.mutate.createChild('module', workspace.id, {
        name: 'Project Alpha',
        role: 'container',
      })

      const folder = await graph.mutate.createChild('module', project.id, {
        name: 'Documents',
        role: 'container',
      })

      const doc = await graph.mutate.createChild('module', folder.id, {
        name: 'README.md',
        role: 'item',
        contentType: 'text/markdown',
      })

      // Verify hierarchy
      expect(graph.stats().nodes).toBe(4)
      expect(graph.stats().edges).toBe(3) // 3 hasParent edges

      // Verify data
      expect(workspace.data.name).toBe('My Workspace')
      expect(project.data.name).toBe('Project Alpha')
      expect(folder.data.name).toBe('Documents')
      expect(doc.data.name).toBe('README.md')
      expect(doc.data.contentType).toBe('text/markdown')
    })

    it('should move a module to a new parent', async () => {
      // Create two folders and a document
      const folder1 = await graph.mutate.create('module', { name: 'Folder 1', role: 'container' })
      const folder2 = await graph.mutate.create('module', { name: 'Folder 2', role: 'container' })
      const doc = await graph.mutate.createChild('module', folder1.id, {
        name: 'Doc',
        role: 'item',
      })

      // Move doc from folder1 to folder2
      const moveResult = await graph.mutate.move(doc.id, folder2.id)

      expect(moveResult.moved).toBe(true)
      expect(moveResult.nodeId).toBe(doc.id)
      expect(moveResult.newParentId).toBe(folder2.id)
    })

    it('should delete a subtree', async () => {
      // Create a hierarchy
      const root = await graph.mutate.create('module', { name: 'Root', role: 'container' })
      const child1 = await graph.mutate.createChild('module', root.id, { name: 'Child 1' })
      const child2 = await graph.mutate.createChild('module', root.id, { name: 'Child 2' })
      await graph.mutate.createChild('module', child1.id, { name: 'Grandchild 1' })
      await graph.mutate.createChild('module', child1.id, { name: 'Grandchild 2' })

      expect(graph.stats().nodes).toBe(5)

      // Delete the entire subtree under child1
      const deleteResult = await graph.mutate.deleteSubtree('module', child1.id)

      expect(deleteResult.rootId).toBe(child1.id)
      // Should have deleted child1 and its 2 grandchildren
      expect(graph.stats().nodes).toBe(2) // root and child2 remain
    })
  })

  // ---------------------------------------------------------------------------
  // TYPE SYSTEM TESTS
  // ---------------------------------------------------------------------------

  describe('Type System', () => {
    it('should assign types to modules', async () => {
      // Create type definitions
      const documentType = await graph.mutate.create('type', {
        name: 'document',
        title: 'Document',
        icon: 'file-text',
      })

      const folderType = await graph.mutate.create('type', {
        name: 'folder',
        title: 'Folder',
        icon: 'folder',
      })

      // Create modules
      const folder = await graph.mutate.create('module', { name: 'My Folder', role: 'container' })
      const doc = await graph.mutate.createChild('module', folder.id, {
        name: 'Notes.md',
        role: 'item',
      })

      // Assign types via ofType edges
      await graph.mutate.link('ofType', folder.id, folderType.id)
      await graph.mutate.link('ofType', doc.id, documentType.id)

      expect(graph.stats().edges).toBe(3) // 1 hasParent + 2 ofType
    })

    it('should link types to implementing applications', async () => {
      // Create app definition
      const notesApp = await graph.mutate.create('application', {
        name: 'Notes App',
        slug: 'notes',
        version: '1.0.0',
        isDefinition: true,
      })

      // Create type that this app implements
      const documentType = await graph.mutate.create('type', {
        name: 'document',
        title: 'Document',
      })

      // Link type to app via implementedBy
      await graph.mutate.link('implementedBy', documentType.id, notesApp.id)

      expect(graph.stats().nodes).toBe(2)
      expect(graph.stats().edges).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // APPLICATION TESTS
  // ---------------------------------------------------------------------------

  describe('Applications', () => {
    it('should create app definitions and instances', async () => {
      // Create app definition
      const appDefinition = await graph.mutate.create('application', {
        name: 'Task Manager',
        slug: 'task-manager',
        version: '1.0.0',
        isDefinition: true,
      })

      // Create app instances linked to definition
      const instance1 = await graph.mutate.create('application', {
        name: 'Task Manager',
        slug: 'task-manager-space1',
        version: '1.0.0',
        isDefinition: false,
      })

      const instance2 = await graph.mutate.create('application', {
        name: 'Task Manager',
        slug: 'task-manager-space2',
        version: '1.0.0',
        isDefinition: false,
      })

      // Link instances to definition
      await graph.mutate.link('definedBy', instance1.id, appDefinition.id)
      await graph.mutate.link('definedBy', instance2.id, appDefinition.id)

      expect(graph.stats().nodes).toBe(3)
      expect(graph.stats().edges).toBe(2)
    })
  })

  // ---------------------------------------------------------------------------
  // SYMLINK TESTS
  // ---------------------------------------------------------------------------

  describe('Symlinks', () => {
    it('should create symlinks between modules', async () => {
      // Create source and target modules
      const originalDoc = await graph.mutate.create('module', {
        name: 'Original Document',
        role: 'item',
      })

      const folder = await graph.mutate.create('module', {
        name: 'Shortcuts',
        role: 'container',
      })

      const shortcut = await graph.mutate.createChild('module', folder.id, {
        name: 'Shortcut to Original',
        role: 'item',
      })

      // Create symlink from shortcut to original
      await graph.mutate.link('symlink', shortcut.id, originalDoc.id)

      expect(graph.stats().edges).toBe(2) // 1 hasParent + 1 symlink
    })

    it('should allow multiple symlinks to same target', async () => {
      const target = await graph.mutate.create('module', { name: 'Target' })
      const link1 = await graph.mutate.create('module', { name: 'Link 1' })
      const link2 = await graph.mutate.create('module', { name: 'Link 2' })
      const link3 = await graph.mutate.create('module', { name: 'Link 3' })

      await graph.mutate.link('symlink', link1.id, target.id)
      await graph.mutate.link('symlink', link2.id, target.id)
      await graph.mutate.link('symlink', link3.id, target.id)

      expect(graph.stats().edges).toBe(3)
    })
  })

  // ---------------------------------------------------------------------------
  // PERMISSION TESTS
  // ---------------------------------------------------------------------------

  describe('Permissions', () => {
    it('should create permission edges with properties', async () => {
      // Create avatar and module
      const avatar = await graph.mutate.create('avatar', {
        email: 'user@example.com',
        displayName: 'Test User',
      })

      const module = await graph.mutate.create('module', {
        name: 'Private Document',
        role: 'item',
      })

      // Grant read permission
      const permResult = await graph.mutate.link('hasPerm', avatar.id, module.id, {
        effect: 'allow',
        read: true,
        edit: false,
      })

      expect(permResult.from).toBe(avatar.id)
      expect(permResult.to).toBe(module.id)
      expect(permResult.data.effect).toBe('allow')
      expect(permResult.data.read).toBe(true)
      expect(permResult.data.edit).toBe(false)
    })

    it('should handle multiple permissions to different modules', async () => {
      const avatar = await graph.mutate.create('avatar', { email: 'admin@example.com' })
      const doc1 = await graph.mutate.create('module', { name: 'Doc 1' })
      const doc2 = await graph.mutate.create('module', { name: 'Doc 2' })
      const doc3 = await graph.mutate.create('module', { name: 'Doc 3' })

      // Grant different permissions
      await graph.mutate.link('hasPerm', avatar.id, doc1.id, {
        effect: 'allow',
        read: true,
        edit: true,
      })
      await graph.mutate.link('hasPerm', avatar.id, doc2.id, {
        effect: 'allow',
        read: true,
        edit: false,
      })
      await graph.mutate.link('hasPerm', avatar.id, doc3.id, {
        effect: 'deny',
        read: false,
        edit: false,
      })

      expect(graph.stats().edges).toBe(3)
    })
  })

  // ---------------------------------------------------------------------------
  // SPACE AND AVATAR TESTS
  // ---------------------------------------------------------------------------

  describe('Spaces and Avatars', () => {
    it('should create a space with multiple avatars', async () => {
      // Create space
      const space = await graph.mutate.create('space', {
        name: 'Acme Corp',
        slug: 'acme',
      })

      // Create avatars
      const alice = await graph.mutate.create('avatar', {
        email: 'alice@acme.com',
        displayName: 'Alice',
      })
      const bob = await graph.mutate.create('avatar', { email: 'bob@acme.com', displayName: 'Bob' })
      const charlie = await graph.mutate.create('avatar', {
        email: 'charlie@acme.com',
        displayName: 'Charlie',
      })

      // Add avatars to space
      await graph.mutate.link('memberOf', alice.id, space.id)
      await graph.mutate.link('memberOf', bob.id, space.id)
      await graph.mutate.link('memberOf', charlie.id, space.id)

      expect(graph.stats().nodes).toBe(4) // 1 space + 3 avatars
      expect(graph.stats().edges).toBe(3) // 3 memberOf edges
    })
  })

  // ---------------------------------------------------------------------------
  // QUERY TESTS
  // ---------------------------------------------------------------------------

  describe('Queries', () => {
    it('should query all modules', async () => {
      await graph.mutate.create('module', { name: 'Module 1' })
      await graph.mutate.create('module', { name: 'Module 2' })
      await graph.mutate.create('module', { name: 'Module 3' })
      await graph.mutate.create('type', { name: 'type1', title: 'Type 1' }) // different type

      const modules = await graph.node('module').execute()

      expect(modules).toHaveLength(3)
      expect(modules.map((m) => m.name).sort()).toEqual(['Module 1', 'Module 2', 'Module 3'])
    })

    it('should query node by ID', async () => {
      const created = await graph.mutate.create('application', {
        name: 'My App',
        slug: 'my-app',
        version: '2.0.0',
      })

      const app = await graph.nodeByIdWithLabel('application', created.id).execute()

      expect(app).toBeDefined()
      expect(app.name).toBe('My App')
      expect(app.slug).toBe('my-app')
      expect(app.version).toBe('2.0.0')
    })

    it('should query all types', async () => {
      await graph.mutate.create('type', { name: 'document', title: 'Document' })
      await graph.mutate.create('type', { name: 'folder', title: 'Folder' })
      await graph.mutate.create('type', { name: 'image', title: 'Image' })

      const types = await graph.node('type').execute()

      expect(types).toHaveLength(3)
      expect(types.map((t) => t.name).sort()).toEqual(['document', 'folder', 'image'])
    })
  })

  // ---------------------------------------------------------------------------
  // TRANSACTION TESTS
  // ---------------------------------------------------------------------------

  describe('Transactions', () => {
    it('should commit complex transactions', async () => {
      await graph.mutate.transaction(async (tx) => {
        // Create a full workspace structure in one transaction
        const workspace = await tx.create('module', { name: 'Workspace', role: 'container' })
        const project = await tx.create('module', { name: 'Project' })
        await tx.link('hasParent', project.id, workspace.id)

        const docType = await tx.create('type', { name: 'doc', title: 'Document' })
        const doc = await tx.create('module', { name: 'README.md', role: 'item' })
        await tx.link('hasParent', doc.id, project.id)
        await tx.link('ofType', doc.id, docType.id)
      })

      expect(graph.stats().nodes).toBe(4) // workspace, project, doc, docType
      expect(graph.stats().edges).toBe(3) // 2 hasParent + 1 ofType
    })

    it('should rollback on error', async () => {
      // Create something first
      await graph.mutate.create('module', { name: 'Existing' })
      expect(graph.stats().nodes).toBe(1)

      try {
        await graph.mutate.transaction(async (tx) => {
          await tx.create('module', { name: 'New 1' })
          await tx.create('module', { name: 'New 2' })
          throw new Error('Simulated failure')
        })
      } catch {
        // Expected
      }

      // Should still have only the original node
      expect(graph.stats().nodes).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // COMPLEX GRAPH STRUCTURE TESTS
  // ---------------------------------------------------------------------------

  describe('Complex Graph Structures', () => {
    it('should handle a realistic workspace hierarchy', async () => {
      // Simulate a real workspace structure like in Notion/Confluence
      // Root > Space > Projects > Project A > Docs > Document
      //                        > Project B > Tasks > Task 1, Task 2

      // Types
      const projectType = await graph.mutate.create('type', { name: 'project', title: 'Project' })
      const docType = await graph.mutate.create('type', { name: 'document', title: 'Document' })
      const taskType = await graph.mutate.create('type', { name: 'task', title: 'Task' })

      // Space
      const space = await graph.mutate.create('space', { name: 'Engineering', slug: 'eng' })

      // Projects container
      const projects = await graph.mutate.create('module', { name: 'Projects', role: 'container' })

      // Project A with documents
      const projectA = await graph.mutate.createChild('module', projects.id, {
        name: 'Project Alpha',
        role: 'container',
      })
      await graph.mutate.link('ofType', projectA.id, projectType.id)

      const docsFolder = await graph.mutate.createChild('module', projectA.id, {
        name: 'Documents',
        role: 'container',
      })
      const doc1 = await graph.mutate.createChild('module', docsFolder.id, {
        name: 'Architecture.md',
        role: 'item',
      })
      const doc2 = await graph.mutate.createChild('module', docsFolder.id, {
        name: 'API.md',
        role: 'item',
      })
      await graph.mutate.link('ofType', doc1.id, docType.id)
      await graph.mutate.link('ofType', doc2.id, docType.id)

      // Project B with tasks
      const projectB = await graph.mutate.createChild('module', projects.id, {
        name: 'Project Beta',
        role: 'container',
      })
      await graph.mutate.link('ofType', projectB.id, projectType.id)

      const tasksFolder = await graph.mutate.createChild('module', projectB.id, {
        name: 'Tasks',
        role: 'container',
      })
      const task1 = await graph.mutate.createChild('module', tasksFolder.id, {
        name: 'Implement feature X',
        role: 'item',
      })
      const task2 = await graph.mutate.createChild('module', tasksFolder.id, {
        name: 'Fix bug Y',
        role: 'item',
      })
      await graph.mutate.link('ofType', task1.id, taskType.id)
      await graph.mutate.link('ofType', task2.id, taskType.id)

      // Create cross-references (symlinks)
      // Task 1 references Architecture.md
      await graph.mutate.link('symlink', task1.id, doc1.id)

      // Verify structure
      // 3 types + 1 space + 9 modules (projects, projectA, docsFolder, doc1, doc2, projectB, tasksFolder, task1, task2)
      expect(graph.stats().nodes).toBe(13)
      // 8 hasParent (projectA->projects, docsFolder->projectA, doc1->docsFolder, doc2->docsFolder,
      //              projectB->projects, tasksFolder->projectB, task1->tasksFolder, task2->tasksFolder)
      // + 6 ofType (projectA, doc1, doc2, projectB, task1, task2)
      // + 1 symlink (task1->doc1)
      expect(graph.stats().edges).toBe(15)
    })

    it('should handle bidirectional symlinks', async () => {
      // Create two modules that reference each other
      const moduleA = await graph.mutate.create('module', { name: 'Module A' })
      const moduleB = await graph.mutate.create('module', { name: 'Module B' })

      // A links to B
      await graph.mutate.link('symlink', moduleA.id, moduleB.id)
      // B links to A
      await graph.mutate.link('symlink', moduleB.id, moduleA.id)

      expect(graph.stats().edges).toBe(2)
    })

    it('should handle a multi-tenant scenario', async () => {
      // Create multiple spaces with their own data
      const space1 = await graph.mutate.create('space', { name: 'Acme Corp', slug: 'acme' })
      const space2 = await graph.mutate.create('space', { name: 'Globex Inc', slug: 'globex' })

      // Avatars for each space
      const acmeUser = await graph.mutate.create('avatar', { email: 'user@acme.com' })
      const globexUser = await graph.mutate.create('avatar', { email: 'user@globex.com' })
      await graph.mutate.link('memberOf', acmeUser.id, space1.id)
      await graph.mutate.link('memberOf', globexUser.id, space2.id)

      // Each space has its own module hierarchy
      const acmeRoot = await graph.mutate.create('module', {
        name: 'Acme Files',
        role: 'container',
      })
      const globexRoot = await graph.mutate.create('module', {
        name: 'Globex Files',
        role: 'container',
      })

      // Permissions - each user can only access their space's modules
      await graph.mutate.link('hasPerm', acmeUser.id, acmeRoot.id, {
        effect: 'allow',
        read: true,
        edit: true,
      })
      await graph.mutate.link('hasPerm', globexUser.id, globexRoot.id, {
        effect: 'allow',
        read: true,
        edit: true,
      })

      expect(graph.stats().nodes).toBe(6) // 2 spaces + 2 avatars + 2 modules
      expect(graph.stats().edges).toBe(4) // 2 memberOf + 2 hasPerm
    })
  })

  // ---------------------------------------------------------------------------
  // UPDATE AND PATCH TESTS
  // ---------------------------------------------------------------------------

  describe('Updates and Patches', () => {
    it('should update node properties', async () => {
      const app = await graph.mutate.create('application', {
        name: 'My App',
        slug: 'my-app',
        version: '1.0.0',
      })

      const updated = await graph.mutate.update('application', app.id, {
        version: '2.0.0',
        name: 'My Updated App',
      })

      expect(updated.data.version).toBe('2.0.0')
      expect(updated.data.name).toBe('My Updated App')
      expect(updated.data.slug).toBe('my-app') // unchanged
    })

    it('should update edge properties', async () => {
      const avatar = await graph.mutate.create('avatar', { email: 'user@test.com' })
      const module = await graph.mutate.create('module', { name: 'Secret Doc' })

      // Initial permission
      await graph.mutate.link('hasPerm', avatar.id, module.id, {
        effect: 'allow',
        read: true,
        edit: false,
      })

      // Update permission to allow edit
      const updated = await graph.mutate.patchLink('hasPerm', avatar.id, module.id, {
        edit: true,
      })

      expect(updated.data.read).toBe(true)
      expect(updated.data.edit).toBe(true)
    })
  })

  // ---------------------------------------------------------------------------
  // EDGE REMOVAL TESTS
  // ---------------------------------------------------------------------------

  describe('Edge Removal', () => {
    it('should unlink edges', async () => {
      const avatar = await graph.mutate.create('avatar', { email: 'test@test.com' })
      const module = await graph.mutate.create('module', { name: 'Test' })

      await graph.mutate.link('hasPerm', avatar.id, module.id, { effect: 'allow', read: true })
      expect(graph.stats().edges).toBe(1)

      await graph.mutate.unlink('hasPerm', avatar.id, module.id)
      expect(graph.stats().edges).toBe(0)
    })

    it('should handle removing a type assignment', async () => {
      const type1 = await graph.mutate.create('type', { name: 'type1', title: 'Type 1' })
      const type2 = await graph.mutate.create('type', { name: 'type2', title: 'Type 2' })
      const module = await graph.mutate.create('module', { name: 'My Module' })

      // Assign type1
      await graph.mutate.link('ofType', module.id, type1.id)
      expect(graph.stats().edges).toBe(1)

      // Remove type1 and assign type2
      await graph.mutate.unlink('ofType', module.id, type1.id)
      await graph.mutate.link('ofType', module.id, type2.id)
      expect(graph.stats().edges).toBe(1)
    })
  })

  // ---------------------------------------------------------------------------
  // EXPORT/IMPORT TESTS
  // ---------------------------------------------------------------------------

  describe('Export and Import', () => {
    it('should export and import a complete graph', async () => {
      // Build a complex graph
      const space = await graph.mutate.create('space', { name: 'Test Space', slug: 'test' })
      const avatar = await graph.mutate.create('avatar', { email: 'test@test.com' })
      await graph.mutate.link('memberOf', avatar.id, space.id)

      const docType = await graph.mutate.create('type', { name: 'doc', title: 'Document' })
      const folder = await graph.mutate.create('module', { name: 'Root', role: 'container' })
      const doc = await graph.mutate.createChild('module', folder.id, {
        name: 'File.md',
        role: 'item',
      })
      await graph.mutate.link('ofType', doc.id, docType.id)
      await graph.mutate.link('hasPerm', avatar.id, doc.id, { effect: 'allow', read: true })

      const originalStats = graph.stats()
      expect(originalStats.nodes).toBe(5) // space, avatar, docType, folder, doc
      expect(originalStats.edges).toBe(4) // memberOf, hasParent, ofType, hasPerm

      // Export
      const exported = graph.export()

      // Clear and verify empty
      graph.clear()
      expect(graph.stats().nodes).toBe(0)
      expect(graph.stats().edges).toBe(0)

      // Import
      graph.import(exported)

      // Verify restoration
      expect(graph.stats().nodes).toBe(originalStats.nodes)
      expect(graph.stats().edges).toBe(originalStats.edges)

      // Verify data integrity
      const restoredSpace = await graph.nodeByIdWithLabel('space', space.id).execute()
      expect(restoredSpace.name).toBe('Test Space')

      const restoredAvatar = await graph.nodeByIdWithLabel('avatar', avatar.id).execute()
      expect(restoredAvatar.email).toBe('test@test.com')
    })
  })
})
