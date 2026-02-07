/**
 * AUTH_V2 Scope Utilities Tests
 *
 * Tests for proper scope intersection logic.
 */

import { describe, expect, it } from 'vitest'
import { intersectScope, intersectScopes } from '../integration/authz-v2/expression/scope'
import type { Scope } from '../integration/authz-v2/types'
import { READ, EDIT, USE, SHARE } from '../integration/authz-v2/testing/helpers'

describe('Scope Intersection', () => {
  describe('intersectScope (single scope)', () => {
    it('intersects nodes arrays', () => {
      const a: Scope = { nodes: ['ws-1', 'ws-2'] }
      const b: Scope = { nodes: ['ws-1', 'ws-3'] }

      const result = intersectScope(a, b)

      expect(result).toEqual({ nodes: ['ws-1'] })
    })

    it('intersects perms bitmasks', () => {
      const a: Scope = { perms: READ | EDIT }
      const b: Scope = { perms: READ }

      const result = intersectScope(a, b)

      expect(result).toEqual({ perms: READ })
    })

    it('intersects principals arrays', () => {
      const a: Scope = { principals: ['user-1', 'user-2'] }
      const b: Scope = { principals: ['user-2', 'user-3'] }

      const result = intersectScope(a, b)

      expect(result).toEqual({ principals: ['user-2'] })
    })

    it('intersects all dimensions together', () => {
      const a: Scope = { nodes: ['ws-1', 'ws-2'], perms: READ | EDIT }
      const b: Scope = { nodes: ['ws-1'], perms: READ }

      const result = intersectScope(a, b)

      expect(result).toEqual({ nodes: ['ws-1'], perms: READ })
    })

    it('undefined means unrestricted - other wins', () => {
      const a: Scope = { nodes: ['ws-1'] }
      const b: Scope = { perms: READ }

      const result = intersectScope(a, b)

      // nodes from a, perms from b
      expect(result).toEqual({ nodes: ['ws-1'], perms: READ })
    })

    it('both undefined = unrestricted (empty object)', () => {
      const a: Scope = {}
      const b: Scope = {}

      const result = intersectScope(a, b)

      expect(result).toEqual({})
    })

    it('returns null if intersection is empty', () => {
      const a: Scope = { nodes: ['ws-1'] }
      const b: Scope = { nodes: ['ws-2'] } // No overlap

      const result = intersectScope(a, b)

      expect(result).toBeNull()
    })

    it('returns null if any dimension becomes empty', () => {
      const a: Scope = { nodes: ['ws-1', 'ws-2'], perms: READ }
      const b: Scope = { nodes: ['ws-1'], perms: EDIT } // perms don't overlap (READ & EDIT = 0)

      const result = intersectScope(a, b)

      expect(result).toBeNull()
    })
  })

  describe('intersectScopes (arrays of scopes)', () => {
    it('pairwise intersection of scope arrays', () => {
      const a: Scope[] = [{ nodes: ['ws-1'], perms: READ }]
      const b: Scope[] = [{ nodes: ['ws-1', 'ws-2'], perms: READ | EDIT }]

      const result = intersectScopes(a, b)

      // ws-1 ∩ (ws-1, ws-2) = ws-1
      // READ & (READ | EDIT) = READ
      expect(result).toEqual([{ nodes: ['ws-1'], perms: READ }])
    })

    it('multiple scopes produce multiple intersections', () => {
      const a: Scope[] = [
        { nodes: ['ws-1'], perms: READ },
        { nodes: ['ws-2'], perms: EDIT },
      ]
      const b: Scope[] = [{ nodes: ['ws-1', 'ws-2'] }]

      const result = intersectScopes(a, b)

      // First scope: ws-1 ∩ (ws-1, ws-2) = ws-1
      // Second scope: ws-2 ∩ (ws-1, ws-2) = ws-2
      expect(result).toHaveLength(2)
      expect(result).toContainEqual({ nodes: ['ws-1'], perms: READ })
      expect(result).toContainEqual({ nodes: ['ws-2'], perms: EDIT })
    })

    it('filters out impossible intersections', () => {
      const a: Scope[] = [{ nodes: ['ws-1'] }, { nodes: ['ws-2'] }]
      const b: Scope[] = [{ nodes: ['ws-1'] }] // Only ws-1 allowed

      const result = intersectScopes(a, b)

      // Only the first scope intersects successfully
      expect(result).toEqual([{ nodes: ['ws-1'] }])
    })

    it('empty input = unrestricted', () => {
      const a: Scope[] = []
      const b: Scope[] = [{ nodes: ['ws-1'] }]

      expect(intersectScopes(a, b)).toEqual(b)
      expect(intersectScopes(b, a)).toEqual(b)
    })

    it('deduplicates identical results', () => {
      const a: Scope[] = [{ nodes: ['ws-1'] }, { nodes: ['ws-1'] }]
      const b: Scope[] = [{ nodes: ['ws-1'] }]

      const result = intersectScopes(a, b)

      // Should deduplicate
      expect(result).toEqual([{ nodes: ['ws-1'] }])
    })

    it('returns empty array if no valid intersections', () => {
      const a: Scope[] = [{ nodes: ['ws-1'] }]
      const b: Scope[] = [{ nodes: ['ws-2'] }]

      const result = intersectScopes(a, b)

      expect(result).toEqual([])
    })
  })

  describe('Real-world scenarios', () => {
    it('restricting read-only user to specific workspace', () => {
      // User has read permission on workspace-1 and workspace-2
      const userScopes: Scope[] = [{ nodes: ['ws-1', 'ws-2'], perms: READ }]

      // App restricts to workspace-1 only
      const appScopes: Scope[] = [{ nodes: ['ws-1'] }]

      const result = intersectScopes(userScopes, appScopes)

      // Result: read on ws-1 only
      expect(result).toEqual([{ nodes: ['ws-1'], perms: READ }])
    })

    it('multi-hop restriction accumulates', () => {
      // User has broad permissions
      const userScopes: Scope[] = [{ nodes: ['ws-1', 'ws-2'], perms: READ | EDIT }]

      // App A restricts to ws-1
      const appAScopes: Scope[] = [{ nodes: ['ws-1'] }]
      const afterAppA = intersectScopes(userScopes, appAScopes)

      // App B restricts to read-only
      const appBScopes: Scope[] = [{ perms: READ }]
      const afterAppB = intersectScopes(afterAppA, appBScopes)

      // Final result: read-only on ws-1
      expect(afterAppB).toEqual([{ nodes: ['ws-1'], perms: READ }])
    })

    it('union of user + role gets restricted together', () => {
      // User can read ws-1, Role can write ws-2
      const combinedScopes: Scope[] = [
        { nodes: ['ws-1'], perms: READ },
        { nodes: ['ws-2'], perms: EDIT },
      ]

      // App restricts to ws-1 only
      const appScopes: Scope[] = [{ nodes: ['ws-1'] }]

      const result = intersectScopes(combinedScopes, appScopes)

      // Only user's ws-1 permission survives
      expect(result).toEqual([{ nodes: ['ws-1'], perms: READ }])
    })
  })
})

