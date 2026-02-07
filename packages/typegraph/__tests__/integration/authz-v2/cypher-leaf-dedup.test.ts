/**
 * AUTH_V2 Tests: Cypher Leaf Deduplication
 *
 * Tests that duplicate identity leaves in expression trees produce
 * deduplicated CALL blocks — same (id, perm, scopeNodeIds) triple
 * reuses the existing variable instead of emitting a new CALL block.
 */

import { describe, it, expect } from 'vitest'
import { toCypher, type CypherOptions } from './adapter/cypher'
import type { PrunedIdentityExpr } from './types'
import { DEFAULT_VOCAB } from './adapter/vocabulary'
import { READ, EDIT } from './testing/helpers'

const opts: CypherOptions = { maxDepth: 20, vocab: DEFAULT_VOCAB }

describe('AUTH_V2: Cypher Leaf Deduplication', () => {
  // ===========================================================================
  // DUPLICATE LEAF → FEWER CALL BLOCKS
  // ===========================================================================

  describe('duplicate leaf produces fewer CALL blocks', () => {
    it('deduplicates carol in UNION(carol, EXCLUDE(alice, INTERSECT(bob, carol)))', () => {
      // carol appears at operands[0] and exclude.base→intersect.operands[1]
      const expr: PrunedIdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'USER-carol' },
          {
            kind: 'exclude',
            base: { kind: 'identity', id: 'USER-alice' },
            excluded: [
              {
                kind: 'intersect',
                operands: [
                  { kind: 'identity', id: 'USER-bob' },
                  { kind: 'identity', id: 'USER-carol' },
                ],
              },
            ],
          },
        ],
      }

      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()

      // 3 CALL blocks (carol, alice, bob) — NOT 4
      expect(fragment!.calls).toHaveLength(3)

      // 3 vars (_c0, _c1, _c2)
      expect(fragment!.vars).toHaveLength(3)

      // Condition reuses _c0 for both carol occurrences
      expect(fragment!.condition).toBe('(_c0 OR (_c1 AND NOT ((_c2 AND _c0))))')

      // Only 3 param pairs (id_0..2, perm_0..2)
      expect(Object.keys(fragment!.params)).toHaveLength(6)
    })

    it('deduplicates identity appearing in both sides of union', () => {
      const expr: PrunedIdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'A' },
        ],
      }

      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()

      // Only 1 CALL block — second A reuses _c0
      expect(fragment!.calls).toHaveLength(1)
      expect(fragment!.vars).toHaveLength(1)
      expect(fragment!.condition).toBe('(_c0 OR _c0)')
    })

    it('deduplicates identity appearing three times', () => {
      const expr: PrunedIdentityExpr = {
        kind: 'union',
        operands: [
          {
            kind: 'union',
            operands: [
              { kind: 'identity', id: 'X' },
              { kind: 'identity', id: 'X' },
            ],
          },
          { kind: 'identity', id: 'X' },
        ],
      }

      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()

      // Only 1 CALL block
      expect(fragment!.calls).toHaveLength(1)
      expect(fragment!.vars).toHaveLength(1)
    })
  })

  // ===========================================================================
  // NO DUPLICATES → NO CHANGE
  // ===========================================================================

  describe('expressions without duplicates are unchanged', () => {
    it('unique leaves produce one CALL block each', () => {
      const expr: PrunedIdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      }

      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()

      expect(fragment!.calls).toHaveLength(2)
      expect(fragment!.vars).toHaveLength(2)
      expect(fragment!.condition).toBe('(_c0 OR _c1)')
    })

    it('single identity produces exactly one CALL block', () => {
      const expr: PrunedIdentityExpr = { kind: 'identity', id: 'SOLO' }

      const fragment = toCypher(expr, EDIT, opts)
      expect(fragment).not.toBeNull()

      expect(fragment!.calls).toHaveLength(1)
      expect(fragment!.vars).toHaveLength(1)
      expect(fragment!.condition).toBe('_c0')
    })
  })

  // ===========================================================================
  // DIFFERENT NODE RESTRICTIONS → NOT DEDUPLICATED
  // ===========================================================================

  describe('same id with different node restrictions are NOT deduplicated', () => {
    it('different node restrictions produce separate CALL blocks', () => {
      const expr: PrunedIdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'USER1', nodeRestriction: ['ws1'] },
          { kind: 'identity', id: 'USER1', nodeRestriction: ['ws2'] },
        ],
      }

      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()

      // 2 CALL blocks — different node restrictions = different cache keys
      expect(fragment!.calls).toHaveLength(2)
      expect(fragment!.vars).toHaveLength(4) // _c0, _s0, _c1, _s1
    })

    it('restricted vs unrestricted same id produce separate CALL blocks', () => {
      const expr: PrunedIdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'USER1' },
          { kind: 'identity', id: 'USER1', nodeRestriction: ['ws1'] },
        ],
      }

      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()

      // 2 CALL blocks — one unrestricted, one restricted
      expect(fragment!.calls).toHaveLength(2)
    })
  })

  // ===========================================================================
  // SAME NODE RESTRICTIONS → DEDUPLICATED
  // ===========================================================================

  describe('same id with same node restrictions ARE deduplicated', () => {
    it('identical restricted identities produce one CALL block', () => {
      const expr: PrunedIdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'USER1', nodeRestriction: ['ws1'] },
          { kind: 'identity', id: 'USER1', nodeRestriction: ['ws1'] },
        ],
      }

      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()

      // Only 1 CALL block — same (id, perm, nodeRestriction)
      expect(fragment!.calls).toHaveLength(1)
      // Only the first occurrence's vars
      expect(fragment!.vars).toHaveLength(2) // _c0, _s0
    })

    it('node restriction order does not affect deduplication', () => {
      // nodeRestriction: ['a', 'b'] and nodeRestriction: ['b', 'a'] should dedup
      const expr: PrunedIdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'USER1', nodeRestriction: ['a', 'b'] },
          { kind: 'identity', id: 'USER1', nodeRestriction: ['b', 'a'] },
        ],
      }

      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()

      // Deduplicated: same nodes after sorting
      expect(fragment!.calls).toHaveLength(1)
    })

    it('exclude with multiple excluded produces NOT (... OR ...) condition', () => {
      const expr: PrunedIdentityExpr = {
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [
          { kind: 'identity', id: 'B' },
          { kind: 'identity', id: 'C' },
        ],
      }
      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()
      expect(fragment!.calls).toHaveLength(3)
      expect(fragment!.condition).toBe('(_c0 AND NOT (_c1 OR _c2))')
    })

    it('deduplicates identity leaves with different nodeRestriction order', () => {
      const expr: PrunedIdentityExpr = {
        kind: 'intersect',
        operands: [
          { kind: 'identity', id: 'USER1', nodeRestriction: ['ws2', 'ws1'] },
          { kind: 'identity', id: 'USER1', nodeRestriction: ['ws1', 'ws2'] },
        ],
      }
      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()
      // Same identity + same sorted nodeRestriction → deduplicates to 1 CALL block
      expect(fragment!.calls).toHaveLength(1)
    })
  })

  // ===========================================================================
  // DIFFERENT PERMISSIONS → NOT DEDUPLICATED
  // ===========================================================================

  describe('same id checked with different perms across calls', () => {
    it('same identity in separate toCypher calls with different perms are independent', () => {
      const expr: PrunedIdentityExpr = { kind: 'identity', id: 'USER1' }

      const frag1 = toCypher(expr, READ, opts)
      const frag2 = toCypher(expr, EDIT, opts)

      // Each call creates its own cache — both produce 1 CALL block
      expect(frag1!.calls).toHaveLength(1)
      expect(frag2!.calls).toHaveLength(1)

      // Params reflect different perms
      expect(frag1!.params['perm_0']).toBe(READ)
      expect(frag2!.params['perm_0']).toBe(EDIT)
    })
  })

  // ===========================================================================
  // PRUNED EXPRESSION DEDUP (NO PRINCIPAL FILTERING AT CYPHER LEVEL)
  // ===========================================================================

  describe('pruned expression dedup works correctly', () => {
    it('unrestricted duplicate leaves are deduplicated', () => {
      // Both leaves are unrestricted (no nodeRestriction) with same id
      const expr: PrunedIdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'USER1' },
          { kind: 'identity', id: 'USER2' },
        ],
      }

      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()

      // 2 different identities → 2 CALL blocks
      expect(fragment!.calls).toHaveLength(2)
    })

    it('identical unrestricted leaves produce one CALL block', () => {
      // Same ID, no node restriction on either
      const expr: PrunedIdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'USER1' },
          { kind: 'identity', id: 'USER1' },
        ],
      }

      const fragment = toCypher(expr, READ, opts)
      expect(fragment).not.toBeNull()

      // Deduplicated: same (id, perm, no restriction)
      expect(fragment!.calls).toHaveLength(1)
    })
  })
})
