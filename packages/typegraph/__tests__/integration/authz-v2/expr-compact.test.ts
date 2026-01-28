/**
 * AUTH_V2 Tests: Expression Compaction
 */

import { describe, it, expect } from 'vitest'
import {
  toCompact,
  fromCompact,
  toCompactJSON,
  fromCompactJSON,
  type CompactExpr,
} from './expr-compact'
import { identity, union, intersect, exclude } from './expr-builder'
import type { IdentityExpr } from './types'

describe('AUTH_V2: Expression Compaction', () => {
  // ===========================================================================
  // BASIC COMPACTION
  // ===========================================================================

  describe('toCompact()', () => {
    it('compacts simple identity', () => {
      const expr: IdentityExpr = { kind: 'identity', id: 'USER1' }
      expect(toCompact(expr)).toEqual(['i', 'USER1'])
    })

    it('compacts identity with node scope', () => {
      const expr: IdentityExpr = {
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1', 'ws2'] }],
      }
      expect(toCompact(expr)).toEqual(['i', 'USER1', [{ n: ['ws1', 'ws2'] }]])
    })

    it('compacts identity with perm scope', () => {
      const expr: IdentityExpr = {
        kind: 'identity',
        id: 'ROLE1',
        scopes: [{ perms: ['read', 'write'] }],
      }
      expect(toCompact(expr)).toEqual(['i', 'ROLE1', [{ p: ['read', 'write'] }]])
    })

    it('compacts identity with principal scope', () => {
      const expr: IdentityExpr = {
        kind: 'identity',
        id: 'APP1',
        scopes: [{ principals: ['p1', 'p2'] }],
      }
      expect(toCompact(expr)).toEqual(['i', 'APP1', [{ r: ['p1', 'p2'] }]])
    })

    it('compacts identity with full scope', () => {
      const expr: IdentityExpr = {
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'], perms: ['read'], principals: ['p1'] }],
      }
      expect(toCompact(expr)).toEqual(['i', 'USER1', [{ n: ['ws1'], p: ['read'], r: ['p1'] }]])
    })

    it('compacts identity with multiple scopes', () => {
      const expr: IdentityExpr = {
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'] }, { perms: ['read'] }],
      }
      expect(toCompact(expr)).toEqual(['i', 'USER1', [{ n: ['ws1'] }, { p: ['read'] }]])
    })

    it('compacts union', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      }
      expect(toCompact(expr)).toEqual(['u', ['i', 'A'], ['i', 'B']])
    })

    it('compacts intersect', () => {
      const expr: IdentityExpr = {
        kind: 'intersect',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      }
      expect(toCompact(expr)).toEqual(['n', ['i', 'A'], ['i', 'B']])
    })

    it('compacts exclude', () => {
      const expr: IdentityExpr = {
        kind: 'exclude',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      }
      expect(toCompact(expr)).toEqual(['x', ['i', 'A'], ['i', 'B']])
    })

    it('compacts nested expression', () => {
      const expr = intersect(
        union(identity('A'), identity('B')),
        exclude(identity('C'), identity('D')),
      ).build()

      expect(toCompact(expr)).toEqual([
        'n',
        ['u', ['i', 'A'], ['i', 'B']],
        ['x', ['i', 'C'], ['i', 'D']],
      ])
    })
  })

  // ===========================================================================
  // EXPANSION
  // ===========================================================================

  describe('fromCompact()', () => {
    it('expands simple identity', () => {
      const compact: CompactExpr = ['i', 'USER1']
      expect(fromCompact(compact)).toEqual({ kind: 'identity', id: 'USER1' })
    })

    it('expands identity with node scope', () => {
      const compact: CompactExpr = ['i', 'USER1', [{ n: ['ws1'] }]]
      expect(fromCompact(compact)).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'] }],
      })
    })

    it('expands identity with full scope', () => {
      const compact: CompactExpr = ['i', 'USER1', [{ n: ['ws1'], p: ['read'], r: ['p1'] }]]
      expect(fromCompact(compact)).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: ['ws1'], perms: ['read'], principals: ['p1'] }],
      })
    })

    it('expands union', () => {
      const compact: CompactExpr = ['u', ['i', 'A'], ['i', 'B']]
      expect(fromCompact(compact)).toEqual({
        kind: 'union',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      })
    })

    it('expands intersect', () => {
      const compact: CompactExpr = ['n', ['i', 'A'], ['i', 'B']]
      expect(fromCompact(compact)).toEqual({
        kind: 'intersect',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      })
    })

    it('expands exclude', () => {
      const compact: CompactExpr = ['x', ['i', 'A'], ['i', 'B']]
      expect(fromCompact(compact)).toEqual({
        kind: 'exclude',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      })
    })

    it('expands nested expression', () => {
      const compact: CompactExpr = [
        'n',
        ['u', ['i', 'A'], ['i', 'B', [{ n: ['ws1'] }]]],
        ['x', ['i', 'C'], ['i', 'D']],
      ]

      expect(fromCompact(compact)).toEqual({
        kind: 'intersect',
        left: {
          kind: 'union',
          left: { kind: 'identity', id: 'A' },
          right: { kind: 'identity', id: 'B', scopes: [{ nodes: ['ws1'] }] },
        },
        right: {
          kind: 'exclude',
          left: { kind: 'identity', id: 'C' },
          right: { kind: 'identity', id: 'D' },
        },
      })
    })

    // Error handling
    it('throws on unknown kind', () => {
      expect(() => fromCompact(['z', ['i', 'A'], ['i', 'B']])).toThrow('Unknown expression kind')
    })

    it('throws on empty array', () => {
      expect(() => fromCompact([])).toThrow('Invalid expression')
    })

    it('throws on non-array input', () => {
      expect(() => fromCompact('not an array')).toThrow('Invalid expression')
    })

    it('throws on missing identity id', () => {
      expect(() => fromCompact(['i'])).toThrow('Invalid expression')
    })

    it('throws on wrong id type', () => {
      expect(() => fromCompact(['i', 123])).toThrow('Invalid identity id')
    })

    it('throws on empty id', () => {
      expect(() => fromCompact(['i', ''])).toThrow('Invalid identity id')
    })

    it('throws on missing operands for union', () => {
      expect(() => fromCompact(['u', ['i', 'A']])).toThrow('Invalid binary expression')
    })

    it('throws on invalid scope type', () => {
      expect(() => fromCompact(['i', 'A', 'not-an-array'])).toThrow('Invalid identity scopes')
    })

    it('throws on invalid scope.nodes type', () => {
      expect(() => fromCompact(['i', 'A', [{ n: 'not-array' }]])).toThrow('Invalid scope.nodes')
    })

    it('throws on invalid scope.nodes element type', () => {
      expect(() => fromCompact(['i', 'A', [{ n: [123] }]])).toThrow('Invalid scope.nodes')
    })
  })

  // ===========================================================================
  // ROUND-TRIP
  // ===========================================================================

  describe('round-trip', () => {
    it('preserves simple identity', () => {
      const expr = identity('USER1').build()
      expect(fromCompact(toCompact(expr))).toEqual(expr)
    })

    it('preserves scoped identity', () => {
      const expr = identity('USER1', { nodes: ['ws1'], perms: ['read'] }).build()
      expect(fromCompact(toCompact(expr))).toEqual(expr)
    })

    it('preserves complex expression', () => {
      const expr = intersect(
        union(identity('A', { nodes: ['ws1'] }), identity('B').restrict({ perms: ['write'] })),
        exclude(identity('C'), identity('D', [{ principals: ['p1'] }])),
      ).build()

      expect(fromCompact(toCompact(expr))).toEqual(expr)
    })

    it('preserves the user desired API example', () => {
      const ref1 = union(identity('X', { nodes: ['node-A'] }), identity('Y'))
      const restrictedIdentity = ref1.intersect(identity('Z'))
      const finalIdentity = intersect(
        identity('H').restrict({ perms: ['read'] }),
        restrictedIdentity.exclude(identity('M')),
      )

      const expr = finalIdentity.build()
      expect(fromCompact(toCompact(expr))).toEqual(expr)
    })
  })

  // ===========================================================================
  // JSON HELPERS
  // ===========================================================================

  describe('JSON helpers', () => {
    it('toCompactJSON serializes to string', () => {
      const expr = union(identity('A'), identity('B')).build()
      const json = toCompactJSON(expr)

      expect(typeof json).toBe('string')
      expect(JSON.parse(json)).toEqual(['u', ['i', 'A'], ['i', 'B']])
    })

    it('fromCompactJSON parses from string', () => {
      const json = '["u",["i","A"],["i","B"]]'
      const expr = fromCompactJSON(json)

      expect(expr).toEqual({
        kind: 'union',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      })
    })

    it('JSON round-trip works', () => {
      const expr = intersect(identity('A', { nodes: ['ws1'] }), identity('B')).build()
      expect(fromCompactJSON(toCompactJSON(expr))).toEqual(expr)
    })
  })

  // ===========================================================================
  // ROBUSTNESS
  // ===========================================================================

  describe('robustness', () => {
    it('handles empty scope arrays correctly', () => {
      const expr: IdentityExpr = {
        kind: 'identity',
        id: 'USER1',
        scopes: [{ nodes: [], perms: ['read'] }],
      }

      const compact = toCompact(expr)
      expect(compact).toEqual(['i', 'USER1', [{ p: ['read'] }]])

      const expanded = fromCompact(compact)
      expect(expanded).toEqual({
        kind: 'identity',
        id: 'USER1',
        scopes: [{ perms: ['read'] }],
      })
    })

    it('handles deeply nested expressions', () => {
      const expr = exclude(
        intersect(union(identity('A'), identity('B')), identity('C')),
        intersect(union(identity('D'), identity('E')), identity('F')),
      ).build()

      expect(fromCompact(toCompact(expr))).toEqual(expr)
    })

    it('handles identity IDs with special characters', () => {
      const expr = identity('user@example.com').build()
      expect(fromCompact(toCompact(expr))).toEqual(expr)
    })

    it('handles long scope arrays', () => {
      const nodes = Array.from({ length: 100 }, (_, i) => `node-${i}`)
      const expr = identity('USER1', { nodes }).build()
      expect(fromCompact(toCompact(expr))).toEqual(expr)
    })

    it('rejects expressions exceeding max depth', () => {
      // Build expression with 101 levels of nesting
      let deep: IdentityExpr = { kind: 'identity', id: 'leaf' }
      for (let i = 0; i < 101; i++) {
        deep = { kind: 'union', left: deep, right: { kind: 'identity', id: 'x' } }
      }
      expect(() => toCompact(deep)).toThrow('Expression too deeply nested')
    })

    it('rejects compact input exceeding max depth', () => {
      // Build compact expression with 101 levels
      let deep: unknown = ['i', 'leaf']
      for (let i = 0; i < 101; i++) {
        deep = ['u', deep, ['i', 'x']]
      }
      expect(() => fromCompact(deep)).toThrow('Expression too deeply nested')
    })

    it('preserves empty scopes for round-trip semantics', () => {
      // Empty scope {} is preserved to maintain round-trip consistency
      const compact = ['i', 'USER1', [{}]]
      const expanded = fromCompact(compact)
      expect(expanded).toEqual({ kind: 'identity', id: 'USER1', scopes: [{}] })
    })

    it('rejects array passed as scope object', () => {
      const compact = ['i', 'USER1', [['not', 'an', 'object']]]
      expect(() => fromCompact(compact)).toThrow('Invalid scope')
    })
  })
})
