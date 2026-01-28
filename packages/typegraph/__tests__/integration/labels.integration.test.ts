/**
 * Integration Tests: Universal :Node Label Feature
 *
 * POC demonstrating the :Node label feature for O(1) universal lookups.
 * This serves as a reference for implementing the same pattern in the kernel.
 *
 * Key Features Tested:
 * 1. Default :Node label on all nodes created via mutations
 * 2. Custom base labels via schema config
 * 3. Additional per-node labels
 * 4. Universal lookup via :Node index
 * 5. Backwards compatibility (opt-out)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { z } from 'zod'
import { defineSchema, node, edge, resolveNodeLabels, formatLabels } from '../../src/schema'
import { CypherTemplates } from '../../src/mutation/cypher'
import {
  createTestConnection,
  createTestExecutor,
  createMutationExecutor,
  clearDatabase,
} from './setup'
import { createGraph } from '../../src/query/entry'
import { type ConnectionManager } from '../../src/executor/connection'

// =============================================================================
// TEST SCHEMAS - Demonstrating Different Label Configurations
// =============================================================================

/**
 * Schema with DEFAULT labels (all nodes get :Node automatically)
 */
const defaultLabelSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
      },
    }),
    post: node({
      properties: {
        title: z.string(),
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

/**
 * Schema with CUSTOM base labels (e.g., for multi-tenant or auditing)
 */
const customLabelSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
      },
    }),
    document: node({
      properties: {
        title: z.string(),
      },
    }),
  },
  edges: {
    owns: edge({
      from: 'user',
      to: 'document',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
  },
  labels: {
    baseLabels: ['Entity', 'Auditable'],
  },
})

/**
 * Schema with multi-label nodes (IS-A relationships via labels array)
 */
const additionalLabelSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
      },
    }),
    // Define empty node types for labels
    privileged: node({ properties: {} }),
    auditable: node({ properties: {} }),
    // Admin IS-A Privileged AND Auditable
    admin: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
        role: z.string(),
      },
      labels: ['privileged', 'auditable'],
    }),
  },
  edges: {
    manages: edge({
      from: 'admin',
      to: 'user',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
  },
})

/**
 * Schema with labels DISABLED (backwards compatibility)
 */
const noLabelSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
      },
    }),
  },
  edges: {},
  labels: {
    includeBaseLabels: false,
  },
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Universal :Node Label Integration Tests', () => {
  let connection: ConnectionManager

  beforeAll(async () => {
    connection = createTestConnection()
    await connection.connect()
    createTestExecutor(connection) // Needed for setup but not used in tests
  }, 30000)

  afterAll(async () => {
    await connection.close()
  })

  beforeEach(async () => {
    await clearDatabase(connection)
  })

  // ===========================================================================
  // FEATURE 1: Default :Node Label
  // ===========================================================================

  describe('Default :Node Label', () => {
    it('creates nodes with :Node:User labels via mutation API', async () => {
      const mutationExecutor = createMutationExecutor(connection)
      const graph = createGraph(defaultLabelSchema, {
        uri: 'bolt://localhost:7687',
        mutationExecutor,
      })

      // Create a user via the mutation API
      const user = await graph.mutate.create('user', {
        email: 'alice@example.com',
        name: 'Alice',
      })

      // Query the database to verify labels
      const { records } = await connection.run<{ labels: string[] }>(
        'MATCH (n {id: $id}) RETURN labels(n) as labels',
        { id: user.id },
      )

      expect(records[0]?.labels).toContain('Node')
      expect(records[0]?.labels).toContain('User')
    })

    it('enables universal lookup via :Node label', async () => {
      const mutationExecutor = createMutationExecutor(connection)
      const graph = createGraph(defaultLabelSchema, {
        uri: 'bolt://localhost:7687',
        mutationExecutor,
      })

      // Create nodes of different types
      const user = await graph.mutate.create('user', {
        email: 'bob@example.com',
        name: 'Bob',
      })
      const post = await graph.mutate.create('post', {
        title: 'Hello World',
      })

      // Universal lookup: find ANY node by ID using just :Node
      const { records: userLookup } = await connection.run<{ id: string }>(
        'MATCH (n:Node {id: $id}) RETURN n.id as id',
        { id: user.id },
      )
      const { records: postLookup } = await connection.run<{ id: string }>(
        'MATCH (n:Node {id: $id}) RETURN n.id as id',
        { id: post.id },
      )

      expect(userLookup[0]?.id).toBe(user.id)
      expect(postLookup[0]?.id).toBe(post.id)
    })

    it('works with batch createMany', async () => {
      const mutationExecutor = createMutationExecutor(connection)
      const graph = createGraph(defaultLabelSchema, {
        uri: 'bolt://localhost:7687',
        mutationExecutor,
      })

      await graph.mutate.createMany('user', [
        { email: 'user1@example.com', name: 'User 1' },
        { email: 'user2@example.com', name: 'User 2' },
      ])

      // Verify all batch-created nodes have :Node label
      const { records } = await connection.run<{ count: { toNumber(): number } }>(
        'MATCH (n:Node:User) RETURN count(n) as count',
        {},
      )

      expect(records[0]?.count.toNumber()).toBe(2)
    })
  })

  // ===========================================================================
  // FEATURE 2: Custom Base Labels
  // ===========================================================================

  describe('Custom Base Labels', () => {
    it('creates nodes with custom base labels instead of :Node', async () => {
      const mutationExecutor = createMutationExecutor(connection)
      const graph = createGraph(customLabelSchema, {
        uri: 'bolt://localhost:7687',
        mutationExecutor,
      })

      const user = await graph.mutate.create('user', {
        email: 'charlie@example.com',
        name: 'Charlie',
      })

      const { records } = await connection.run<{ labels: string[] }>(
        'MATCH (n {id: $id}) RETURN labels(n) as labels',
        { id: user.id },
      )

      // Should have custom base labels, NOT :Node
      expect(records[0]?.labels).toContain('Entity')
      expect(records[0]?.labels).toContain('Auditable')
      expect(records[0]?.labels).toContain('User')
      expect(records[0]?.labels).not.toContain('Node')
    })

    it('enables lookup via custom base label', async () => {
      const mutationExecutor = createMutationExecutor(connection)
      const graph = createGraph(customLabelSchema, {
        uri: 'bolt://localhost:7687',
        mutationExecutor,
      })

      await graph.mutate.create('user', {
        email: 'dave@example.com',
        name: 'Dave',
      })
      await graph.mutate.create('document', {
        title: 'Important Doc',
      })

      // Universal lookup via :Entity (custom base label)
      const { records } = await connection.run<{ count: { toNumber(): number } }>(
        'MATCH (n:Entity) RETURN count(n) as count',
        {},
      )

      expect(records[0]?.count.toNumber()).toBe(2)
    })
  })

  // ===========================================================================
  // FEATURE 3: Multi-Label Nodes (IS-A Relationships)
  // ===========================================================================

  describe('Multi-Label Nodes (IS-A Relationships)', () => {
    it('creates nodes with labels from IS-A relationships', async () => {
      const mutationExecutor = createMutationExecutor(connection)
      const graph = createGraph(additionalLabelSchema, {
        uri: 'bolt://localhost:7687',
        mutationExecutor,
      })

      // Regular user - just :Node:User
      const user = await graph.mutate.create('user', {
        email: 'regular@example.com',
        name: 'Regular User',
      })

      // Admin - :Node:Admin:Privileged:Auditable
      const admin = await graph.mutate.create('admin', {
        email: 'admin@example.com',
        name: 'Admin User',
        role: 'superadmin',
      })

      const { records: userLabels } = await connection.run<{ labels: string[] }>(
        'MATCH (n {id: $id}) RETURN labels(n) as labels',
        { id: user.id },
      )
      const { records: adminLabels } = await connection.run<{ labels: string[] }>(
        'MATCH (n {id: $id}) RETURN labels(n) as labels',
        { id: admin.id },
      )

      // Regular user
      expect(userLabels[0]?.labels).toContain('Node')
      expect(userLabels[0]?.labels).toContain('User')
      expect(userLabels[0]?.labels).not.toContain('Privileged')

      // Admin has additional labels
      expect(adminLabels[0]?.labels).toContain('Node')
      expect(adminLabels[0]?.labels).toContain('Admin')
      expect(adminLabels[0]?.labels).toContain('Privileged')
      expect(adminLabels[0]?.labels).toContain('Auditable')
    })

    it('can query by additional labels', async () => {
      const mutationExecutor = createMutationExecutor(connection)
      const graph = createGraph(additionalLabelSchema, {
        uri: 'bolt://localhost:7687',
        mutationExecutor,
      })

      await graph.mutate.create('user', { email: 'u1@test.com', name: 'U1' })
      await graph.mutate.create('user', { email: 'u2@test.com', name: 'U2' })
      await graph.mutate.create('admin', { email: 'a1@test.com', name: 'A1', role: 'admin' })

      // Query all privileged nodes
      const { records } = await connection.run<{ count: { toNumber(): number } }>(
        'MATCH (n:Privileged) RETURN count(n) as count',
        {},
      )

      expect(records[0]?.count.toNumber()).toBe(1) // Only the admin
    })
  })

  // ===========================================================================
  // FEATURE 4: Backwards Compatibility (Opt-Out)
  // ===========================================================================

  describe('Backwards Compatibility (Opt-Out)', () => {
    it('creates nodes without base labels when includeBaseLabels is false', async () => {
      const mutationExecutor = createMutationExecutor(connection)
      const graph = createGraph(noLabelSchema, {
        uri: 'bolt://localhost:7687',
        mutationExecutor,
      })

      const user = await graph.mutate.create('user', {
        email: 'legacy@example.com',
        name: 'Legacy User',
      })

      const { records } = await connection.run<{ labels: string[] }>(
        'MATCH (n {id: $id}) RETURN labels(n) as labels',
        { id: user.id },
      )

      // Should ONLY have :User, NOT :Node
      expect(records[0]?.labels).toContain('User')
      expect(records[0]?.labels).not.toContain('Node')
      expect(records[0]?.labels).toHaveLength(1)
    })
  })

  // ===========================================================================
  // UTILITY TESTS
  // ===========================================================================

  describe('Label Utilities', () => {
    it('resolveNodeLabels returns correct labels for default schema', () => {
      const labels = resolveNodeLabels(defaultLabelSchema, 'user')
      expect(labels).toEqual(['Node', 'User'])
    })

    it('resolveNodeLabels returns correct labels for custom schema', () => {
      const labels = resolveNodeLabels(customLabelSchema, 'user')
      expect(labels).toEqual(['Entity', 'Auditable', 'User'])
    })

    it('resolveNodeLabels includes additional labels', () => {
      const labels = resolveNodeLabels(additionalLabelSchema, 'admin')
      expect(labels).toEqual(['Node', 'Admin', 'Privileged', 'Auditable'])
    })

    it('formatLabels creates correct Cypher syntax', () => {
      expect(formatLabels(['Node', 'User'])).toBe(':Node:User')
      expect(formatLabels(['Entity', 'Auditable', 'User'])).toBe(':Entity:Auditable:User')
    })
  })

  // ===========================================================================
  // CYPHER TEMPLATE VERIFICATION
  // ===========================================================================

  describe('Cypher Template Output', () => {
    it('generates CREATE with multi-labels', () => {
      const query = CypherTemplates.node.create(['Node', 'User'])
      expect(query).toContain('CREATE (n:Node:User)')
    })

    it('generates MATCH with multi-labels', () => {
      const query = CypherTemplates.node.update(['Node', 'User'])
      expect(query).toContain('MATCH (n:Node:User {id: $id})')
    })

    it('generates MERGE with multi-labels for upsert', () => {
      const query = CypherTemplates.node.upsert(['Node', 'User'])
      expect(query).toContain('MERGE (n:Node:User {id: $id})')
    })
  })
})

