/**
 * Schema Tests - High Signal Only
 *
 * ~20 focused tests covering:
 * - Edge case validation (cycles, missing refs)
 * - Invariants (label resolution, deduplication)
 * - Real-world integration scenarios
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  node,
  edge,
  defineSchema,
  resolveNodeLabels,
  getNodesSatisfying,
  compileSchemaIndexes,
  generateIndexMigration,
  SchemaValidationError,
} from '../src'

// =============================================================================
// SCHEMA VALIDATION: Edge references and label inheritance
// =============================================================================

describe('Schema Validation', () => {
  it('rejects edges with non-existent node endpoints', () => {
    // Source node missing
    expect(() =>
      defineSchema({
        nodes: { post: node({ properties: {} }) },
        edges: {
          authored: edge({
            from: 'user', // doesn't exist
            to: 'post',
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      }),
    ).toThrow(/unknown source node 'user'/)

    // Target node missing
    expect(() =>
      defineSchema({
        nodes: { user: node({ properties: {} }) },
        edges: {
          authored: edge({
            from: 'user',
            to: 'post', // doesn't exist
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      }),
    ).toThrow(/unknown target node 'post'/)

    // Polymorphic edge with invalid source
    expect(() =>
      defineSchema({
        nodes: { user: node({ properties: {} }), post: node({ properties: {} }) },
        edges: {
          likes: edge({
            from: ['user', 'admin'] as const, // admin doesn't exist
            to: 'post',
            cardinality: { outbound: 'many', inbound: 'many' },
          }),
        },
      }),
    ).toThrow(/unknown source node 'admin'/)
  })

  it('rejects node referencing non-existent label', () => {
    expect(() =>
      defineSchema({
        nodes: {
          admin: node({ properties: {}, labels: ['user'] }), // user doesn't exist
        },
        edges: {},
      }),
    ).toThrow(/references unknown label 'user'/)
  })

  it('detects circular label inheritance at all depths', () => {
    // Direct: A -> A
    expect(() =>
      defineSchema({
        nodes: { entity: node({ properties: {}, labels: ['entity'] }) },
        edges: {},
      }),
    ).toThrow(/Circular label inheritance/)

    // Indirect: A -> B -> A
    expect(() =>
      defineSchema({
        nodes: {
          user: node({ properties: {}, labels: ['admin'] }),
          admin: node({ properties: {}, labels: ['user'] }),
        },
        edges: {},
      }),
    ).toThrow(/Circular label inheritance/)

    // Deep: A -> B -> C -> A
    expect(() =>
      defineSchema({
        nodes: {
          a: node({ properties: {}, labels: ['b'] }),
          b: node({ properties: {}, labels: ['c'] }),
          c: node({ properties: {}, labels: ['a'] }),
        },
        edges: {},
      }),
    ).toThrow(/Circular label inheritance/)
  })

  it('allows valid deep inheritance chains (not circular)', () => {
    const schema = defineSchema({
      nodes: {
        entity: node({ properties: {} }),
        user: node({ properties: {}, labels: ['entity'] }),
        admin: node({ properties: {}, labels: ['user'] }),
        superAdmin: node({ properties: {}, labels: ['admin'] }),
      },
      edges: {},
    })
    expect(schema.nodes.superAdmin.labels).toEqual(['admin'])
  })

  it('rejects hierarchy referencing non-existent edge', () => {
    expect(() =>
      defineSchema({
        nodes: { folder: node({ properties: {} }) },
        edges: {},
        // @ts-expect-error - intentionally referencing non-existent edge for runtime validation test
        hierarchy: { defaultEdge: 'hasParent', direction: 'up' },
      }),
    ).toThrow(/Hierarchy defaultEdge 'hasParent' does not exist/)
  })

  it('throws SchemaValidationError with proper fields for edge reference errors', () => {
    try {
      defineSchema({
        nodes: { post: node({ properties: {} }) },
        edges: {
          authored: edge({
            from: 'user', // doesn't exist
            to: 'post',
            cardinality: { outbound: 'many', inbound: 'one' },
          }),
        },
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      const schemaError = error as SchemaValidationError
      expect(schemaError.field).toBe('from')
      expect(schemaError.received).toBe('user')
      expect(schemaError.expected).toContain('post')
      expect(schemaError.message).toContain('Available nodes:')
    }
  })

  it('throws SchemaValidationError with proper fields for hierarchy errors', () => {
    try {
      defineSchema({
        nodes: { folder: node({ properties: {} }) },
        edges: {
          contains: edge({
            from: 'folder',
            to: 'folder',
            cardinality: { outbound: 'many', inbound: 'optional' },
          }),
        },
        // @ts-expect-error - intentionally referencing non-existent edge
        hierarchy: { defaultEdge: 'hasParent', direction: 'up' },
      })
      expect.fail('Should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaValidationError)
      const schemaError = error as SchemaValidationError
      expect(schemaError.field).toBe('hierarchy.defaultEdge')
      expect(schemaError.received).toBe('hasParent')
      expect(schemaError.expected).toContain('contains')
      expect(schemaError.message).toContain('Available edges:')
    }
  })
})

// =============================================================================
// INDEX VALIDATION: Property references and constraints
// =============================================================================

describe('Index Validation', () => {
  it('rejects indexes referencing non-existent properties', () => {
    // Simple string index
    expect(() =>
      node({
        properties: { email: z.string() },
        indexes: ['name' as keyof { email: z.ZodString }],
      }),
    ).toThrow(/Index property 'name' not found/)

    // Single property config
    expect(() =>
      node({
        properties: { email: z.string() },
        indexes: [{ property: 'name' as 'email', type: 'unique' }],
      }),
    ).toThrow(/Index property 'name' not found/)

    // Composite index
    expect(() =>
      node({
        properties: { firstName: z.string(), lastName: z.string() },
        indexes: [{ properties: ['firstName', 'middleName'] as readonly ('firstName' | 'lastName')[], type: 'btree' }],
      }),
    ).toThrow(/Composite index property 'middleName' not found/)
  })

  it('rejects invalid composite index configurations', () => {
    // Fulltext on composite
    expect(() =>
      node({
        properties: { firstName: z.string(), lastName: z.string() },
        indexes: [{ properties: ['firstName', 'lastName'] as const, type: 'fulltext' as 'btree' }],
      }),
    ).toThrow(/Fulltext indexes cannot be composite/)

    // Less than 2 properties
    expect(() =>
      node({
        properties: { email: z.string() },
        indexes: [{ properties: ['email'] as const, type: 'btree' }],
      }),
    ).toThrow(/Composite indexes require at least 2 properties/)

    // Order property not in index
    expect(() =>
      node({
        properties: { a: z.string(), b: z.string(), c: z.string() },
        indexes: [{ properties: ['a', 'b'] as const, type: 'btree', order: { c: 'DESC' } }],
      }),
    ).toThrow(/Order property 'c' not in composite index properties/)
  })
})

// =============================================================================
// LABEL RESOLUTION: Inheritance and deduplication
// =============================================================================

describe('Label Resolution', () => {
  const complexSchema = defineSchema({
    nodes: {
      entity: node({ properties: {} }),
      actor: node({ properties: {}, labels: ['entity'] }),
      user: node({ properties: {} , labels: ['actor'] }),
      machine: node({ properties: {}, labels: ['actor'] }),
      admin: node({ properties: {}, labels: ['user'] }),
      superAdmin: node({ properties: {}, labels: ['admin'] }),
      // Diamond: serviceAccount extends both user and machine
      serviceAccount: node({ properties: {}, labels: ['user', 'machine'] }),
    },
    edges: {},
  })

  it('resolves full inheritance chain in depth-first order', () => {
    expect(resolveNodeLabels(complexSchema, 'entity')).toEqual(['Entity'])
    expect(resolveNodeLabels(complexSchema, 'user')).toEqual(['User', 'Actor', 'Entity'])
    expect(resolveNodeLabels(complexSchema, 'superAdmin')).toEqual(['SuperAdmin', 'Admin', 'User', 'Actor', 'Entity'])
  })

  it('deduplicates labels in diamond inheritance correctly', () => {
    const labels = resolveNodeLabels(complexSchema, 'serviceAccount')

    // Should include all labels but Entity only once
    expect(labels).toContain('ServiceAccount')
    expect(labels).toContain('User')
    expect(labels).toContain('Machine')
    expect(labels).toContain('Actor')
    expect(labels).toContain('Entity')
    expect(labels.filter((l) => l === 'Entity')).toHaveLength(1)

    // Verify depth-first ordering: User path explored before Machine
    const userIdx = labels.indexOf('User')
    const machineIdx = labels.indexOf('Machine')
    expect(userIdx).toBeLessThan(machineIdx)
  })

  it('returns fresh array copies to prevent mutation bugs', () => {
    const labels1 = resolveNodeLabels(complexSchema, 'admin')
    const labels2 = resolveNodeLabels(complexSchema, 'admin')

    // Different array instances (defensive copying)
    expect(labels1).not.toBe(labels2)

    // Mutating one shouldn't affect future calls
    const expected = ['Admin', 'User', 'Actor', 'Entity']
    expect(labels1).toEqual(expected)
    labels1.push('Hacked')
    expect(resolveNodeLabels(complexSchema, 'admin')).toEqual(expected)
  })

  it('getNodesSatisfying returns all nodes in inheritance chain', () => {
    const entities = getNodesSatisfying(complexSchema, 'entity')
    expect(entities).toContain('entity')
    expect(entities).toContain('actor')
    expect(entities).toContain('user')
    expect(entities).toContain('machine')
    expect(entities).toContain('admin')
    expect(entities).toContain('superAdmin')
    expect(entities).toContain('serviceAccount')
    expect(entities).toHaveLength(7)

    // Middle-of-chain target
    const users = getNodesSatisfying(complexSchema, 'user')
    expect(users).toContain('user')
    expect(users).toContain('admin')
    expect(users).toContain('superAdmin')
    expect(users).toContain('serviceAccount')
    expect(users).not.toContain('entity')
    expect(users).not.toContain('machine')
  })
})

// =============================================================================
// INDEX COMPILATION: Cypher generation
// =============================================================================

describe('Index Compilation', () => {
  const indexSchema = defineSchema({
    nodes: {
      user: node({
        properties: {
          email: z.string(),
          firstName: z.string(),
          lastName: z.string(),
          bio: z.string(),
          tenantId: z.string(),
        },
        indexes: [
          'email',
          { property: 'bio', type: 'fulltext', name: 'user_bio_search' },
          { property: 'tenantId', type: 'unique' },
          { properties: ['firstName', 'lastName'], type: 'btree' },
          { properties: ['tenantId', 'email'], type: 'unique' },
        ],
      }),
    },
    edges: {
      follows: edge({
        from: 'user',
        to: 'user',
        cardinality: { outbound: 'many', inbound: 'many' },
        properties: { since: z.date() },
        indexes: ['since'],
      }),
    },
  })

  it('generates correct Cypher for all index types', () => {
    const indexes = compileSchemaIndexes(indexSchema, { includeBaseIndexes: false })

    // Simple btree
    const emailIdx = indexes.find((i) => i.name === 'idx_user_email')
    expect(emailIdx?.cypher).toBe('CREATE INDEX FOR (n:User) ON (n.email)')

    // Fulltext with custom name
    const bioIdx = indexes.find((i) => i.name === 'user_bio_search')
    expect(bioIdx?.cypher).toBe('CREATE FULLTEXT INDEX user_bio_search FOR (n:User) ON EACH [n.bio]')

    // Unique constraint
    const tenantIdx = indexes.find((i) => i.name === 'idx_user_tenantId' && i.properties.length === 1)
    expect(tenantIdx?.cypher).toBe('CREATE CONSTRAINT FOR (n:User) REQUIRE n.tenantId IS UNIQUE')

    // Composite btree
    const nameIdx = indexes.find((i) => i.name === 'idx_user_firstName_lastName')
    expect(nameIdx?.cypher).toBe('CREATE INDEX FOR (n:User) ON (n.firstName, n.lastName)')

    // Composite unique (NODE KEY)
    const compositeUnique = indexes.find((i) => i.name === 'idx_user_tenantId_email')
    expect(compositeUnique?.cypher).toBe('CREATE CONSTRAINT FOR (n:User) REQUIRE (n.tenantId, n.email) IS NODE KEY')

    // Relationship index
    const sinceIdx = indexes.find((i) => i.name === 'idx_rel_follows_since')
    expect(sinceIdx?.cypher).toBe('CREATE INDEX FOR ()-[r:FOLLOWS]-() ON (r.since)')
  })

  it('generates migration with matching up/down statements', () => {
    const indexes = compileSchemaIndexes(indexSchema, { includeBaseIndexes: false })
    const migration = generateIndexMigration(indexes)

    expect(migration.up.length).toBe(indexes.length)
    expect(migration.down.length).toBe(indexes.length)

    // Verify DROP uses correct type for each index
    indexes.forEach((idx, i) => {
      if (idx.type === 'unique') {
        expect(migration.down[i]).toMatch(/^DROP CONSTRAINT/)
      } else {
        expect(migration.down[i]).toMatch(/^DROP INDEX/)
      }
      expect(migration.down[i]).toContain(idx.name)
    })
  })
})

// =============================================================================
// REAL-WORLD INTEGRATION: Full schema scenarios
// =============================================================================

describe('Real-World Schema Integration', () => {
  it('Social Network: polymorphic edges, fulltext, hierarchy', () => {
    const schema = defineSchema({
      nodes: {
        entity: node({ properties: {} }),
        user: node({
          properties: { email: z.string(), displayName: z.string() },
          indexes: [{ property: 'email', type: 'unique' }, { property: 'displayName', type: 'fulltext' }],
          labels: ['entity'],
        }),
        post: node({
          properties: { content: z.string(), visibility: z.enum(['public', 'private']) },
          indexes: [{ property: 'content', type: 'fulltext' }],
          labels: ['entity'],
        }),
        comment: node({ properties: { content: z.string() }, labels: ['entity'] }),
      },
      edges: {
        authored: edge({ from: 'user', to: ['post', 'comment'] as const, cardinality: { outbound: 'many', inbound: 'one' } }),
        likes: edge({ from: 'user', to: ['post', 'comment'] as const, cardinality: { outbound: 'many', inbound: 'many' } }),
        hasParent: edge({ from: ['post', 'comment'] as const, to: ['post', 'comment'] as const, cardinality: { outbound: 'optional', inbound: 'many' } }),
      },
      hierarchy: { defaultEdge: 'hasParent', direction: 'up' },
    })

    // Verify structure
    expect(Object.keys(schema.nodes)).toEqual(['entity', 'user', 'post', 'comment'])
    expect(Object.keys(schema.edges)).toEqual(['authored', 'likes', 'hasParent'])
    expect(schema.hierarchy).toEqual({ defaultEdge: 'hasParent', direction: 'up' })

    // Verify inheritance
    const entities = getNodesSatisfying(schema, 'entity')
    expect(entities).toContain('user')
    expect(entities).toContain('post')
    expect(entities).toContain('comment')

    // Verify indexes compile
    const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
    expect(indexes.length).toBeGreaterThan(0)
    expect(new Set(indexes.map((i) => i.name)).size).toBe(indexes.length) // No duplicates
  })

  it('Multi-tenant SaaS: composite unique constraints', () => {
    const schema = defineSchema({
      nodes: {
        tenant: node({ properties: { slug: z.string() }, indexes: [{ property: 'slug', type: 'unique' }] }),
        user: node({
          properties: { tenantId: z.string(), email: z.string() },
          indexes: [{ properties: ['tenantId', 'email'], type: 'unique' }],
        }),
      },
      edges: {
        belongsTo: edge({ from: 'user', to: 'tenant', cardinality: { outbound: 'one', inbound: 'many' } }),
      },
    })

    // Verify composite unique generates NODE KEY
    const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
    const tenantEmail = indexes.find((i) => i.name === 'idx_user_tenantId_email')
    expect(tenantEmail?.type).toBe('unique')
    expect(tenantEmail?.isComposite).toBe(true)
    expect(tenantEmail?.cypher).toContain('IS NODE KEY')
  })

  it('File System: tree hierarchy with down direction', () => {
    const schema = defineSchema({
      nodes: {
        fsNode: node({ properties: {} }),
        folder: node({ properties: { name: z.string() }, labels: ['fsNode'] }),
        file: node({ properties: { name: z.string(), size: z.number() }, labels: ['fsNode'] }),
      },
      edges: {
        contains: edge({ from: 'folder', to: ['folder', 'file'] as const, cardinality: { outbound: 'many', inbound: 'one' } }),
      },
      hierarchy: { defaultEdge: 'contains', direction: 'down' },
    })

    expect(schema.hierarchy?.direction).toBe('down')

    // Both folder and file satisfy fsNode
    const fsNodes = getNodesSatisfying(schema, 'fsNode')
    expect(fsNodes).toContain('folder')
    expect(fsNodes).toContain('file')
  })
})
