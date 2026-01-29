/**
 * AUTH_V2 Tests: Cypher Leaf Deduplication
 *
 * Tests that duplicate identity leaves in expression trees produce
 * deduplicated CALL blocks — same (id, perm, scopeNodeIds) triple
 * reuses the existing variable instead of emitting a new CALL block.
 */

import { describe, it, expect } from 'vitest'
import { toCypher, type CypherOptions } from './adapter/cypher'
import type { IdentityExpr } from './types'
import { DEFAULT_VOCAB } from './adapter/vocabulary'

const opts: CypherOptions = { maxDepth: 20, vocab: DEFAULT_VOCAB }

describe('AUTH_V2: Cypher Leaf Deduplication', () => {
  // ===========================================================================
  // DUPLICATE LEAF → FEWER CALL BLOCKS
  // ===========================================================================

  describe('duplicate leaf produces fewer CALL blocks', () => {
    it('deduplicates carol in UNION(carol, EXCLUDE(alice, INTERSECT(bob, carol)))', () => {
      // carol appears at [0] and [1,1,1]
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'USER-carol' },
        right: {
          kind: 'exclude',
          left: { kind: 'identity', id: 'USER-alice' },
          right: {
            kind: 'intersect',
            left: { kind: 'identity', id: 'USER-bob' },
            right: { kind: 'identity', id: 'USER-carol' },
          },
        },
      }

      const fragment = toCypher(expr, 'target', 'read', undefined, opts)
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
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'A' },
      }

      const fragment = toCypher(expr, 'target', 'read', undefined, opts)
      expect(fragment).not.toBeNull()

      // Only 1 CALL block — second A reuses _c0
      expect(fragment!.calls).toHaveLength(1)
      expect(fragment!.vars).toHaveLength(1)
      expect(fragment!.condition).toBe('(_c0 OR _c0)')
    })

    it('deduplicates identity appearing three times', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        left: {
          kind: 'union',
          left: { kind: 'identity', id: 'X' },
          right: { kind: 'identity', id: 'X' },
        },
        right: { kind: 'identity', id: 'X' },
      }

      const fragment = toCypher(expr, 'target', 'read', undefined, opts)
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
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'A' },
        right: { kind: 'identity', id: 'B' },
      }

      const fragment = toCypher(expr, 'target', 'read', undefined, opts)
      expect(fragment).not.toBeNull()

      expect(fragment!.calls).toHaveLength(2)
      expect(fragment!.vars).toHaveLength(2)
      expect(fragment!.condition).toBe('(_c0 OR _c1)')
    })

    it('single identity produces exactly one CALL block', () => {
      const expr: IdentityExpr = { kind: 'identity', id: 'SOLO' }

      const fragment = toCypher(expr, 'target', 'edit', undefined, opts)
      expect(fragment).not.toBeNull()

      expect(fragment!.calls).toHaveLength(1)
      expect(fragment!.vars).toHaveLength(1)
      expect(fragment!.condition).toBe('_c0')
    })
  })

  // ===========================================================================
  // DIFFERENT SCOPES → NOT DEDUPLICATED
  // ===========================================================================

  describe('same id with different scopes are NOT deduplicated', () => {
    it('different node scopes produce separate CALL blocks', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'USER1', scopes: [{ nodes: ['ws1'] }] },
        right: { kind: 'identity', id: 'USER1', scopes: [{ nodes: ['ws2'] }] },
      }

      const fragment = toCypher(expr, 'target', 'read', undefined, opts)
      expect(fragment).not.toBeNull()

      // 2 CALL blocks — different scope nodes = different cache keys
      expect(fragment!.calls).toHaveLength(2)
      expect(fragment!.vars).toHaveLength(4) // _c0, _s0, _c1, _s1
    })

    it('scoped vs unscoped same id produce separate CALL blocks', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'USER1' },
        right: { kind: 'identity', id: 'USER1', scopes: [{ nodes: ['ws1'] }] },
      }

      const fragment = toCypher(expr, 'target', 'read', undefined, opts)
      expect(fragment).not.toBeNull()

      // 2 CALL blocks — one unscoped, one scoped
      expect(fragment!.calls).toHaveLength(2)
    })
  })

  // ===========================================================================
  // SAME SCOPES → DEDUPLICATED
  // ===========================================================================

  describe('same id with same scopes ARE deduplicated', () => {
    it('identical scoped identities produce one CALL block', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'USER1', scopes: [{ nodes: ['ws1'] }] },
        right: { kind: 'identity', id: 'USER1', scopes: [{ nodes: ['ws1'] }] },
      }

      const fragment = toCypher(expr, 'target', 'read', undefined, opts)
      expect(fragment).not.toBeNull()

      // Only 1 CALL block — same (id, perm, scopeNodeIds)
      expect(fragment!.calls).toHaveLength(1)
      // Only the first occurrence's vars
      expect(fragment!.vars).toHaveLength(2) // _c0, _s0
    })

    it('scope node order does not affect deduplication', () => {
      // nodes: ['a', 'b'] and nodes: ['b', 'a'] should dedup
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'USER1', scopes: [{ nodes: ['a', 'b'] }] },
        right: { kind: 'identity', id: 'USER1', scopes: [{ nodes: ['b', 'a'] }] },
      }

      const fragment = toCypher(expr, 'target', 'read', undefined, opts)
      expect(fragment).not.toBeNull()

      // Deduplicated: same nodes after sorting
      expect(fragment!.calls).toHaveLength(1)
    })
  })

  // ===========================================================================
  // DIFFERENT PERMISSIONS → NOT DEDUPLICATED
  // ===========================================================================

  describe('same id checked with different perms across calls', () => {
    it('same identity in separate toCypher calls with different perms are independent', () => {
      const expr: IdentityExpr = { kind: 'identity', id: 'USER1' }

      const frag1 = toCypher(expr, 'target', 'read', undefined, opts)
      const frag2 = toCypher(expr, 'target', 'edit', undefined, opts)

      // Each call creates its own cache — both produce 1 CALL block
      expect(frag1!.calls).toHaveLength(1)
      expect(frag2!.calls).toHaveLength(1)

      // Params reflect different perms
      expect(frag1!.params['perm_0']).toBe('read')
      expect(frag2!.params['perm_0']).toBe('edit')
    })
  })

  // ===========================================================================
  // PRINCIPAL FILTERING + DEDUP INTERACTION
  // ===========================================================================

  describe('principal filtering interacts correctly with dedup', () => {
    it('filtered leaves return null without polluting cache', () => {
      // Both leaves have principal restriction that does not match
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'USER1', scopes: [{ principals: ['other'] }] },
        right: { kind: 'identity', id: 'USER2' },
      }

      const fragment = toCypher(expr, 'target', 'read', 'me', opts)
      expect(fragment).not.toBeNull()

      // USER1 is filtered (null), only USER2 produces a CALL block
      expect(fragment!.calls).toHaveLength(1)
      expect(fragment!.condition).toBe('_c0')
    })

    it('identical leaves where one is filtered still generate the non-filtered one', () => {
      // Same ID, but first has restricting scope and second does not
      const expr: IdentityExpr = {
        kind: 'union',
        left: { kind: 'identity', id: 'USER1', scopes: [{ principals: ['other'] }] },
        right: { kind: 'identity', id: 'USER1' },
      }

      const fragment = toCypher(expr, 'target', 'read', 'me', opts)
      expect(fragment).not.toBeNull()

      // First is filtered → null (never reaches cache). Second generates normally.
      expect(fragment!.calls).toHaveLength(1)
    })
  })
})
