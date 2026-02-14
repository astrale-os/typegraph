/**
 * Composite Index Specification Tests
 *
 * These tests verify the behavior of composite index support:
 * - API acceptance of composite index configurations
 * - Validation errors with educational messages
 * - Type guards for index discrimination
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { node, edge, defineSchema } from '../../src/schema/builders'
import { isCompositeIndex, isSinglePropertyIndex } from '../../src/schema/types'
import { SchemaValidationError } from '../../src/errors'

describe('Composite Index Support', () => {
  // ===========================================================================
  // BACKWARDS COMPATIBILITY
  // ===========================================================================

  describe('backwards compatibility', () => {
    it('accepts simple string indexes', () => {
      const userNode = node({
        properties: {
          email: z.string(),
          name: z.string(),
        },
        indexes: ['email'],
      })

      expect(userNode.indexes).toContain('email')
      expect(userNode.indexes).toHaveLength(1)
    })

    it('accepts single property with full config', () => {
      const userNode = node({
        properties: {
          email: z.string(),
          name: z.string(),
        },
        indexes: [{ property: 'email', type: 'unique' }],
      })

      expect(userNode.indexes).toHaveLength(1)
      expect(userNode.indexes[0]).toEqual({ property: 'email', type: 'unique' })
    })

    it('accepts fulltext index on single property', () => {
      const userNode = node({
        properties: {
          bio: z.string(),
        },
        indexes: [{ property: 'bio', type: 'fulltext' }],
      })

      expect(userNode.indexes[0]).toEqual({ property: 'bio', type: 'fulltext' })
    })

    it('accepts mixed index formats', () => {
      const userNode = node({
        properties: {
          email: z.string(),
          name: z.string(),
          bio: z.string(),
        },
        indexes: [
          'email',
          { property: 'name', type: 'btree' },
          { property: 'bio', type: 'fulltext' },
        ],
      })

      expect(userNode.indexes).toHaveLength(3)
    })
  })

  // ===========================================================================
  // COMPOSITE INDEX API
  // ===========================================================================

  describe('composite index configuration', () => {
    it('accepts composite index with multiple properties', () => {
      const userNode = node({
        properties: {
          firstName: z.string(),
          lastName: z.string(),
        },
        indexes: [{ properties: ['firstName', 'lastName'], type: 'btree' }],
      })

      expect(userNode.indexes).toHaveLength(1)
      expect(userNode.indexes[0]).toEqual({
        properties: ['firstName', 'lastName'],
        type: 'btree',
      })
    })

    it('preserves property order in composite index', () => {
      const userNode = node({
        properties: {
          a: z.string(),
          b: z.string(),
          c: z.string(),
        },
        indexes: [{ properties: ['c', 'a', 'b'], type: 'btree' }],
      })

      const idx = userNode.indexes[0] as { properties: string[] }
      expect(idx.properties[0]).toBe('c')
      expect(idx.properties[1]).toBe('a')
      expect(idx.properties[2]).toBe('b')
    })

    it('accepts composite unique index', () => {
      const userNode = node({
        properties: {
          tenantId: z.string(),
          email: z.string(),
        },
        indexes: [{ properties: ['tenantId', 'email'], type: 'unique' }],
      })

      const idx = userNode.indexes[0] as { type: string }
      expect(idx.type).toBe('unique')
    })

    it('accepts composite index with ordering', () => {
      const orderNode = node({
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
      })

      const idx = orderNode.indexes[0] as { order: Record<string, string> }
      expect(idx.order).toEqual({ createdAt: 'DESC' })
    })

    it('accepts named composite index', () => {
      const userNode = node({
        properties: {
          firstName: z.string(),
          lastName: z.string(),
        },
        indexes: [
          {
            properties: ['firstName', 'lastName'],
            type: 'btree',
            name: 'idx_user_fullname',
          },
        ],
      })

      const idx = userNode.indexes[0] as { name: string }
      expect(idx.name).toBe('idx_user_fullname')
    })

    it('accepts composite index on edge properties', () => {
      const friendEdge = edge({
        from: 'user',
        to: 'user',
        cardinality: { outbound: 'many', inbound: 'many' },
        properties: {
          type: z.enum(['friend', 'colleague']),
          since: z.date(),
        },
        indexes: [{ properties: ['type', 'since'], type: 'btree' }],
      })

      expect(friendEdge.indexes).toHaveLength(1)
    })
  })

  // ===========================================================================
  // VALIDATION ERRORS
  // ===========================================================================

  describe('validation errors', () => {
    it('throws when single property not found', () => {
      expect(() =>
        node({
          properties: { email: z.string() },
          indexes: ['nonexistent'],
        }),
      ).toThrow(SchemaValidationError)
    })

    it('provides helpful error with available properties', () => {
      try {
        node({
          properties: {
            email: z.string(),
            name: z.string(),
          },
          indexes: ['typo'],
        })
        expect.fail('Should have thrown')
      } catch (e) {
        const err = e as SchemaValidationError
        expect(err.name).toBe('SchemaValidationError')
        expect(err.field).toBe('indexes')
        expect(err.message).toContain('typo')
        expect(err.message).toContain('email')
        expect(err.message).toContain('name')
      }
    })

    it('throws when composite property not found', () => {
      expect(() =>
        node({
          properties: { email: z.string() },
          indexes: [{ properties: ['email', 'invalid'], type: 'btree' }],
        }),
      ).toThrow(SchemaValidationError)
    })

    it('lists available properties in composite error', () => {
      try {
        node({
          properties: {
            firstName: z.string(),
            lastName: z.string(),
          },
          indexes: [{ properties: ['firstName', 'typo'], type: 'btree' }],
        })
        expect.fail('Should have thrown')
      } catch (e) {
        const err = e as SchemaValidationError
        expect(err.field).toBe('indexes')
        expect(err.received).toBe('typo')
        expect(err.expected).toContain('firstName')
        expect(err.expected).toContain('lastName')
      }
    })

    it('rejects fulltext on composite index', () => {
      expect(() =>
        node({
          properties: {
            a: z.string(),
            b: z.string(),
          },
          indexes: [{ properties: ['a', 'b'], type: 'fulltext' as 'btree' }],
        }),
      ).toThrow(/fulltext.*cannot.*composite/i)
    })

    it('rejects composite with single property', () => {
      expect(() =>
        node({
          properties: { email: z.string() },
          indexes: [{ properties: ['email'], type: 'btree' }],
        }),
      ).toThrow(/at least 2 properties/i)
    })

    it('validates order properties match index properties', () => {
      expect(() =>
        node({
          properties: {
            a: z.string(),
            b: z.string(),
            c: z.string(),
          },
          indexes: [
            {
              properties: ['a', 'b'],
              type: 'btree',
              order: { c: 'DESC' }, // c is not in the composite index
            },
          ],
        }),
      ).toThrow(/order property.*not in composite/i)
    })
  })

  // ===========================================================================
  // TYPE GUARDS
  // ===========================================================================

  describe('type guards', () => {
    describe('isCompositeIndex', () => {
      it('returns true for composite config', () => {
        expect(isCompositeIndex({ properties: ['a', 'b'], type: 'btree' })).toBe(true)
      })

      it('returns false for single property config', () => {
        expect(isCompositeIndex({ property: 'a', type: 'btree' })).toBe(false)
      })

      it('returns false for base config without properties', () => {
        expect(isCompositeIndex({ type: 'btree' })).toBe(false)
      })
    })

    describe('isSinglePropertyIndex', () => {
      it('returns true for single property config', () => {
        expect(isSinglePropertyIndex({ property: 'email', type: 'unique' })).toBe(true)
      })

      it('returns false for composite config', () => {
        expect(isSinglePropertyIndex({ properties: ['a', 'b'], type: 'btree' })).toBe(false)
      })

      it('returns false for base config without property', () => {
        expect(isSinglePropertyIndex({ type: 'btree' })).toBe(false)
      })
    })
  })

  // ===========================================================================
  // SCHEMA INTEGRATION
  // ===========================================================================

  describe('schema integration', () => {
    it('works with defineSchema', () => {
      const schema = defineSchema({
        nodes: {
          user: node({
            properties: {
              tenantId: z.string(),
              email: z.string(),
              firstName: z.string(),
              lastName: z.string(),
            },
            indexes: [
              'email',
              { properties: ['firstName', 'lastName'], type: 'btree' },
              { properties: ['tenantId', 'email'], type: 'unique' },
            ],
          }),
        },
        edges: {},
      })

      expect(schema.nodes.user.indexes).toHaveLength(3)
    })
  })
})
