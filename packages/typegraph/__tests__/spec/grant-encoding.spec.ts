/**
 * AUTH_V2 Grant Encoding Tests
 *
 * Unit tests for encode/decode round-trips and validation.
 */

import { describe, expect, it } from 'vitest'
import {
  applyTopLevelScopes,
  createUnresolvedGrant,
  decodeGrant,
  encodeGrant,
  extractPrimaryIdentity,
  intersectScopes,
  resolveExpression,
  unresolvedExclude,
  unresolvedId,
  unresolvedIntersect,
  unresolvedJwt,
  unresolvedUnion,
  validateUnresolvedExpr,
  validateUnresolvedGrant,
  type JwtVerifier,
} from '../integration/authz-v2/grant-encoding'
import type { Grant, IdentityExpr, Scope, UnresolvedGrant } from '../integration/authz-v2/types'

// =============================================================================
// MOCK JWT VERIFIER
// =============================================================================

function createMockVerifier(mapping: Record<string, string>): JwtVerifier {
  return {
    async verify(jwt: string) {
      const sub = mapping[jwt]
      if (!sub) {
        throw new Error(`Unknown JWT: ${jwt}`)
      }
      return { sub, iss: 'kernel.astrale.ai' }
    },
  }
}

// =============================================================================
// UNRESOLVED EXPRESSION BUILDER TESTS
// =============================================================================

describe('Unresolved Expression Builders', () => {
  describe('unresolvedJwt', () => {
    it('creates identity with jwt', () => {
      const expr = unresolvedJwt('token123')
      expect(expr).toEqual({ kind: 'identity', jwt: 'token123' })
    })

    it('creates identity with jwt and scopes', () => {
      const scopes: Scope[] = [{ nodes: ['ws-1'] }]
      const expr = unresolvedJwt('token123', scopes)
      expect(expr).toEqual({ kind: 'identity', jwt: 'token123', scopes })
    })
  })

  describe('unresolvedId', () => {
    it('creates identity with id', () => {
      const expr = unresolvedId('user-123')
      expect(expr).toEqual({ kind: 'identity', id: 'user-123' })
    })

    it('creates identity with id and scopes', () => {
      const scopes: Scope[] = [{ perms: ['read'] }]
      const expr = unresolvedId('user-123', scopes)
      expect(expr).toEqual({ kind: 'identity', id: 'user-123', scopes })
    })
  })

  describe('unresolvedUnion', () => {
    it('creates union expression', () => {
      const left = unresolvedId('a')
      const right = unresolvedId('b')
      const expr = unresolvedUnion(left, right)
      expect(expr).toEqual({ kind: 'union', left, right })
    })
  })

  describe('unresolvedIntersect', () => {
    it('creates intersect expression', () => {
      const left = unresolvedId('a')
      const right = unresolvedId('b')
      const expr = unresolvedIntersect(left, right)
      expect(expr).toEqual({ kind: 'intersect', left, right })
    })
  })

  describe('unresolvedExclude', () => {
    it('creates exclude expression', () => {
      const left = unresolvedId('a')
      const right = unresolvedId('b')
      const expr = unresolvedExclude(left, right)
      expect(expr).toEqual({ kind: 'exclude', left, right })
    })
  })
})

// =============================================================================
// ENCODING TESTS
// =============================================================================

