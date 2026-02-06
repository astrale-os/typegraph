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
} from './expression/compact'
import { identity, union, intersect, exclude } from './expression/builder'
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

    it('compacts scope with identity and node scope', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: ['ws1', 'ws2'] }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      expect(toCompact(expr)).toEqual(['s', [{ n: ['ws1', 'ws2'] }], ['i', 'USER1']])
    })

    it('compacts scope with identity and perm scope', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ perms: ['read', 'write'] }],
        expr: { kind: 'identity', id: 'ROLE1' },
      }
      expect(toCompact(expr)).toEqual(['s', [{ p: ['read', 'write'] }], ['i', 'ROLE1']])
    })

    it('compacts scope with identity and principal scope', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ principals: ['p1', 'p2'] }],
        expr: { kind: 'identity', id: 'APP1' },
      }
      expect(toCompact(expr)).toEqual(['s', [{ r: ['p1', 'p2'] }], ['i', 'APP1']])
    })

    it('compacts scope with identity and full scope', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: ['ws1'], perms: ['read'], principals: ['p1'] }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      expect(toCompact(expr)).toEqual(['s', [{ n: ['ws1'], p: ['read'], r: ['p1'] }], ['i', 'USER1']])
    })

    it('compacts scope with identity and multiple scopes', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }, { perms: ['read'] }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      expect(toCompact(expr)).toEqual(['s', [{ n: ['ws1'] }, { p: ['read'] }], ['i', 'USER1']])
    })

    it('compacts union', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [{ kind: 'identity', id: 'A' }, { kind: 'identity', id: 'B' }],
      }
      expect(toCompact(expr)).toEqual(['u', [['i', 'A'], ['i', 'B']]])
    })

    it('compacts intersect', () => {
      const expr: IdentityExpr = {
        kind: 'intersect',
        operands: [{ kind: 'identity', id: 'A' }, { kind: 'identity', id: 'B' }],
      }
      expect(toCompact(expr)).toEqual(['n', [['i', 'A'], ['i', 'B']]])
    })

    it('compacts exclude', () => {
      const expr: IdentityExpr = {
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [{ kind: 'identity', id: 'B' }],
      }
      expect(toCompact(expr)).toEqual(['x', ['i', 'A'], [['i', 'B']]])
    })

    it('compacts nested expression', () => {
      const expr = intersect(
        union(identity('A'), identity('B')),
        exclude(identity('C'), identity('D')),
      ).build()

      expect(toCompact(expr)).toEqual([
        'n',
        [
          ['u', [['i', 'A'], ['i', 'B']]],
          ['x', ['i', 'C'], [['i', 'D']]],
        ],
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

    it('expands scope with identity and node scope', () => {
      const compact: CompactExpr = ['s', [{ n: ['ws1'] }], ['i', 'USER1']]
      expect(fromCompact(compact)).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }],
        expr: { kind: 'identity', id: 'USER1' },
      })
    })

    it('expands scope with identity and full scope', () => {
      const compact: CompactExpr = ['s', [{ n: ['ws1'], p: ['read'], r: ['p1'] }], ['i', 'USER1']]
      expect(fromCompact(compact)).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'], perms: ['read'], principals: ['p1'] }],
        expr: { kind: 'identity', id: 'USER1' },
      })
    })

    it('expands union', () => {
      const compact: CompactExpr = ['u', [['i', 'A'], ['i', 'B']]]
      expect(fromCompact(compact)).toEqual({
        kind: 'union',
        operands: [{ kind: 'identity', id: 'A' }, { kind: 'identity', id: 'B' }],
      })
    })

    it('expands intersect', () => {
      const compact: CompactExpr = ['n', [['i', 'A'], ['i', 'B']]]
      expect(fromCompact(compact)).toEqual({
        kind: 'intersect',
        operands: [{ kind: 'identity', id: 'A' }, { kind: 'identity', id: 'B' }],
      })
    })

    it('expands exclude', () => {
      const compact: CompactExpr = ['x', ['i', 'A'], [['i', 'B']]]
      expect(fromCompact(compact)).toEqual({
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [{ kind: 'identity', id: 'B' }],
      })
    })

    it('expands nested expression', () => {
      const compact: CompactExpr = [
        'n',
        [
          ['u', [['i', 'A'], ['s', [{ n: ['ws1'] }], ['i', 'B']]]],
          ['x', ['i', 'C'], [['i', 'D']]],
        ],
      ]

      expect(fromCompact(compact)).toEqual({
        kind: 'intersect',
        operands: [
          {
            kind: 'union',
            operands: [
              { kind: 'identity', id: 'A' },
              { kind: 'scope', scopes: [{ nodes: ['ws1'] }], expr: { kind: 'identity', id: 'B' } },
            ],
          },
          {
            kind: 'exclude',
            base: { kind: 'identity', id: 'C' },
            excluded: [{ kind: 'identity', id: 'D' }],
          },
        ],
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
      expect(() => fromCompact(['u', [['i', 'A']]])).toThrow('union must have at least 2 operands')
    })

    it('throws on missing operands for intersect', () => {
      expect(() => fromCompact(['n', [['i', 'A']]])).toThrow('intersect must have at least 2 operands')
    })

    it('throws on invalid scope expression', () => {
      expect(() => fromCompact(['s', 'not-an-array', ['i', 'A']])).toThrow('Invalid scope scopes')
    })

    it('throws on empty scope array', () => {
      expect(() => fromCompact(['s', [], ['i', 'A']])).toThrow('Scope must have at least one scope')
    })

    it('throws on invalid scope.nodes type', () => {
      expect(() => fromCompact(['s', [{ n: 'not-array' }], ['i', 'A']])).toThrow('Invalid scope.nodes')
    })

    it('throws on invalid scope.nodes element type', () => {
      expect(() => fromCompact(['s', [{ n: [123] }], ['i', 'A']])).toThrow('Invalid scope.nodes')
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
        union(identity('A', { nodes: ['ws1'] }), identity('B').scope({ perms: ['write'] })),
        exclude(identity('C'), identity('D', [{ principals: ['p1'] }])),
      ).build()

      expect(fromCompact(toCompact(expr))).toEqual(expr)
    })

    it('preserves the user desired API example', () => {
      const ref1 = union(identity('X', { nodes: ['node-A'] }), identity('Y'))
      const restrictedIdentity = ref1.intersect(identity('Z'))
      const finalIdentity = intersect(
        identity('H').scope({ perms: ['read'] }),
        restrictedIdentity.exclude(identity('M')),
      )

      const expr = finalIdentity.build()
      expect(fromCompact(toCompact(expr))).toEqual(expr)
    })

    it('round-trips exclude with multiple excluded operands', () => {
      const expr: IdentityExpr = {
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [
          { kind: 'identity', id: 'B' },
          { kind: 'identity', id: 'C' },
          { kind: 'identity', id: 'D' },
        ],
      }
      const compact = toCompact(expr)
      expect(compact).toEqual(['x', ['i', 'A'], [['i', 'B'], ['i', 'C'], ['i', 'D']]])
      expect(fromCompact(compact)).toEqual(expr)
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
      expect(JSON.parse(json)).toEqual(['u', [['i', 'A'], ['i', 'B']]])
    })

    it('fromCompactJSON parses from string', () => {
      const json = '["u",[["i","A"],["i","B"]]]'
      const expr = fromCompactJSON(json)

      expect(expr).toEqual({
        kind: 'union',
        operands: [{ kind: 'identity', id: 'A' }, { kind: 'identity', id: 'B' }],
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
      // NOTE: Compact format intentionally strips empty arrays (nodes: []) from scopes.
      // This is semantically safe because both { nodes: [] } and absent nodes mean
      // "no node restriction" -- the scope dimension is unrestricted in both cases.
      // The authorization logic (scopeAllowsNode) treats undefined as unrestricted,
      // and empty arrays are stripped before reaching Cypher generation.
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: [], perms: ['read'] }],
        expr: { kind: 'identity', id: 'USER1' },
      }

      const compact = toCompact(expr)
      expect(compact).toEqual(['s', [{ p: ['read'] }], ['i', 'USER1']])

      const expanded = fromCompact(compact)
      expect(expanded).toEqual({
        kind: 'scope',
        scopes: [{ perms: ['read'] }],
        expr: { kind: 'identity', id: 'USER1' },
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
        deep = { kind: 'union', operands: [deep, { kind: 'identity', id: 'x' }] }
      }
      expect(() => toCompact(deep)).toThrow('Expression too deeply nested')
    })

    it('rejects compact input exceeding max depth', () => {
      // Build compact expression with 101 levels
      let deep: unknown = ['i', 'leaf']
      for (let i = 0; i < 101; i++) {
        deep = ['u', [deep, ['i', 'x']]]
      }
      expect(() => fromCompact(deep)).toThrow('Expression too deeply nested')
    })

    it('preserves empty scopes for round-trip semantics', () => {
      // Empty scope {} is preserved to maintain round-trip consistency
      const compact = ['s', [{}], ['i', 'USER1']]
      const expanded = fromCompact(compact)
      expect(expanded).toEqual({ kind: 'scope', scopes: [{}], expr: { kind: 'identity', id: 'USER1' } })
    })

    it('rejects array passed as scope object', () => {
      const compact = ['s', [['not', 'an', 'object']], ['i', 'USER1']]
      expect(() => fromCompact(compact)).toThrow('Invalid scope')
    })
  })
})
