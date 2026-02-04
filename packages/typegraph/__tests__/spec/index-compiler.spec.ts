/**
 * Index Compiler Specification Tests
 *
 * These tests verify Cypher generation from schema index definitions:
 * - Single property indexes
 * - Composite indexes
 * - Unique constraints
 * - Fulltext indexes
 * - Relationship indexes
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { node, edge, defineSchema } from '../../src/schema/builders'
import {
  compileSchemaIndexes,
  generateIndexMigration,
  type CompiledIndex,
} from '../../src/schema/index-compiler'

/**
 * Normalize Cypher for comparison (removes extra whitespace).
 */
function normalizeCypher(cypher: string): string {
  return cypher
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
}

describe('Index Compiler', () => {
  // ===========================================================================
  // SINGLE PROPERTY INDEXES
  // ===========================================================================

  describe('single property indexes', () => {
    const schema = defineSchema({
      nodes: {
        user: node({
          properties: {
            email: z.string(),
            name: z.string(),
          },
          indexes: ['email'],
        }),
      },
      edges: {},
    })

    it('generates CREATE INDEX for simple string index', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const emailIdx = indexes.find((i) => i.properties.includes('email'))

      expect(emailIdx).toBeDefined()
      expect(normalizeCypher(emailIdx!.cypher)).toBe(
        normalizeCypher('CREATE INDEX FOR (n:User) ON (n.email)'),
      )
    })

    it('sets correct metadata', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const emailIdx = indexes.find((i) => i.properties.includes('email'))!

      expect(emailIdx.name).toBe('idx_user_email')
      expect(emailIdx.label).toBe('User')
      expect(emailIdx.type).toBe('btree')
      expect(emailIdx.isComposite).toBe(false)
      expect(emailIdx.isRelationship).toBe(false)
    })
  })

  // ===========================================================================
  // UNIQUE CONSTRAINTS
  // ===========================================================================

  describe('unique constraints', () => {
    const schema = defineSchema({
      nodes: {
        user: node({
          properties: {
            email: z.string(),
          },
          indexes: [{ property: 'email', type: 'unique' }],
        }),
      },
      edges: {},
    })

    it('generates CREATE CONSTRAINT for unique', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const uniqueIdx = indexes.find((i) => i.type === 'unique')

      expect(uniqueIdx).toBeDefined()
      expect(normalizeCypher(uniqueIdx!.cypher)).toBe(
        normalizeCypher('CREATE CONSTRAINT FOR (n:User) REQUIRE n.email IS UNIQUE'),
      )
    })
  })

  // ===========================================================================
  // FULLTEXT INDEXES
  // ===========================================================================

  describe('fulltext indexes', () => {
    const schema = defineSchema({
      nodes: {
        post: node({
          properties: {
            content: z.string(),
          },
          indexes: [{ property: 'content', type: 'fulltext' }],
        }),
      },
      edges: {},
    })

    it('generates CREATE FULLTEXT INDEX', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const fulltextIdx = indexes.find((i) => i.type === 'fulltext')

      expect(fulltextIdx).toBeDefined()
      expect(fulltextIdx!.cypher).toContain('CREATE FULLTEXT INDEX')
      expect(fulltextIdx!.cypher).toContain('ON EACH [n.content]')
    })
  })

  // ===========================================================================
  // COMPOSITE INDEXES
  // ===========================================================================

  describe('composite indexes', () => {
    const schema = defineSchema({
      nodes: {
        user: node({
          properties: {
            firstName: z.string(),
            lastName: z.string(),
            tenantId: z.string(),
            email: z.string(),
          },
          indexes: [
            { properties: ['firstName', 'lastName'], type: 'btree' },
            { properties: ['tenantId', 'email'], type: 'unique' },
          ],
        }),
      },
      edges: {},
    })

    it('generates composite btree index', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const nameIdx = indexes.find(
        (i) => i.isComposite && i.type === 'btree' && i.properties.includes('firstName'),
      )

      expect(nameIdx).toBeDefined()
      expect(normalizeCypher(nameIdx!.cypher)).toBe(
        normalizeCypher('CREATE INDEX FOR (n:User) ON (n.firstName, n.lastName)'),
      )
    })

    it('preserves property order in composite index', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const nameIdx = indexes.find((i) => i.properties.includes('firstName'))!

      expect(nameIdx.properties[0]).toBe('firstName')
      expect(nameIdx.properties[1]).toBe('lastName')
    })

    it('generates NODE KEY for composite unique', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const uniqueIdx = indexes.find((i) => i.isComposite && i.type === 'unique')

      expect(uniqueIdx).toBeDefined()
      expect(normalizeCypher(uniqueIdx!.cypher)).toBe(
        normalizeCypher(
          'CREATE CONSTRAINT FOR (n:User) REQUIRE (n.tenantId, n.email) IS NODE KEY',
        ),
      )
    })

    it('sets isComposite flag correctly', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })

      const compositeIndexes = indexes.filter((i) => i.isComposite)
      const singleIndexes = indexes.filter((i) => !i.isComposite)

      expect(compositeIndexes).toHaveLength(2)
      expect(singleIndexes).toHaveLength(0)
    })
  })

  // ===========================================================================
  // COMPOSITE INDEX WITH ORDERING
  // ===========================================================================

  describe('composite index with ordering', () => {
    const schema = defineSchema({
      nodes: {
        order: node({
          properties: {
            userId: z.string(),
            createdAt: z.date(),
          },
          indexes: [
            {
              properties: ['userId', 'createdAt'],
              type: 'btree',
              order: { createdAt: 'DESC' },
            },
          ],
        }),
      },
      edges: {},
    })

    it('includes ordering in Cypher', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const orderIdx = indexes[0]

      expect(orderIdx.cypher).toContain('n.userId')
      expect(orderIdx.cypher).toContain('n.createdAt DESC')
    })
  })

  // ===========================================================================
  // IF NOT EXISTS OPTION
  // ===========================================================================

  describe('IF NOT EXISTS option', () => {
    const schema = defineSchema({
      nodes: {
        user: node({
          properties: { email: z.string() },
          indexes: ['email'],
        }),
      },
      edges: {},
    })

    it('includes IF NOT EXISTS when option is true', () => {
      const indexes = compileSchemaIndexes(schema, {
        ifNotExists: true,
        includeBaseIndexes: false,
      })

      expect(indexes[0].cypher).toContain('IF NOT EXISTS')
    })

    it('excludes IF NOT EXISTS when option is false', () => {
      const indexes = compileSchemaIndexes(schema, {
        ifNotExists: false,
        includeBaseIndexes: false,
      })

      expect(indexes[0].cypher).not.toContain('IF NOT EXISTS')
    })
  })

  // ===========================================================================
  // BASE INDEX OPTION
  // ===========================================================================

  describe('base index option', () => {
    const schema = defineSchema({
      nodes: {
        user: node({
          properties: { email: z.string() },
          indexes: ['email'],
        }),
      },
      edges: {},
    })

    it('includes :Node base index by default', () => {
      const indexes = compileSchemaIndexes(schema)
      const nodeIdx = indexes.find((i) => i.label === 'Node')

      expect(nodeIdx).toBeDefined()
      expect(nodeIdx!.cypher).toContain('(n:Node)')
      expect(nodeIdx!.cypher).toContain('(n.id)')
    })

    it('excludes base index when option is false', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const nodeIdx = indexes.find((i) => i.label === 'Node')

      expect(nodeIdx).toBeUndefined()
    })
  })

  // ===========================================================================
  // RELATIONSHIP INDEXES
  // ===========================================================================

  describe('relationship indexes', () => {
    const schema = defineSchema({
      nodes: {
        user: node({ properties: { name: z.string() } }),
      },
      edges: {
        friends: edge({
          from: 'user',
          to: 'user',
          cardinality: { outbound: 'many', inbound: 'many' },
          properties: {
            since: z.date(),
            type: z.string(),
          },
          indexes: [
            'since',
            { properties: ['type', 'since'], type: 'btree' },
          ],
        }),
      },
    })

    it('generates relationship index', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const relIdx = indexes.find((i) => i.isRelationship && !i.isComposite)

      expect(relIdx).toBeDefined()
      expect(relIdx!.cypher).toContain('()-[r:FRIENDS]-()')
      expect(relIdx!.cypher).toContain('(r.since)')
    })

    it('generates composite relationship index', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const relIdx = indexes.find((i) => i.isRelationship && i.isComposite)

      expect(relIdx).toBeDefined()
      expect(relIdx!.cypher).toContain('()-[r:FRIENDS]-()')
      expect(relIdx!.cypher).toContain('r.type')
      expect(relIdx!.cypher).toContain('r.since')
    })

    it('sets isRelationship flag', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const relIndexes = indexes.filter((i) => i.isRelationship)

      expect(relIndexes).toHaveLength(2)
      relIndexes.forEach((idx) => {
        expect(idx.label).toBe('FRIENDS')
      })
    })
  })

  // ===========================================================================
  // MIGRATION GENERATION
  // ===========================================================================

  describe('generateIndexMigration', () => {
    const schema = defineSchema({
      nodes: {
        user: node({
          properties: {
            email: z.string(),
            firstName: z.string(),
            lastName: z.string(),
          },
          indexes: [
            { property: 'email', type: 'unique' },
            { properties: ['firstName', 'lastName'], type: 'btree' },
          ],
        }),
      },
      edges: {},
    })

    it('generates up statements', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const migration = generateIndexMigration(indexes)

      expect(migration.up).toHaveLength(2)
      expect(migration.up[0]).toContain('CREATE')
      expect(migration.up[1]).toContain('CREATE')
    })

    it('generates down statements', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const migration = generateIndexMigration(indexes)

      expect(migration.down).toHaveLength(2)
      expect(migration.down[0]).toContain('DROP CONSTRAINT')
      expect(migration.down[1]).toContain('DROP INDEX')
    })

    it('uses correct DROP syntax for unique vs btree', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })
      const migration = generateIndexMigration(indexes)

      const uniqueDrop = migration.down.find((s) => s.includes('CONSTRAINT'))
      const btreeDrop = migration.down.find((s) => s.includes('DROP INDEX'))

      expect(uniqueDrop).toBeDefined()
      expect(btreeDrop).toBeDefined()
    })
  })

  // ===========================================================================
  // NAMED INDEXES
  // ===========================================================================

  describe('named indexes', () => {
    const schema = defineSchema({
      nodes: {
        user: node({
          properties: {
            firstName: z.string(),
            lastName: z.string(),
          },
          indexes: [
            {
              properties: ['firstName', 'lastName'],
              type: 'btree',
              name: 'custom_fullname_idx',
            },
          ],
        }),
      },
      edges: {},
    })

    it('uses custom name when provided', () => {
      const indexes = compileSchemaIndexes(schema, { includeBaseIndexes: false })

      expect(indexes[0].name).toBe('custom_fullname_idx')
    })

    it('auto-generates name when not provided', () => {
      const autoSchema = defineSchema({
        nodes: {
          user: node({
            properties: { email: z.string() },
            indexes: ['email'],
          }),
        },
        edges: {},
      })

      const indexes = compileSchemaIndexes(autoSchema, { includeBaseIndexes: false })

      expect(indexes[0].name).toBe('idx_user_email')
    })
  })
})