describe('encodeGrant', () => {
  it('encodes simple grant', () => {
    const grant: Grant = {
      forType: { kind: 'identity', id: 'app-1' },
      forResource: { kind: 'identity', id: 'user-1' },
    }

    const encoded = encodeGrant(grant)

    expect(encoded).toEqual({
      v: 1,
      forType: { kind: 'identity', id: 'app-1' },
      forResource: { kind: 'identity', id: 'user-1' },
    })
  })

  it('encodes grant with scopes', () => {
    const grant: Grant = {
      forType: { kind: 'identity', id: 'app-1' },
      forResource: { kind: 'identity', id: 'user-1', scopes: [{ nodes: ['ws-1'] }] },
    }

    const encoded = encodeGrant(grant)

    expect(encoded.forResource).toEqual({
      kind: 'identity',
      id: 'user-1',
      scopes: [{ nodes: ['ws-1'] }],
    })
  })

  it('encodes grant with union', () => {
    const grant: Grant = {
      forType: { kind: 'identity', id: 'app-1' },
      forResource: {
        kind: 'union',
        left: { kind: 'identity', id: 'user-1' },
        right: { kind: 'identity', id: 'role-1' },
      },
    }

    const encoded = encodeGrant(grant)

    expect(encoded.forResource).toEqual({
      kind: 'union',
      left: { kind: 'identity', id: 'user-1' },
      right: { kind: 'identity', id: 'role-1' },
    })
  })

  it('encodes complex nested expression', () => {
    const grant: Grant = {
      forType: { kind: 'identity', id: 'app-1' },
      forResource: {
        kind: 'exclude',
        left: {
          kind: 'union',
          left: { kind: 'identity', id: 'user-1' },
          right: { kind: 'identity', id: 'role-1', scopes: [{ perms: ['read'] }] },
        },
        right: { kind: 'identity', id: 'blocked-1' },
      },
    }

    const encoded = encodeGrant(grant)

    expect(encoded.forResource?.kind).toBe('exclude')
  })
})

describe('createUnresolvedGrant', () => {
  it('creates grant with both expressions', () => {
    const forType = unresolvedId('app-1')
    const forResource = unresolvedJwt('token123')

    const grant = createUnresolvedGrant(forType, forResource)

    expect(grant).toEqual({
      v: 1,
      forType,
      forResource,
    })
  })

  it('creates grant with only forResource', () => {
    const forResource = unresolvedJwt('token123')

    const grant = createUnresolvedGrant(undefined, forResource)

    expect(grant).toEqual({
      v: 1,
      forResource,
    })
    expect(grant.forType).toBeUndefined()
  })

  it('creates empty grant', () => {
    const grant = createUnresolvedGrant()

    expect(grant).toEqual({ v: 1 })
  })
})

// =============================================================================
// DECODING TESTS
// =============================================================================

describe('resolveExpression', () => {
  const verifier = createMockVerifier({
    'jwt-user': 'user-123',
    'jwt-role': 'role-456',
    'jwt-blocked': 'blocked-789',
  })

  it('resolves simple jwt identity', async () => {
    const expr = unresolvedJwt('jwt-user')

    const resolved = await resolveExpression(expr, verifier)

    expect(resolved).toEqual({ kind: 'identity', id: 'user-123' })
  })

  it('resolves jwt identity with scopes', async () => {
    const scopes: Scope[] = [{ nodes: ['ws-1'] }]
    const expr = unresolvedJwt('jwt-user', scopes)

    const resolved = await resolveExpression(expr, verifier)

    expect(resolved).toEqual({ kind: 'identity', id: 'user-123', scopes })
  })

  it('preserves plain id identity', async () => {
    const expr = unresolvedId('user-123')

    const resolved = await resolveExpression(expr, verifier)

    expect(resolved).toEqual({ kind: 'identity', id: 'user-123' })
  })

  it('resolves union expression', async () => {
    const expr = unresolvedUnion(unresolvedJwt('jwt-user'), unresolvedJwt('jwt-role'))

    const resolved = await resolveExpression(expr, verifier)

    expect(resolved).toEqual({
      kind: 'union',
      left: { kind: 'identity', id: 'user-123' },
      right: { kind: 'identity', id: 'role-456' },
    })
  })

  it('resolves intersect expression', async () => {
    const expr = unresolvedIntersect(unresolvedJwt('jwt-user'), unresolvedId('role-456'))

    const resolved = await resolveExpression(expr, verifier)

    expect(resolved).toEqual({
      kind: 'intersect',
      left: { kind: 'identity', id: 'user-123' },
      right: { kind: 'identity', id: 'role-456' },
    })
  })

  it('resolves complex nested expression', async () => {
    const expr = unresolvedExclude(
      unresolvedUnion(unresolvedJwt('jwt-user'), unresolvedJwt('jwt-role', [{ perms: ['read'] }])),
      unresolvedJwt('jwt-blocked'),
    )

    const resolved = await resolveExpression(expr, verifier)

    expect(resolved).toEqual({
      kind: 'exclude',
      left: {
        kind: 'union',
        left: { kind: 'identity', id: 'user-123' },
        right: { kind: 'identity', id: 'role-456', scopes: [{ perms: ['read'] }] },
      },
      right: { kind: 'identity', id: 'blocked-789' },
    })
  })

  it('throws for unknown jwt', async () => {
    const expr = unresolvedJwt('unknown-token')

    await expect(resolveExpression(expr, verifier)).rejects.toThrow('Unknown JWT')
  })
})

