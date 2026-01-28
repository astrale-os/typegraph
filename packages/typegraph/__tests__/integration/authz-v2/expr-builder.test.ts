/**
 * AUTH_V2 Tests: Expression Builder SDK
 *
 * Tests for the fluent SDK for identity expression composition.
 */

import { describe, it, expect } from 'vitest'
import {
  identity,
  id,
  union,
  intersect,
  exclude,
  applyScopes,
  grant,
  raw,
  isExprBuilder,
} from './expr-builder'
import type { IdentityExpr, Scope } from './types'

describe('AUTH_V2: Expression Builder SDK', () => {
  // ===========================================================================
  // IDENTITY LEAF
  // ===========================================================================

  describe('identity()', () => {
    it('creates simple identity without scopes', () => {
      const expr = identity('USER1')
      expect(expr.build()).toEqual({ kind: 'identity', id: 'USER1' })
    })

    it('creates identity with single scope object', () => {
      const expr = identity('USER1', { nodes: ['ws1'] })
      expect(expr.build()).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'] }],
      })
    })

    it('creates identity with array of scopes', () => {
      const expr = identity('USER1', [{ nodes: ['ws1'] }, { perms: ['read'] }])
      expect(expr.build()).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'] }, { perms: ['read'] }],
      })
    })

    it('id() is alias for identity()', () => {
      expect(id('USER1').build()).toEqual(identity('USER1').build())
    })

    it('throws on empty string id', () => {
      expect(() => identity('')).toThrow('identity id must be a non-empty string')
    })

    it('filters out null/undefined scopes', () => {
      const expr = identity('USER1', [null as unknown as Scope, { nodes: ['ws1'] }])
      expect(expr.build()).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'] }],
      })
    })
  })

  describe('.restrict()', () => {
    it('adds scope to identity', () => {
      const expr = identity('USER1').restrict({ nodes: ['ws1'] })
      expect(expr.build()).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'] }],
      })
    })

    it('chains multiple restrict calls', () => {
      const expr = identity('USER1')
        .restrict({ nodes: ['ws1'] })
        .restrict({ perms: ['read'] })

      expect(expr.build()).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'] }, { perms: ['read'] }],
      })
    })

    it('is immutable - original not modified', () => {
      const original = identity('USER1')
      const restricted = original.restrict({ nodes: ['ws1'] })

      expect(original.build()).toEqual({ kind: 'identity', id: 'USER1' })
      expect(restricted.build()).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'] }],
      })
    })
  })

  // ===========================================================================
  // COMPOSITION: METHOD CHAINING
  // ===========================================================================

  describe('method chaining', () => {
    it('.union() creates union expression', () => {
      const expr = identity('A').union(identity('B'))
      expect(expr.build()).toEqual({
        kind: 'union',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      })
    })

    it('.intersect() creates intersect expression', () => {
      const expr = identity('A').intersect(identity('B'))
      expect(expr.build()).toEqual({
        kind: 'intersect',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      })
    })

    it('.exclude() creates exclude expression', () => {
      const expr = identity('A').exclude(identity('B'))
      expect(expr.build()).toEqual({
        kind: 'exclude',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      })
    })

    it('chains multiple operations', () => {
      const expr = identity('A')
        .union(identity('B'))
        .intersect(identity('C'))
        .exclude(identity('D'))

      expect(expr.build()).toEqual({
        kind: 'exclude',
        left: {
          kind: 'intersect',
          left: {
            kind: 'union',
            left: { kind: 'identity', id: 'A' },
            right: { kind: 'identity', id: 'B' },
          },
          right: { kind: 'identity', id: 'C' },
        },
        right: { kind: 'identity', id: 'D' },
      })
    })
  })

  // ===========================================================================
  // COMPOSITION: FACTORY FUNCTIONS
  // ===========================================================================

  describe('union() factory', () => {
    it('with single expression returns same expression', () => {
      const expr = union(identity('A'))
      // Note: single-arg union just returns the arg directly via reduce
      expect(expr.build()).toEqual({ kind: 'identity', id: 'A' })
    })

    it('with two expressions creates union', () => {
      const expr = union(identity('A'), identity('B'))
      expect(expr.build()).toEqual({
        kind: 'union',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      })
    })

    it('with multiple expressions left-associates', () => {
      const expr = union(identity('A'), identity('B'), identity('C'))
      // ((A ∪ B) ∪ C)
      expect(expr.build()).toEqual({
        kind: 'union',
        left: {
          kind: 'union',
          left: { kind: 'identity', id: 'A' },
          right: { kind: 'identity', id: 'B' },
        },
        right: { kind: 'identity', id: 'C' },
      })
    })

    it('throws on empty', () => {
      expect(() => union()).toThrow('union requires at least one expression')
    })
  })

  describe('intersect() factory', () => {
    it('with single expression returns same expression', () => {
      const expr = intersect(identity('A'))
      expect(expr.build()).toEqual({ kind: 'identity', id: 'A' })
    })

    it('with two expressions creates intersect', () => {
      const expr = intersect(identity('A'), identity('B'))
      expect(expr.build()).toEqual({
        kind: 'intersect',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      })
    })

    it('with multiple expressions left-associates', () => {
      const expr = intersect(identity('A'), identity('B'), identity('C'))
      // ((A ∩ B) ∩ C)
      expect(expr.build()).toEqual({
        kind: 'intersect',
        left: {
          kind: 'intersect',
          left: { kind: 'identity', id: 'A' },
          right: { kind: 'identity', id: 'B' },
        },
        right: { kind: 'identity', id: 'C' },
      })
    })

    it('throws on empty', () => {
      expect(() => intersect()).toThrow('intersect requires at least one expression')
    })
  })

  describe('exclude() factory', () => {
    it('creates exclude expression', () => {
      const expr = exclude(identity('A'), identity('B'))
      expect(expr.build()).toEqual({
        kind: 'exclude',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      })
    })
  })

  // ===========================================================================
  // RAW EXPRESSION WRAPPER
  // ===========================================================================

  describe('raw()', () => {
    it('wraps simple identity expression', () => {
      const rawExpr: IdentityExpr = { kind: 'identity', id: 'A' }
      const wrapped = raw(rawExpr)

      expect(wrapped.build()).toEqual(rawExpr)
    })

    it('wraps complex expression', () => {
      const rawExpr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      }
      const wrapped = raw(rawExpr)

      expect(wrapped.build()).toEqual(rawExpr)
    })

    it('can be composed with other builders', () => {
      const rawExpr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      }
      const composed = raw(rawExpr).intersect(identity('C'))

      expect(composed.build()).toEqual({
        kind: 'intersect',
        left: rawExpr,
        right: { kind: 'identity', id: 'C' },
      })
    })

    it('can be used in factory functions', () => {
      const rawExpr: IdentityExpr = { kind: 'identity', id: 'RESOLVED' }
      const composed = union(raw(rawExpr), identity('NEW'))

      expect(composed.build()).toEqual({
        kind: 'union',
        left: { kind: 'identity', id: 'RESOLVED' },
        right: { kind: 'identity', id: 'NEW' },
      })
    })

    it('throws on null input', () => {
      expect(() => raw(null as unknown as IdentityExpr)).toThrow(
        'raw() requires a valid IdentityExpr object',
      )
    })

    it('throws on invalid kind', () => {
      expect(() => raw({ kind: 'invalid' } as unknown as IdentityExpr)).toThrow(
        'Invalid expression kind: invalid',
      )
    })
  })

  // ===========================================================================
  // COMPLEX EXPRESSIONS (from plan example)
  // ===========================================================================

  describe('complex expressions', () => {
    it('builds the user desired API example', () => {
      // ref1 = union(identity("X", { nodes: ["node-A"] }), identity("Y"))
      const ref1 = union(identity('X', { nodes: ['node-A'] }), identity('Y'))

      // restrictedIdentity = ref1.intersect(identity("Z"))
      const restrictedIdentity = ref1.intersect(identity('Z'))

      // finalIdentity = intersect(
      //   identity("H").restrict({ perms: ["read"] }),
      //   restrictedIdentity.exclude(identity("M"))
      // )
      const finalIdentity = intersect(
        identity('H').restrict({ perms: ['read'] }),
        restrictedIdentity.exclude(identity('M')),
      )

      const built = finalIdentity.build()

      // Expected tree:
      // intersect(
      //   identity("H", { perms: ["read"] }),
      //   exclude(
      //     intersect(
      //       union(
      //         identity("X", { nodes: ["node-A"] }),
      //         identity("Y")
      //       ),
      //       identity("Z")
      //     ),
      //     identity("M")
      //   )
      // )
      expect(built).toEqual({
        kind: 'intersect',
        left: {
          kind: 'identity',
          id: 'H',
          scopes: [{ perms: ['read'] }],
        },
        right: {
          kind: 'exclude',
          left: {
            kind: 'intersect',
            left: {
              kind: 'union',
              left: {
                kind: 'identity',
                id: 'X',
                scopes: [{ nodes: ['node-A'] }],
              },
              right: { kind: 'identity', id: 'Y' },
            },
            right: { kind: 'identity', id: 'Z' },
          },
          right: { kind: 'identity', id: 'M' },
        },
      })
    })
  })

  // ===========================================================================
  // JSON SERIALIZATION
  // ===========================================================================

  describe('JSON serialization', () => {
    it('round-trips simple identity', () => {
      const expr = identity('USER1')
      const json = JSON.stringify(expr.build())
      const parsed: IdentityExpr = JSON.parse(json)

      expect(parsed).toEqual({ kind: 'identity', id: 'USER1' })
    })

    it('round-trips scoped identity', () => {
      const expr = identity('USER1', { nodes: ['ws1'], perms: ['read'] })
      const json = JSON.stringify(expr.build())
      const parsed: IdentityExpr = JSON.parse(json)

      expect(parsed).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'], perms: ['read'] }],
      })
    })

    it('round-trips complex expression', () => {
      const expr = union(identity('A', { nodes: ['n1'] }), identity('B'))
        .intersect(identity('C'))
        .exclude(identity('D').restrict({ perms: ['write'] }))

      const json = JSON.stringify(expr.build())
      const parsed: IdentityExpr = JSON.parse(json)

      expect(parsed).toEqual(expr.build())
    })
  })

  // ===========================================================================
  // applyScopes() HELPER
  // ===========================================================================

  describe('applyScopes()', () => {
    it('adds scope to simple identity', () => {
      const expr: IdentityExpr = { kind: 'identity', id: 'A' }
      const result = applyScopes(expr, { nodes: ['ws1'] })

      expect(result).toEqual({
        kind: 'identity',
        id: 'A',
        scopes: [{ nodes: ['ws1'] }],
      })
    })

    it('adds scope to already scoped identity', () => {
      const expr: IdentityExpr = {
        kind: 'identity',
        id: 'A',
        scopes: [{ perms: ['read'] }],
      }
      const result = applyScopes(expr, { nodes: ['ws1'] })

      expect(result).toEqual({
        kind: 'identity',
        id: 'A',
        scopes: [{ perms: ['read'] }, { nodes: ['ws1'] }],
      })
    })

    it('recursively applies to all leaves in union', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      }
      const result = applyScopes(expr, { nodes: ['ws1'] })

      expect(result).toEqual({
        kind: 'union',
        left: { kind: 'identity', id: 'A', scopes: [{ nodes: ['ws1'] }] },
        right: { kind: 'identity', id: 'B', scopes: [{ nodes: ['ws1'] }] },
      })
    })

    it('recursively applies to complex tree', () => {
      const expr: IdentityExpr = {
        kind: 'intersect',
        left: {
          kind: 'union',
          left: { kind: 'identity', id: 'A' },
          right: { kind: 'identity', id: 'B', scopes: [{ perms: ['write'] }] },
        },
        right: {
          kind: 'exclude',
          left: { kind: 'identity', id: 'C' },
          right: { kind: 'identity', id: 'D' },
        },
      }

      const result = applyScopes(expr, { nodes: ['ws1'] })

      expect(result).toEqual({
        kind: 'intersect',
        left: {
          kind: 'union',
          left: { kind: 'identity', id: 'A', scopes: [{ nodes: ['ws1'] }] },
          right: {
            kind: 'identity',
            id: 'B',
            scopes: [{ perms: ['write'] }, { nodes: ['ws1'] }],
          },
        },
        right: {
          kind: 'exclude',
          left: { kind: 'identity', id: 'C', scopes: [{ nodes: ['ws1'] }] },
          right: { kind: 'identity', id: 'D', scopes: [{ nodes: ['ws1'] }] },
        },
      })
    })
  })

  // ===========================================================================
  // GRANT BUILDER
  // ===========================================================================

  describe('grant()', () => {
    it('builds grant with forType and forResource', () => {
      const g = grant(identity('APP1'), identity('USER1'))
      expect(g.build()).toEqual({
        forType: { kind: 'identity', id: 'APP1' },
        forResource: { kind: 'identity', id: 'USER1' },
      })
    })

    it('supports complex expressions', () => {
      const g = grant(
        identity('APP1'),
        union(identity('USER1'), identity('ROLE1')).intersect(identity('GROUP1')),
      )

      expect(g.build()).toEqual({
        forType: { kind: 'identity', id: 'APP1' },
        forResource: {
          kind: 'intersect',
          left: {
            kind: 'union',
            left: { kind: 'identity', id: 'USER1' },
            right: { kind: 'identity', id: 'ROLE1' },
          },
          right: { kind: 'identity', id: 'GROUP1' },
        },
      })
    })
  })

  // ===========================================================================
  // TYPE GUARDS
  // ===========================================================================

  describe('isExprBuilder()', () => {
    it('returns true for IdentityExprBuilder', () => {
      expect(isExprBuilder(identity('A'))).toBe(true)
    })

    it('returns true for BinaryExpr', () => {
      expect(isExprBuilder(identity('A').union(identity('B')))).toBe(true)
    })

    it('returns true for RawExpr', () => {
      expect(isExprBuilder(raw({ kind: 'identity', id: 'A' }))).toBe(true)
    })

    it('returns false for raw IdentityExpr', () => {
      expect(isExprBuilder({ kind: 'identity', id: 'A' })).toBe(false)
    })

    it('returns false for null/undefined', () => {
      expect(isExprBuilder(null)).toBe(false)
      expect(isExprBuilder(undefined)).toBe(false)
    })

    it('returns false for primitives', () => {
      expect(isExprBuilder('string')).toBe(false)
      expect(isExprBuilder(123)).toBe(false)
    })
  })
})
