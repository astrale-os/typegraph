/**
 * AUTH_V2 Tests: Expression Deduplication
 *
 * Tests for structural deduplication of identity expressions.
 */

import { describe, it, expect } from 'vitest'
import {
  dedup,
  expand,
  hasRepeatedSubtrees,
  dedupStats,
  isRef,
  isDedupedExpr,
  type DedupedExpr,
  type Ref,
} from './expression/dedup'
import { identity, union, intersect, exclude } from './expression/builder'
import type { IdentityExpr } from './types'
import { READ } from './testing/helpers'

describe('AUTH_V2: Expression Deduplication', () => {
  // ===========================================================================
  // TYPE GUARDS
  // ===========================================================================

  describe('type guards', () => {
    it('isRef returns true for Ref objects', () => {
      expect(isRef({ $ref: 0 })).toBe(true)
      expect(isRef({ $ref: 5 })).toBe(true)
    })

    it('isRef returns false for non-Ref objects', () => {
      expect(isRef(null)).toBe(false)
      expect(isRef(undefined)).toBe(false)
      expect(isRef({ kind: 'identity', id: 'A' })).toBe(false)
      expect(isRef({ ref: 0 })).toBe(false)
      expect(isRef(5)).toBe(false)
    })

    it('isRef returns false for invalid $ref values', () => {
      expect(isRef({ $ref: -1 })).toBe(false) // negative
      expect(isRef({ $ref: 1.5 })).toBe(false) // float
      expect(isRef({ $ref: NaN })).toBe(false) // NaN
      expect(isRef({ $ref: Infinity })).toBe(false) // Infinity
    })

    it('isDedupedExpr returns true for DedupedExpr objects', () => {
      expect(isDedupedExpr({ defs: [], root: { kind: 'identity', id: 'A' } })).toBe(true)
    })

    it('isDedupedExpr returns false for non-DedupedExpr objects', () => {
      expect(isDedupedExpr(null)).toBe(false)
      expect(isDedupedExpr({ kind: 'identity', id: 'A' })).toBe(false)
      expect(isDedupedExpr({ defs: 'not array', root: {} })).toBe(false)
    })
  })

  // ===========================================================================
  // NO DUPLICATES
  // ===========================================================================

  describe('expressions without duplicates', () => {
    it('passes through simple identity', () => {
      const expr = identity('A').build()
      const deduped = dedup(expr)

      expect(deduped.defs).toHaveLength(0)
      expect(deduped.root).toEqual(expr)
    })

    it('passes through unique union', () => {
      const expr = union(identity('A'), identity('B')).build()
      const deduped = dedup(expr)

      expect(deduped.defs).toHaveLength(0)
      expect(deduped.root).toEqual(expr)
    })

    it('passes through unique complex expression', () => {
      const expr = intersect(
        union(identity('A'), identity('B')),
        exclude(identity('C'), identity('D')),
      ).build()
      const deduped = dedup(expr)

      expect(deduped.defs).toHaveLength(0)
      expect(deduped.root).toEqual(expr)
    })
  })

  // ===========================================================================
  // WITH DUPLICATES
  // ===========================================================================

  describe('expressions with duplicates', () => {
    it('extracts shared identity leaf', () => {
      // A appears twice: union(A, intersect(A, B))
      const a = identity('A').build()
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          a,
          {
            kind: 'intersect',
            operands: [a, { kind: 'identity', id: 'B' }],
          },
        ],
      }

      const deduped = dedup(expr)

      expect(deduped.defs).toHaveLength(1)
      expect(deduped.defs[0]).toEqual(a)

      // Root should have refs
      expect(isRef(deduped.root)).toBe(false)
      const root = deduped.root as { kind: 'union'; operands: [Ref, { operands: [Ref, unknown] }] }
      expect(root.operands[0]).toEqual({ $ref: 0 })
      expect(root.operands[1].operands[0]).toEqual({ $ref: 0 })
    })

    it('extracts shared complex subtree', () => {
      // shared = union(A, B) appears twice
      const shared = union(identity('A'), identity('B')).build()
      const expr: IdentityExpr = {
        kind: 'intersect',
        operands: [
          shared,
          {
            kind: 'exclude',
            base: shared,
            excluded: [{ kind: 'identity', id: 'C' }],
          },
        ],
      }

      const deduped = dedup(expr)

      expect(deduped.defs).toHaveLength(1)
      expect(deduped.defs[0]).toEqual(shared)

      // Root should reference the shared subtree
      const root = deduped.root as { kind: 'intersect'; operands: [Ref, { base: Ref }] }
      expect(root.operands[0]).toEqual({ $ref: 0 })
      expect(root.operands[1].base).toEqual({ $ref: 0 })
    })

    it('extracts multiple different duplicates', () => {
      // Both A and B appear twice
      const a = identity('A').build()
      const b = identity('B').build()
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          {
            kind: 'intersect',
            operands: [a, b],
          },
          {
            kind: 'exclude',
            base: a,
            excluded: [b],
          },
        ],
      }

      const deduped = dedup(expr)

      // Should have 2 defs (A and B)
      expect(deduped.defs).toHaveLength(2)
      expect(deduped.defs).toContainEqual(a)
      expect(deduped.defs).toContainEqual(b)
    })

    it('handles deeply nested duplicates', () => {
      // nested = intersect(A, B) appears at multiple depths
      const nested = intersect(identity('A'), identity('B')).build()
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          nested,
          {
            kind: 'union',
            operands: [
              { kind: 'identity', id: 'C' },
              {
                kind: 'exclude',
                base: nested,
                excluded: [{ kind: 'identity', id: 'D' }],
              },
            ],
          },
        ],
      }

      const deduped = dedup(expr)

      expect(deduped.defs).toHaveLength(1)
      expect(deduped.defs[0]).toEqual(nested)
    })
  })

  // ===========================================================================
  // ROUND-TRIP
  // ===========================================================================

  describe('round-trip (expand after dedup)', () => {
    it('round-trips simple identity', () => {
      const expr = identity('A').build()
      expect(expand(dedup(expr))).toEqual(expr)
    })

    it('round-trips expression without duplicates', () => {
      const expr = intersect(
        union(identity('A'), identity('B')),
        exclude(identity('C'), identity('D')),
      ).build()
      expect(expand(dedup(expr))).toEqual(expr)
    })

    it('round-trips expression with shared identity', () => {
      const a = identity('A').build()
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          a,
          {
            kind: 'intersect',
            operands: [a, { kind: 'identity', id: 'B' }],
          },
        ],
      }

      expect(expand(dedup(expr))).toEqual(expr)
    })

    it('round-trips expression with shared complex subtree', () => {
      const shared = union(identity('A'), identity('B')).build()
      const expr: IdentityExpr = {
        kind: 'intersect',
        operands: [
          shared,
          {
            kind: 'exclude',
            base: shared,
            excluded: [{ kind: 'identity', id: 'C' }],
          },
        ],
      }

      expect(expand(dedup(expr))).toEqual(expr)
    })

    it('round-trips the user API example with sharing', () => {
      // Same pattern from user's desired API
      const ref1 = union(identity('X', { nodes: ['node-A'] }), identity('Y')).build()

      // Use ref1 twice (simulating shared reference)
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          ref1,
          {
            kind: 'intersect',
            operands: [ref1, { kind: 'identity', id: 'Z' }],
          },
        ],
      }

      expect(expand(dedup(expr))).toEqual(expr)
    })

    it('round-trips with scoped identities', () => {
      const scoped = identity('USER1', { nodes: ['ws1'], perms: READ }).build()
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          scoped,
          {
            kind: 'intersect',
            operands: [scoped, { kind: 'identity', id: 'B' }],
          },
        ],
      }

      expect(expand(dedup(expr))).toEqual(expr)
    })
  })

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  describe('hasRepeatedSubtrees()', () => {
    it('returns false for unique expression', () => {
      const expr = union(identity('A'), identity('B')).build()
      expect(hasRepeatedSubtrees(expr)).toBe(false)
    })

    it('returns true for expression with duplicates', () => {
      const a = identity('A').build()
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [a, a],
      }
      expect(hasRepeatedSubtrees(expr)).toBe(true)
    })

    it('returns true for nested duplicates', () => {
      const shared = union(identity('A'), identity('B')).build()
      const expr: IdentityExpr = {
        kind: 'intersect',
        operands: [
          shared,
          {
            kind: 'exclude',
            base: shared,
            excluded: [{ kind: 'identity', id: 'C' }],
          },
        ],
      }
      expect(hasRepeatedSubtrees(expr)).toBe(true)
    })
  })

  describe('dedupStats()', () => {
    it('reports correct stats for unique expression', () => {
      const expr = union(identity('A'), identity('B')).build()
      const stats = dedupStats(expr)

      expect(stats.uniqueSubtrees).toBe(3) // union, A, B
      expect(stats.duplicateSubtrees).toBe(0)
      expect(stats.potentialSavings).toBe(0)
    })

    it('reports correct stats for expression with duplicates', () => {
      const a = identity('A').build()
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [a, a],
      }
      const stats = dedupStats(expr)

      expect(stats.uniqueSubtrees).toBe(2) // union, A
      expect(stats.duplicateSubtrees).toBe(1) // A appears twice, 1 duplicate
      expect(stats.potentialSavings).toBeGreaterThan(0)
    })

    it('reports higher savings for more duplicates', () => {
      const a = identity('A').build()
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          {
            kind: 'union',
            operands: [a, a],
          },
          a,
        ],
      }
      const stats = dedupStats(expr)

      expect(stats.duplicateSubtrees).toBe(2) // A appears 3 times, 2 duplicates
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('edge cases', () => {
    it('handles single identity', () => {
      const expr = identity('A').build()
      const deduped = dedup(expr)

      expect(deduped.defs).toHaveLength(0)
      expect(expand(deduped)).toEqual(expr)
    })

    it('handles same identity ID but different scopes as different', () => {
      // Same ID but different scope wrappers = scope nodes are different subtrees
      // However, the inner identity('A') IS shared (same subtree in both wrappers)
      const a1 = identity('A', { nodes: ['ws1'] }).build()
      const a2 = identity('A', { nodes: ['ws2'] }).build()
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [a1, a2],
      }

      const deduped = dedup(expr)
      // Inner identity('A') is shared across both scope wrappers
      expect(deduped.defs).toHaveLength(1)
      expect(expand(deduped)).toEqual(expr)
    })

    it('handles very deep nesting', () => {
      // Build a deep chain
      let expr: IdentityExpr = identity('LEAF').build()
      for (let i = 0; i < 20; i++) {
        expr = { kind: 'union', operands: [expr, { kind: 'identity', id: `N${i}` }] }
      }

      // Should still work
      expect(expand(dedup(expr))).toEqual(expr)
    })

    it('expand throws on invalid ref', () => {
      const invalid: DedupedExpr = {
        defs: [],
        root: { $ref: 999 }, // Invalid ref
      }

      expect(() => expand(invalid)).toThrow('Invalid reference')
    })
  })
})