describe('decodeGrant', () => {
  const verifier = createMockVerifier({
    'jwt-user': 'user-123',
    'jwt-role': 'role-456',
  })

  it('decodes grant with both expressions', async () => {
    const encoded: UnresolvedGrant = {
      v: 1,
      forType: unresolvedId('app-1'),
      forResource: unresolvedJwt('jwt-user'),
    }

    const grant = await decodeGrant(encoded, verifier, 'principal-1')

    expect(grant).toEqual({
      forType: { kind: 'identity', id: 'app-1' },
      forResource: { kind: 'identity', id: 'user-123' },
    })
  })

  it('defaults forType to principal', async () => {
    const encoded: UnresolvedGrant = {
      v: 1,
      forResource: unresolvedJwt('jwt-user'),
    }

    const grant = await decodeGrant(encoded, verifier, 'principal-1')

    expect(grant.forType).toEqual({ kind: 'identity', id: 'principal-1' })
  })

  it('defaults forResource to principal', async () => {
    const encoded: UnresolvedGrant = {
      v: 1,
      forType: unresolvedId('app-1'),
    }

    const grant = await decodeGrant(encoded, verifier, 'principal-1')

    expect(grant.forResource).toEqual({ kind: 'identity', id: 'principal-1' })
  })

  it('defaults both to principal', async () => {
    const encoded: UnresolvedGrant = { v: 1 }

    const grant = await decodeGrant(encoded, verifier, 'principal-1')

    expect(grant.forType).toEqual({ kind: 'identity', id: 'principal-1' })
    expect(grant.forResource).toEqual({ kind: 'identity', id: 'principal-1' })
  })

  it('throws for unsupported version', async () => {
    const encoded = { v: 2 } as any

    await expect(decodeGrant(encoded, verifier, 'principal-1')).rejects.toThrow(
      'Unsupported grant version',
    )
  })
})

// =============================================================================
// SCOPE TESTS
// =============================================================================

describe('applyTopLevelScopes', () => {
  it('applies scopes to simple identity', () => {
    const expr: IdentityExpr = { kind: 'identity', id: 'user-1' }
    const scopes: Scope[] = [{ nodes: ['ws-1'] }]

    const result = applyTopLevelScopes(expr, scopes)

    expect(result).toEqual({ kind: 'identity', id: 'user-1', scopes })
  })

  it('intersects with existing scopes', () => {
    const expr: IdentityExpr = {
      kind: 'identity',
      id: 'user-1',
      scopes: [{ perms: ['read'] }],
    }
    const scopes: Scope[] = [{ nodes: ['ws-1'] }]

    const result = applyTopLevelScopes(expr, scopes)

    // Proper intersection: both constraints combined into one scope
    expect(result).toEqual({
      kind: 'identity',
      id: 'user-1',
      scopes: [{ nodes: ['ws-1'], perms: ['read'] }],
    })
  })

  it('applies to all leaves in union', () => {
    const expr: IdentityExpr = {
      kind: 'union',
      left: { kind: 'identity', id: 'user-1' },
      right: { kind: 'identity', id: 'role-1' },
    }
    const scopes: Scope[] = [{ nodes: ['ws-1'] }]

    const result = applyTopLevelScopes(expr, scopes)

    expect(result).toEqual({
      kind: 'union',
      left: { kind: 'identity', id: 'user-1', scopes },
      right: { kind: 'identity', id: 'role-1', scopes },
    })
  })

  it('applies to all leaves in complex expression', () => {
    const expr: IdentityExpr = {
      kind: 'exclude',
      left: {
        kind: 'union',
        left: { kind: 'identity', id: 'user-1' },
        right: { kind: 'identity', id: 'role-1', scopes: [{ perms: ['read'] }] },
      },
      right: { kind: 'identity', id: 'blocked-1' },
    }
    const scopes: Scope[] = [{ nodes: ['ws-1'] }]

    const result = applyTopLevelScopes(expr, scopes)

    // Proper intersection: existing perms: ['read'] + top-level nodes: ['ws-1']
    // becomes a single scope with both constraints
    expect(result).toEqual({
      kind: 'exclude',
      left: {
        kind: 'union',
        left: { kind: 'identity', id: 'user-1', scopes },
        right: {
          kind: 'identity',
          id: 'role-1',
          scopes: [{ nodes: ['ws-1'], perms: ['read'] }],
        },
      },
      right: { kind: 'identity', id: 'blocked-1', scopes },
    })
  })
})