// =============================================================================
// KERNEL IMPLEMENTATION REFERENCE
// =============================================================================

/**
 * KERNEL IMPLEMENTATION NOTES:
 *
 * 1. SCHEMA CONFIGURATION:
 *    - Add `labels?: LabelConfig` to schema definition
 *    - Default: { baseLabels: ['Node'], includeBaseLabels: true }
 *
 * 2. NODE DEFINITION:
 *    - Add `additionalLabels?: string[]` to node config
 *    - Combined with base labels when creating nodes
 *
 * 3. LABEL RESOLUTION:
 *    - Order: baseLabels + PascalCase(nodeLabel) + additionalLabels
 *    - Example: user with additionalLabels: ['Privileged']
 *      → ['Node', 'User', 'Privileged']
 *
 * 4. CYPHER GENERATION:
 *    - CREATE (n:Node:User) instead of CREATE (n:user)
 *    - MATCH (n:Node:User {id: $id}) instead of MATCH (n:user {id: $id})
 *
 * 5. INDEX STRATEGY:
 *    - CREATE INDEX FOR (n:Node) ON (n.id) -- Universal O(1) lookup
 *    - Individual indexes still work: CREATE INDEX FOR (n:User) ON (n.email)
 *
 * 6. UNIVERSAL LOOKUP:
 *    - MATCH (n:Node {id: $id}) RETURN n -- Works for ANY node type!
 *    - No need to know node type for ID lookups
 */
