/**
 * AUTH_V2 Tests: Expression Pruning
 *
 * Tests for the pruning phase that evaluates scope nodes
 * and produces PrunedIdentityExpr with algebraic simplification.
 */

import { describe, it, expect } from 'vitest'
import { pruneExpression, intersectNodeRestrictions } from './expression/prune'
import type { IdentityExpr, PrunedIdentityExpr } from './types'
import { READ } from './testing/helpers'

describe('AUTH_V2: Expression Pruning', () => {
  // ===========================================================================
  // IDENTITY LEAVES (pass-through)
  // ===========================================================================

  describe('identity leaves', () => {
    it('passes through simple identity', () => {
      const expr: IdentityExpr = { kind: 'identity', id: 'USER1' }
      const result = pruneExpression(expr, 'PRINCIPAL', READ)

      expect(result).toEqual({ kind: 'identity', id: 'USER1' })
    })

    it('does not add nodeRestriction when none exists', () => {
      const expr: IdentityExpr = { kind: 'identity', id: 'USER1' }
      const result = pruneExpression(expr, 'PRINCIPAL', READ) as PrunedIdentityExpr

      expect(result.kind).toBe('identity')
      expect('nodeRestriction' in result).toBe(false)
    })
  })

  // ===========================================================================
  // SCOPE EVALUATION
  // ===========================================================================

  describe('scope evaluation', () => {
    it('passes scope when principal matches', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ principals: ['P1'] }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toEqual({ kind: 'identity', id: 'USER1' })
    })

    it('returns null when principal does not match', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ principals: ['P1'] }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'OTHER', READ)

      expect(result).toBeNull()
    })

    it('passes scope when perm matches', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ perms: 3 }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toEqual({ kind: 'identity', id: 'USER1' })
    })

    it('returns null when perm does not match', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ perms: 2 }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toBeNull()
    })

    it('propagates node restriction to identity leaf', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: ['N1', 'N2'] }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toEqual({
        kind: 'identity',
        id: 'USER1',
        nodeRestriction: ['N1', 'N2'],
      })
    })

    it('OR semantics: any passing scope allows access', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ principals: ['WRONG'] }, { perms: 1 }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)

      // Second scope passes (perm matches), so the whole scope passes
      expect(result).toEqual({ kind: 'identity', id: 'USER1' })
    })

    it('returns null when all scopes fail', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ principals: ['WRONG'] }, { perms: 2 }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toBeNull()
    })

    it('scope with principals: [] denies all principals', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ principals: [] }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)
      expect(result).toBeNull()
    })

    it('scope with perms: 0 denies all permissions', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ perms: 0 }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)
      expect(result).toBeNull()
    })

    it('unions node restrictions from multiple passing scopes', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: ['N1'] }, { nodes: ['N2'] }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)

      // Both scopes pass (unrestricted principal/perm), nodes are union'd
      expect(result).toEqual({
        kind: 'identity',
        id: 'USER1',
        nodeRestriction: expect.arrayContaining(['N1', 'N2']),
      })
    })

    it('unrestricted scope overrides node restrictions', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [
          { nodes: ['N1'] },
          {}, // unrestricted scope
        ],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)

      // Unrestricted scope wins — no nodeRestriction
      expect(result).toEqual({ kind: 'identity', id: 'USER1' })
    })

    it('nested scopes intersect node restrictions', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: ['N1', 'N2', 'N3'] }],
        expr: {
          kind: 'scope',
          scopes: [{ nodes: ['N2', 'N3', 'N4'] }],
          expr: { kind: 'identity', id: 'USER1' },
        },
      }
      const result = pruneExpression(expr, 'P1', READ)

      // Intersection of [N1,N2,N3] and [N2,N3,N4] = [N2,N3]
      expect(result).toEqual({
        kind: 'identity',
        id: 'USER1',
        nodeRestriction: expect.arrayContaining(['N2', 'N3']),
      })
      expect((result as any).nodeRestriction).toHaveLength(2)
    })

    it('rejects scope when principal matches but perm does not (AND within scope)', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ principals: ['P1'], perms: 2 }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)
      expect(result).toBeNull()
    })

    it('passes scope when both principal AND perm match', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ principals: ['P1'], perms: 1 }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)
      expect(result).toEqual({ kind: 'identity', id: 'USER1' })
    })

    it('rejects scope with principal restriction when principal is undefined', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ principals: ['P1'] }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, undefined, READ)
      expect(result).toBeNull()
    })

    it('passes scope without principal restriction when principal is undefined', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ perms: 1 }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, undefined, READ)
      expect(result).toEqual({ kind: 'identity', id: 'USER1' })
    })

    it('disjoint nested scope node restrictions → null (dead branch)', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: ['N1'] }],
        expr: {
          kind: 'scope',
          scopes: [{ nodes: ['N2'] }],
          expr: { kind: 'identity', id: 'USER1' },
        },
      }
      const result = pruneExpression(expr, 'P1', READ)
      expect(result).toBeNull()
    })

    it('scope with nodes: [] allows no nodes (not unrestricted)', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: [] }],
        expr: { kind: 'identity', id: 'USER1' },
      }
      const result = pruneExpression(expr, 'P1', READ)
      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // UNION SIMPLIFICATION
  // ===========================================================================

  describe('union simplification', () => {
    it('preserves all operands when none are null', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toEqual({
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      })
    })

    it('A ∪ ∅ = A (filters null operands)', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A' },
          {
            kind: 'scope',
            scopes: [{ principals: ['WRONG'] }],
            expr: { kind: 'identity', id: 'B' },
          },
        ],
      }
      const result = pruneExpression(expr, 'P1', READ)

      // Second operand is null (scope rejected), unwraps to single operand
      expect(result).toEqual({ kind: 'identity', id: 'A' })
    })

    it('∅ ∪ ∅ = null (all null → null)', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          {
            kind: 'scope',
            scopes: [{ principals: ['WRONG'] }],
            expr: { kind: 'identity', id: 'A' },
          },
          {
            kind: 'scope',
            scopes: [{ principals: ['WRONG'] }],
            expr: { kind: 'identity', id: 'B' },
          },
        ],
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toBeNull()
    })

    it('unwraps singleton union', () => {
      // 3 operands, 2 pruned away → unwraps the remaining one
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          {
            kind: 'scope',
            scopes: [{ principals: ['WRONG'] }],
            expr: { kind: 'identity', id: 'A' },
          },
          { kind: 'identity', id: 'B' },
          {
            kind: 'scope',
            scopes: [{ principals: ['WRONG'] }],
            expr: { kind: 'identity', id: 'C' },
          },
        ],
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toEqual({ kind: 'identity', id: 'B' })
    })
  })

  // ===========================================================================
  // INTERSECT SIMPLIFICATION
  // ===========================================================================

  describe('intersect simplification', () => {
    it('preserves all operands when none are null', () => {
      const expr: IdentityExpr = {
        kind: 'intersect',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toEqual({
        kind: 'intersect',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      })
    })

    it('A ∩ ∅ = ∅ (any null operand → whole thing null)', () => {
      const expr: IdentityExpr = {
        kind: 'intersect',
        operands: [
          { kind: 'identity', id: 'A' },
          {
            kind: 'scope',
            scopes: [{ principals: ['WRONG'] }],
            expr: { kind: 'identity', id: 'B' },
          },
        ],
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toBeNull()
    })
  })

  // ===========================================================================
  // EXCLUDE SIMPLIFICATION
  // ===========================================================================

  describe('exclude simplification', () => {
    it('preserves exclude when all parts are non-null', () => {
      const expr: IdentityExpr = {
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [{ kind: 'identity', id: 'B' }],
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toEqual({
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [{ kind: 'identity', id: 'B' }],
      })
    })

    it('∅ \\ A = ∅ (null base → null)', () => {
      const expr: IdentityExpr = {
        kind: 'exclude',
        base: {
          kind: 'scope',
          scopes: [{ principals: ['WRONG'] }],
          expr: { kind: 'identity', id: 'A' },
        },
        excluded: [{ kind: 'identity', id: 'B' }],
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toBeNull()
    })

    it('A \\ ∅ = A (null excluded → just base)', () => {
      const expr: IdentityExpr = {
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [
          {
            kind: 'scope',
            scopes: [{ principals: ['WRONG'] }],
            expr: { kind: 'identity', id: 'B' },
          },
        ],
      }
      const result = pruneExpression(expr, 'P1', READ)

      // Excluded is null, so just returns base
      expect(result).toEqual({ kind: 'identity', id: 'A' })
    })

    it('drops null excluded but keeps non-null ones', () => {
      const expr: IdentityExpr = {
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [
          {
            kind: 'scope',
            scopes: [{ principals: ['WRONG'] }],
            expr: { kind: 'identity', id: 'B' },
          },
          { kind: 'identity', id: 'C' },
        ],
      }
      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toEqual({
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [{ kind: 'identity', id: 'C' }],
      })
    })
  })

  // ===========================================================================
  // COMPLEX EXPRESSIONS
  // ===========================================================================

  describe('complex expressions', () => {
    it('prunes scope within union', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          {
            kind: 'scope',
            scopes: [{ perms: 1 }],
            expr: { kind: 'identity', id: 'A' },
          },
          {
            kind: 'scope',
            scopes: [{ perms: 2 }],
            expr: { kind: 'identity', id: 'B' },
          },
          { kind: 'identity', id: 'C' },
        ],
      }

      const result = pruneExpression(expr, 'P1', READ)

      // A passes (perm=read), B fails (perm=write), C passes (no scope)
      expect(result).toEqual({
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'C' },
        ],
      })
    })

    it('propagates node restriction through nested expressions', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: ['N1', 'N2'] }],
        expr: {
          kind: 'union',
          operands: [
            { kind: 'identity', id: 'A' },
            { kind: 'identity', id: 'B' },
          ],
        },
      }

      const result = pruneExpression(expr, 'P1', READ)

      expect(result).toEqual({
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A', nodeRestriction: ['N1', 'N2'] },
          { kind: 'identity', id: 'B', nodeRestriction: ['N1', 'N2'] },
        ],
      })
    })

    it('propagates node restriction through intersect', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: ['N1', 'N2'] }],
        expr: {
          kind: 'intersect',
          operands: [
            { kind: 'identity', id: 'A' },
            { kind: 'identity', id: 'B' },
          ],
        },
      }
      const result = pruneExpression(expr, 'P1', READ)
      expect(result).toEqual({
        kind: 'intersect',
        operands: [
          { kind: 'identity', id: 'A', nodeRestriction: ['N1', 'N2'] },
          { kind: 'identity', id: 'B', nodeRestriction: ['N1', 'N2'] },
        ],
      })
    })

    it('propagates node restriction through exclude base and excluded', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ nodes: ['N1'] }],
        expr: {
          kind: 'exclude',
          base: { kind: 'identity', id: 'A' },
          excluded: [{ kind: 'identity', id: 'B' }],
        },
      }
      const result = pruneExpression(expr, 'P1', READ)
      expect(result).toEqual({
        kind: 'exclude',
        base: { kind: 'identity', id: 'A', nodeRestriction: ['N1'] },
        excluded: [{ kind: 'identity', id: 'B', nodeRestriction: ['N1'] }],
      })
    })
  })

  // ===========================================================================
  // intersectNodeRestrictions
  // ===========================================================================

  describe('intersectNodeRestrictions()', () => {
    it('both undefined → undefined', () => {
      expect(intersectNodeRestrictions(undefined, undefined)).toBeUndefined()
    })

    it('a undefined → b', () => {
      expect(intersectNodeRestrictions(undefined, ['N1'])).toEqual(['N1'])
    })

    it('b undefined → a', () => {
      expect(intersectNodeRestrictions(['N1'], undefined)).toEqual(['N1'])
    })

    it('both defined → intersection', () => {
      expect(intersectNodeRestrictions(['N1', 'N2'], ['N2', 'N3'])).toEqual(['N2'])
    })

    it('disjoint → empty array', () => {
      expect(intersectNodeRestrictions(['N1'], ['N2'])).toEqual([])
    })
  })
})