describe('intersectScopes', () => {
  it('intersects scope arrays (pairwise)', () => {
    const a: Scope[] = [{ nodes: ['ws-1'] }]
    const b: Scope[] = [{ perms: ['read'] }]

    const result = intersectScopes(a, b)

    // Proper intersection: undefined means "unrestricted"
    // nodes: ws-1 (from a, b is unrestricted)
    // perms: read (from b, a is unrestricted)
    // Result is ONE scope with both constraints
    expect(result).toEqual([{ nodes: ['ws-1'], perms: ['read'] }])
  })

  it('handles empty arrays (unrestricted)', () => {
    const a: Scope[] = []
    const b: Scope[] = [{ perms: ['read'] }]

    const result = intersectScopes(a, b)

    // Empty = unrestricted, so result is the other array
    expect(result).toEqual([{ perms: ['read'] }])
  })
})

// =============================================================================
// VALIDATION TESTS
// =============================================================================

describe('validateUnresolvedGrant', () => {
  it('accepts valid grant with v=1', () => {
    const grant: UnresolvedGrant = { v: 1 }
    expect(() => validateUnresolvedGrant(grant)).not.toThrow()
  })

  it('accepts grant with forType', () => {
    const grant: UnresolvedGrant = {
      v: 1,
      forType: { kind: 'identity', id: 'app-1' },
    }
    expect(() => validateUnresolvedGrant(grant)).not.toThrow()
  })

  it('accepts grant with forResource', () => {
    const grant: UnresolvedGrant = {
      v: 1,
      forResource: { kind: 'identity', jwt: 'token123' },
    }
    expect(() => validateUnresolvedGrant(grant)).not.toThrow()
  })

  it('rejects non-object', () => {
    expect(() => validateUnresolvedGrant('not-an-object')).toThrow('must be an object')
  })

  it('rejects null', () => {
    expect(() => validateUnresolvedGrant(null)).toThrow('must be an object')
  })

  it('rejects wrong version', () => {
    expect(() => validateUnresolvedGrant({ v: 2 })).toThrow('Unsupported grant version')
  })
})

