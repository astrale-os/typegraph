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
  grant,
  raw,
  isExprBuilder,
} from './expression/builder'
import { applyScope } from './expression/scope'
import type { IdentityExpr, Scope } from './types'
import { READ, EDIT } from './testing/helpers'

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
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }],
        expr: { kind: 'identity', id: 'USER1' },
      })
    })

    it('creates identity with array of scopes', () => {
      const expr = identity('USER1', [{ nodes: ['ws1'] }, { perms: READ }])
      expect(expr.build()).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }, { perms: READ }],
        expr: { kind: 'identity', id: 'USER1' },
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
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }],
        expr: { kind: 'identity', id: 'USER1' },
      })
    })
  })

  describe('.scope()', () => {
    it('adds scope to identity', () => {
      const expr = identity('USER1').scope({ nodes: ['ws1'] })
      expect(expr.build()).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }],
        expr: { kind: 'identity', id: 'USER1' },
      })
    })

    it('chains multiple scope calls', () => {
      const expr = identity('USER1')
        .scope({ nodes: ['ws1'] })
        .scope({ perms: READ })

      expect(expr.build()).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }, { perms: READ }],
        expr: { kind: 'identity', id: 'USER1' },
      })
    })

    it('is immutable - original not modified', () => {
      const original = identity('USER1')
      const restricted = original.scope({ nodes: ['ws1'] })

      expect(original.build()).toEqual({ kind: 'identity', id: 'USER1' })
      expect(restricted.build()).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }],
        expr: { kind: 'identity', id: 'USER1' },
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
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      })
    })

    it('.intersect() creates intersect expression', () => {
      const expr = identity('A').intersect(identity('B'))
      expect(expr.build()).toEqual({
        kind: 'intersect',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      })
    })

    it('.exclude() creates exclude expression', () => {
      const expr = identity('A').exclude(identity('B'))
      expect(expr.build()).toEqual({
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [{ kind: 'identity', id: 'B' }],
      })
    })

    it('flattens chained .exclude() into single exclude with multiple excluded', () => {
      const expr = identity('A').exclude(identity('B')).exclude(identity('C'))

      expect(expr.build()).toEqual({
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [
          { kind: 'identity', id: 'B' },
          { kind: 'identity', id: 'C' },
        ],
      })
    })

    it('chains multiple operations', () => {
      const expr = identity('A')
        .union(identity('B'))
        .intersect(identity('C'))
        .exclude(identity('D'))

      // identity('A').union(identity('B')) => NaryExpr('union', [A, B])
      // .intersect(identity('C')) => NaryExpr is union, not intersect, so new NaryExpr('intersect', [union(A,B), C])
      // .exclude(identity('D')) => NaryExpr is intersect, not ExcludeExpr, so new ExcludeExpr(intersect(...), [D])
      expect(expr.build()).toEqual({
        kind: 'exclude',
        base: {
          kind: 'intersect',
          operands: [
            {
              kind: 'union',
              operands: [
                { kind: 'identity', id: 'A' },
                { kind: 'identity', id: 'B' },
              ],
            },
            { kind: 'identity', id: 'C' },
          ],
        },
        excluded: [{ kind: 'identity', id: 'D' }],
      })
    })
  })

  // ===========================================================================
  // COMPOSITION: FACTORY FUNCTIONS
  // ===========================================================================

  describe('union() factory', () => {
    it('with two expressions creates union', () => {
      const expr = union(identity('A'), identity('B'))
      expect(expr.build()).toEqual({
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      })
    })

    it('with multiple expressions creates flat union', () => {
      const expr = union(identity('A'), identity('B'), identity('C'))
      expect(expr.build()).toEqual({
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
          { kind: 'identity', id: 'C' },
        ],
      })
    })

    it('throws on fewer than 2 expressions', () => {
      expect(() => union()).toThrow('union requires at least 2 expressions')
      expect(() => union(identity('A'))).toThrow('union requires at least 2 expressions')
    })
  })

  describe('intersect() factory', () => {
    it('with two expressions creates intersect', () => {
      const expr = intersect(identity('A'), identity('B'))
      expect(expr.build()).toEqual({
        kind: 'intersect',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      })
    })

    it('with multiple expressions creates flat intersect', () => {
      const expr = intersect(identity('A'), identity('B'), identity('C'))
      expect(expr.build()).toEqual({
        kind: 'intersect',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
          { kind: 'identity', id: 'C' },
        ],
      })
    })

    it('throws on fewer than 2 expressions', () => {
      expect(() => intersect()).toThrow('intersect requires at least 2 expressions')
      expect(() => intersect(identity('A'))).toThrow('intersect requires at least 2 expressions')
    })
  })

  describe('exclude() factory', () => {
    it('creates exclude expression', () => {
      const expr = exclude(identity('A'), identity('B'))
      expect(expr.build()).toEqual({
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [{ kind: 'identity', id: 'B' }],
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
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      }
      const wrapped = raw(rawExpr)

      expect(wrapped.build()).toEqual(rawExpr)
    })

    it('can be composed with other builders', () => {
      const rawExpr: IdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      }
      const composed = raw(rawExpr).intersect(identity('C'))

      expect(composed.build()).toEqual({
        kind: 'intersect',
        operands: [rawExpr, { kind: 'identity', id: 'C' }],
      })
    })

    it('can be used in factory functions', () => {
      const rawExpr: IdentityExpr = { kind: 'identity', id: 'RESOLVED' }
      const composed = union(raw(rawExpr), identity('NEW'))

      expect(composed.build()).toEqual({
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'RESOLVED' },
          { kind: 'identity', id: 'NEW' },
        ],
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
      //   identity("H").scope({ perms: READ }),
      //   restrictedIdentity.exclude(identity("M"))
      // )
      const finalIdentity = intersect(
        identity('H').scope({ perms: READ }),
        restrictedIdentity.exclude(identity('M')),
      )

      const built = finalIdentity.build()

      // Expected tree:
      // intersect(
      //   scope({ perms: READ }, identity("H")),
      //   exclude(
      //     intersect(
      //       union(
      //         scope({ nodes: ["node-A"] }, identity("X")),
      //         identity("Y")
      //       ),
      //       identity("Z")
      //     ),
      //     [identity("M")]
      //   )
      // )
      //
      // ref1 = union(identity('X', { nodes: ['node-A'] }), identity('Y'))
      //   => NaryExpr('union', [ScopeExpr([{nodes:['node-A']}], IdentityExprBuilder('X')), IdentityExprBuilder('Y')])
      // ref1.intersect(identity('Z'))
      //   => NaryExpr is union not intersect, so new NaryExpr('intersect', [ref1, identity('Z')])
      // restrictedIdentity.exclude(identity('M'))
      //   => NaryExpr is intersect not ExcludeExpr, so new ExcludeExpr(restrictedIdentity, [identity('M')])
      // intersect(identity('H').scope(...), restrictedIdentity.exclude(identity('M')))
      //   => NaryExpr('intersect', [ScopeExpr, ExcludeExpr])
      expect(built).toEqual({
        kind: 'intersect',
        operands: [
          {
            kind: 'scope',
            scopes: [{ perms: READ }],
            expr: { kind: 'identity', id: 'H' },
          },
          {
            kind: 'exclude',
            base: {
              kind: 'intersect',
              operands: [
                {
                  kind: 'union',
                  operands: [
                    {
                      kind: 'scope',
                      scopes: [{ nodes: ['node-A'] }],
                      expr: { kind: 'identity', id: 'X' },
                    },
                    { kind: 'identity', id: 'Y' },
                  ],
                },
                { kind: 'identity', id: 'Z' },
              ],
            },
            excluded: [{ kind: 'identity', id: 'M' }],
          },
        ],
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
      const expr = identity('USER1', { nodes: ['ws1'], perms: READ })
      const json = JSON.stringify(expr.build())
      const parsed: IdentityExpr = JSON.parse(json)

      expect(parsed).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'], perms: READ }],
        expr: { kind: 'identity', id: 'USER1' },
      })
    })

    it('round-trips complex expression', () => {
      const expr = union(identity('A', { nodes: ['n1'] }), identity('B'))
        .intersect(identity('C'))
        .exclude(identity('D').scope({ perms: EDIT }))

      const json = JSON.stringify(expr.build())
      const parsed: IdentityExpr = JSON.parse(json)

      expect(parsed).toEqual(expr.build())
    })
  })

  // ===========================================================================
  // applyScope() HELPER
  // ===========================================================================

  describe('applyScope()', () => {
    it('wraps simple identity in scope node', () => {
      const expr: IdentityExpr = { kind: 'identity', id: 'A' }
      const result = applyScope(expr, { nodes: ['ws1'] })

      expect(result).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }],
        expr: { kind: 'identity', id: 'A' },
      })
    })

    it('wraps already-scoped identity in another scope node', () => {
      const expr: IdentityExpr = {
        kind: 'scope',
        scopes: [{ perms: READ }],
        expr: { kind: 'identity', id: 'A' },
      }
      const result = applyScope(expr, { nodes: ['ws1'] })

      expect(result).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }],
        expr: {
          kind: 'scope',
          scopes: [{ perms: READ }],
          expr: { kind: 'identity', id: 'A' },
        },
      })
    })

    it('wraps union expression in scope node', () => {
      const expr: IdentityExpr = {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'A' },
          { kind: 'identity', id: 'B' },
        ],
      }
      const result = applyScope(expr, { nodes: ['ws1'] })

      expect(result).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }],
        expr: {
          kind: 'union',
          operands: [
            { kind: 'identity', id: 'A' },
            { kind: 'identity', id: 'B' },
          ],
        },
      })
    })

    it('wraps complex tree in scope node', () => {
      const expr: IdentityExpr = {
        kind: 'intersect',
        operands: [
          {
            kind: 'union',
            operands: [
              { kind: 'identity', id: 'A' },
              { kind: 'identity', id: 'B' },
            ],
          },
          {
            kind: 'exclude',
            base: { kind: 'identity', id: 'C' },
            excluded: [{ kind: 'identity', id: 'D' }],
          },
        ],
      }

      const result = applyScope(expr, { nodes: ['ws1'] })

      expect(result).toEqual({
        kind: 'scope',
        scopes: [{ nodes: ['ws1'] }],
        expr: {
          kind: 'intersect',
          operands: [
            {
              kind: 'union',
              operands: [
                { kind: 'identity', id: 'A' },
                { kind: 'identity', id: 'B' },
              ],
            },
            {
              kind: 'exclude',
              base: { kind: 'identity', id: 'C' },
              excluded: [{ kind: 'identity', id: 'D' }],
            },
          ],
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
          operands: [
            {
              kind: 'union',
              operands: [
                { kind: 'identity', id: 'USER1' },
                { kind: 'identity', id: 'ROLE1' },
              ],
            },
            { kind: 'identity', id: 'GROUP1' },
          ],
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

    it('returns true for NaryExpr', () => {
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