describe('validateUnresolvedExpr', () => {
  it('accepts identity with jwt', () => {
    const expr = { kind: 'identity', jwt: 'token123' }
    expect(() => validateUnresolvedExpr(expr, 'test')).not.toThrow()
  })

  it('accepts identity with id', () => {
    const expr = { kind: 'identity', id: 'user-123' }
    expect(() => validateUnresolvedExpr(expr, 'test')).not.toThrow()
  })

  it('accepts identity with scopes', () => {
    const expr = { kind: 'identity', jwt: 'token123', scopes: [{ nodes: ['ws-1'] }] }
    expect(() => validateUnresolvedExpr(expr, 'test')).not.toThrow()
  })

  it('accepts union', () => {
    const expr = {
      kind: 'union',
      left: { kind: 'identity', id: 'a' },
      right: { kind: 'identity', id: 'b' },
    }
    expect(() => validateUnresolvedExpr(expr, 'test')).not.toThrow()
  })

  it('accepts intersect', () => {
    const expr = {
      kind: 'intersect',
      left: { kind: 'identity', id: 'a' },
      right: { kind: 'identity', id: 'b' },
    }
    expect(() => validateUnresolvedExpr(expr, 'test')).not.toThrow()
  })

  it('accepts exclude', () => {
    const expr = {
      kind: 'exclude',
      left: { kind: 'identity', id: 'a' },
      right: { kind: 'identity', id: 'b' },
    }
    expect(() => validateUnresolvedExpr(expr, 'test')).not.toThrow()
  })

  it('rejects identity without jwt or id', () => {
    const expr = { kind: 'identity' }
    expect(() => validateUnresolvedExpr(expr, 'test')).toThrow('must have jwt or id')
  })

  it('rejects identity with both jwt and id', () => {
    const expr = { kind: 'identity', jwt: 'token', id: 'user' }
    expect(() => validateUnresolvedExpr(expr, 'test')).toThrow('cannot have both jwt and id')
  })

  it('rejects non-array scopes', () => {
    const expr = { kind: 'identity', jwt: 'token', scopes: 'not-array' }
    expect(() => validateUnresolvedExpr(expr, 'test')).toThrow('must be an array')
  })

  it('rejects union without left', () => {
    const expr = { kind: 'union', right: { kind: 'identity', id: 'b' } }
    expect(() => validateUnresolvedExpr(expr, 'test')).toThrow('must have left')
  })

  it('rejects union without right', () => {
    const expr = { kind: 'union', left: { kind: 'identity', id: 'a' } }
    expect(() => validateUnresolvedExpr(expr, 'test')).toThrow('must have right')
  })

  it('rejects invalid kind', () => {
    const expr = { kind: 'invalid' }
    expect(() => validateUnresolvedExpr(expr, 'test')).toThrow('invalid kind')
  })

  it('validates nested expressions', () => {
    const expr = {
      kind: 'union',
      left: { kind: 'identity' }, // Invalid: missing jwt/id
      right: { kind: 'identity', id: 'b' },
    }
    expect(() => validateUnresolvedExpr(expr, 'test')).toThrow('must have jwt or id')
  })
})

// =============================================================================
// UTILITY TESTS
// =============================================================================

describe('extractPrimaryIdentity', () => {
  it('extracts from simple identity', () => {
    const expr: IdentityExpr = { kind: 'identity', id: 'user-123' }

    expect(extractPrimaryIdentity(expr)).toBe('user-123')
  })

  it('extracts leftmost from union', () => {
    const expr: IdentityExpr = {
      kind: 'union',
      left: { kind: 'identity', id: 'user-123' },
      right: { kind: 'identity', id: 'role-456' },
    }

    expect(extractPrimaryIdentity(expr)).toBe('user-123')
  })

  it('extracts leftmost from nested expression', () => {
    const expr: IdentityExpr = {
      kind: 'exclude',
      left: {
        kind: 'union',
        left: { kind: 'identity', id: 'user-123' },
        right: { kind: 'identity', id: 'role-456' },
      },
      right: { kind: 'identity', id: 'blocked-789' },
    }

    expect(extractPrimaryIdentity(expr)).toBe('user-123')
  })
})

// =============================================================================
// ROUND-TRIP TESTS
// =============================================================================

describe('Encode/Decode Round-trip', () => {
  const verifier = createMockVerifier({})

  it('round-trips simple grant with IDs', async () => {
    const original: Grant = {
      forType: { kind: 'identity', id: 'app-1' },
      forResource: { kind: 'identity', id: 'user-1' },
    }

    const encoded = encodeGrant(original)
    const decoded = await decodeGrant(encoded, verifier, 'principal')

    expect(decoded).toEqual(original)
  })

  it('round-trips grant with scopes', async () => {
    const original: Grant = {
      forType: { kind: 'identity', id: 'app-1' },
      forResource: {
        kind: 'identity',
        id: 'user-1',
        scopes: [{ nodes: ['ws-1'], perms: ['read'] }],
      },
    }

    const encoded = encodeGrant(original)
    const decoded = await decodeGrant(encoded, verifier, 'principal')

    expect(decoded).toEqual(original)
  })

  it('round-trips complex grant', async () => {
    const original: Grant = {
      forType: { kind: 'identity', id: 'app-1' },
      forResource: {
        kind: 'exclude',
        left: {
          kind: 'union',
          left: { kind: 'identity', id: 'user-1' },
          right: { kind: 'identity', id: 'role-1', scopes: [{ perms: ['read'] }] },
        },
        right: { kind: 'identity', id: 'blocked-1' },
      },
    }

    const encoded = encodeGrant(original)
    const decoded = await decodeGrant(encoded, verifier, 'principal')

    expect(decoded).toEqual(original)
  })
})
