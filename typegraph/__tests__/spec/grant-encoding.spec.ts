/**
 * AUTH_V2 Grant Encoding Tests
 *
 * Unit tests for encode/decode round-trips and validation.
 */

import { describe, expect, it } from 'vitest'
import {
  createUnresolvedGrant,
  encodeGrant,
  identityExprToUnresolved,
  unresolvedExclude,
  unresolvedId,
  unresolvedIntersect,
  unresolvedJwt,
  unresolvedScope,
  unresolvedUnion,
  type VerifiedJwt,
} from '../integration/authz-v2/authentication/grant-encoding'
import {
  extractPrimaryIdentity,
  validateUnresolvedExpr,
  validateUnresolvedGrant,
} from '../integration/authz-v2/authentication/grant-decoder'
import { applyTopLevelScopes, intersectScopes } from '../integration/authz-v2/expression/scope'
import type {
  Grant,
  IdentityExpr,
  IdentityId,
  Scope,
  UnresolvedGrant,
  UnresolvedIdentityExpr,
} from '../integration/authz-v2/types'
import { READ, EDIT } from '../integration/authz-v2/testing/helpers'

// =============================================================================
// TEST HELPERS (inline — not part of production code)
// =============================================================================

interface JwtVerifier {
  verify(jwt: string): Promise<VerifiedJwt>
}

async function resolveExpression(
  expr: UnresolvedIdentityExpr,
  verifier: JwtVerifier,
): Promise<IdentityExpr> {
  switch (expr.kind) {
    case 'identity':
      if ('jwt' in expr) {
        const verified = await verifier.verify(expr.jwt)
        return { kind: 'identity', id: verified.sub }
      }
      return { kind: 'identity', id: expr.id }
    case 'scope': {
      const inner = await resolveExpression(expr.expr, verifier)
      return { kind: 'scope', scopes: expr.scopes, expr: inner }
    }
    case 'union':
    case 'intersect': {
      const operands = await Promise.all(expr.operands.map((op) => resolveExpression(op, verifier)))
      return { kind: expr.kind, operands }
    }
    case 'exclude': {
      const [base, ...excluded] = await Promise.all([
        resolveExpression(expr.base, verifier),
        ...expr.excluded.map((ex) => resolveExpression(ex, verifier)),
      ])
      return { kind: 'exclude', base: base!, excluded }
    }
  }
}

async function decodeGrant(
  encoded: UnresolvedGrant,
  verifier: JwtVerifier,
  principal: IdentityId,
): Promise<Grant> {
  if (encoded.v !== 1) {
    throw new Error(`Unsupported grant version: ${encoded.v}`)
  }
  const defaultExpr: IdentityExpr = { kind: 'identity', id: principal }
  const forType = encoded.forType ? await resolveExpression(encoded.forType, verifier) : defaultExpr
  const forResource = encoded.forResource ? await resolveExpression(encoded.forResource, verifier) : defaultExpr
  return { forType, forResource }
}


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
  })

  describe('unresolvedId', () => {
    it('creates identity with id', () => {
      const expr = unresolvedId('user-123')
      expect(expr).toEqual({ kind: 'identity', id: 'user-123' })
    })
  })

  describe('unresolvedScope', () => {
    it('creates scope wrapper around jwt identity', () => {
      const scopes: Scope[] = [{ nodes: ['ws-1'] }]
      const expr = unresolvedScope(scopes, unresolvedJwt('token123'))
      expect(expr).toEqual({
        kind: 'scope',
        scopes,
        expr: { kind: 'identity', jwt: 'token123' },
      })
    })

    it('creates scope wrapper around id identity', () => {
      const scopes: Scope[] = [{ perms: READ }]
      const expr = unresolvedScope(scopes, unresolvedId('user-123'))
      expect(expr).toEqual({
        kind: 'scope',
        scopes,
        expr: { kind: 'identity', id: 'user-123' },
      })
    })
  })

  describe('unresolvedUnion', () => {
    it('creates union expression', () => {
      const a = unresolvedId('a')
      const b = unresolvedId('b')
      const expr = unresolvedUnion(a, b)
      expect(expr).toEqual({ kind: 'union', operands: [a, b] })
    })
  })

  describe('unresolvedIntersect', () => {
    it('creates intersect expression', () => {
      const a = unresolvedId('a')
      const b = unresolvedId('b')
      const expr = unresolvedIntersect(a, b)
      expect(expr).toEqual({ kind: 'intersect', operands: [a, b] })
    })
  })

  describe('unresolvedExclude', () => {
    it('creates exclude expression', () => {
      const base = unresolvedId('a')
      const excl = unresolvedId('b')
      const expr = unresolvedExclude(base, excl)
      expect(expr).toEqual({ kind: 'exclude', base, excluded: [excl] })
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
      forResource: {
        kind: 'scope',
        scopes: [{ nodes: ['ws-1'] }],
        expr: { kind: 'identity', id: 'user-1' },
      },
    }

    const encoded = encodeGrant(grant)

    expect(encoded.forResource).toEqual({
      kind: 'scope',
      scopes: [{ nodes: ['ws-1'] }],
      expr: { kind: 'identity', id: 'user-1' },
    })
  })

  it('encodes grant with union', () => {
    const grant: Grant = {
      forType: { kind: 'identity', id: 'app-1' },
      forResource: {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'user-1' },
          { kind: 'identity', id: 'role-1' },
        ],
      },
    }

    const encoded = encodeGrant(grant)

    expect(encoded.forResource).toEqual({
      kind: 'union',
      operands: [
        { kind: 'identity', id: 'user-1' },
        { kind: 'identity', id: 'role-1' },
      ],
    })
  })

  it('encodes complex nested expression', () => {
    const grant: Grant = {
      forType: { kind: 'identity', id: 'app-1' },
      forResource: {
        kind: 'exclude',
        base: {
          kind: 'union',
          operands: [
            { kind: 'identity', id: 'user-1' },
            {
              kind: 'scope',
              scopes: [{ perms: READ }],
              expr: { kind: 'identity', id: 'role-1' },
            },
          ],
        },
        excluded: [{ kind: 'identity', id: 'blocked-1' }],
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
    const expr = unresolvedScope(scopes, unresolvedJwt('jwt-user'))

    const resolved = await resolveExpression(expr, verifier)

    expect(resolved).toEqual({
      kind: 'scope',
      scopes,
      expr: { kind: 'identity', id: 'user-123' },
    })
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
      operands: [
        { kind: 'identity', id: 'user-123' },
        { kind: 'identity', id: 'role-456' },
      ],
    })
  })

  it('resolves intersect expression', async () => {
    const expr = unresolvedIntersect(unresolvedJwt('jwt-user'), unresolvedId('role-456'))

    const resolved = await resolveExpression(expr, verifier)

    expect(resolved).toEqual({
      kind: 'intersect',
      operands: [
        { kind: 'identity', id: 'user-123' },
        { kind: 'identity', id: 'role-456' },
      ],
    })
  })

  it('resolves complex nested expression', async () => {
    const expr = unresolvedExclude(
      unresolvedUnion(
        unresolvedJwt('jwt-user'),
        unresolvedScope([{ perms: READ }], unresolvedJwt('jwt-role')),
      ),
      unresolvedJwt('jwt-blocked'),
    )

    const resolved = await resolveExpression(expr, verifier)

    expect(resolved).toEqual({
      kind: 'exclude',
      base: {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'user-123' },
          {
            kind: 'scope',
            scopes: [{ perms: READ }],
            expr: { kind: 'identity', id: 'role-456' },
          },
        ],
      },
      excluded: [{ kind: 'identity', id: 'blocked-789' }],
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
  it('wraps simple identity in scope node', () => {
    const expr: IdentityExpr = { kind: 'identity', id: 'user-1' }
    const scopes: Scope[] = [{ nodes: ['ws-1'] }]

    const result = applyTopLevelScopes(expr, scopes)

    expect(result).toEqual({
      kind: 'scope',
      scopes,
      expr: { kind: 'identity', id: 'user-1' },
    })
  })

  it('wraps already-scoped identity in another scope node', () => {
    const expr: IdentityExpr = {
      kind: 'scope',
      scopes: [{ perms: READ }],
      expr: { kind: 'identity', id: 'user-1' },
    }
    const scopes: Scope[] = [{ nodes: ['ws-1'] }]

    const result = applyTopLevelScopes(expr, scopes)

    // Outer scope wraps the inner scope
    expect(result).toEqual({
      kind: 'scope',
      scopes: [{ nodes: ['ws-1'] }],
      expr: {
        kind: 'scope',
        scopes: [{ perms: READ }],
        expr: { kind: 'identity', id: 'user-1' },
      },
    })
  })

  it('wraps union in scope node', () => {
    const expr: IdentityExpr = {
      kind: 'union',
      operands: [
        { kind: 'identity', id: 'user-1' },
        { kind: 'identity', id: 'role-1' },
      ],
    }
    const scopes: Scope[] = [{ nodes: ['ws-1'] }]

    const result = applyTopLevelScopes(expr, scopes)

    expect(result).toEqual({
      kind: 'scope',
      scopes,
      expr: {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'user-1' },
          { kind: 'identity', id: 'role-1' },
        ],
      },
    })
  })

  it('wraps complex expression in scope node', () => {
    const expr: IdentityExpr = {
      kind: 'exclude',
      base: {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'user-1' },
          {
            kind: 'scope',
            scopes: [{ perms: READ }],
            expr: { kind: 'identity', id: 'role-1' },
          },
        ],
      },
      excluded: [{ kind: 'identity', id: 'blocked-1' }],
    }
    const scopes: Scope[] = [{ nodes: ['ws-1'] }]

    const result = applyTopLevelScopes(expr, scopes)

    // Top-level scope wraps the entire expression
    expect(result).toEqual({
      kind: 'scope',
      scopes: [{ nodes: ['ws-1'] }],
      expr: {
        kind: 'exclude',
        base: {
          kind: 'union',
          operands: [
            { kind: 'identity', id: 'user-1' },
            {
              kind: 'scope',
              scopes: [{ perms: READ }],
              expr: { kind: 'identity', id: 'role-1' },
            },
          ],
        },
        excluded: [{ kind: 'identity', id: 'blocked-1' }],
      },
    })
  })
})

describe('intersectScopes', () => {
  it('intersects scope arrays (pairwise)', () => {
    const a: Scope[] = [{ nodes: ['ws-1'] }]
    const b: Scope[] = [{ perms: READ }]

    const result = intersectScopes(a, b)

    // Proper intersection: undefined means "unrestricted"
    // nodes: ws-1 (from a, b is unrestricted)
    // perms: read (from b, a is unrestricted)
    // Result is ONE scope with both constraints
    expect(result).toEqual([{ nodes: ['ws-1'], perms: READ }])
  })

  it('handles empty arrays (unrestricted)', () => {
    const a: Scope[] = []
    const b: Scope[] = [{ perms: READ }]

    const result = intersectScopes(a, b)

    // Empty = unrestricted, so result is the other array
    expect(result).toEqual([{ perms: READ }])
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

  it('accepts scope wrapping identity', () => {
    const expr = {
      kind: 'scope',
      scopes: [{ nodes: ['ws-1'] }],
      expr: { kind: 'identity', jwt: 'token123' },
    }
    expect(() => validateUnresolvedExpr(expr, 'test')).not.toThrow()
  })

  it('accepts union', () => {
    const expr = {
      kind: 'union',
      operands: [
        { kind: 'identity', id: 'a' },
        { kind: 'identity', id: 'b' },
      ],
    }
    expect(() => validateUnresolvedExpr(expr, 'test')).not.toThrow()
  })

  it('accepts intersect', () => {
    const expr = {
      kind: 'intersect',
      operands: [
        { kind: 'identity', id: 'a' },
        { kind: 'identity', id: 'b' },
      ],
    }
    expect(() => validateUnresolvedExpr(expr, 'test')).not.toThrow()
  })

  it('accepts exclude', () => {
    const expr = {
      kind: 'exclude',
      base: { kind: 'identity', id: 'a' },
      excluded: [{ kind: 'identity', id: 'b' }],
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

  it('rejects union without enough operands', () => {
    const expr = { kind: 'union', operands: [{ kind: 'identity', id: 'a' }] }
    expect(() => validateUnresolvedExpr(expr, 'test')).toThrow('must have at least 2 operands')
  })

  it('rejects exclude without base', () => {
    const expr = { kind: 'exclude', excluded: [{ kind: 'identity', id: 'b' }] }
    expect(() => validateUnresolvedExpr(expr, 'test')).toThrow('must have base')
  })

  it('rejects invalid kind', () => {
    const expr = { kind: 'invalid' }
    expect(() => validateUnresolvedExpr(expr, 'test')).toThrow('invalid kind')
  })

  it('validates nested expressions', () => {
    const expr = {
      kind: 'union',
      operands: [
        { kind: 'identity' }, // Invalid: missing jwt/id
        { kind: 'identity', id: 'b' },
      ],
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

  it('extracts first from union', () => {
    const expr: IdentityExpr = {
      kind: 'union',
      operands: [
        { kind: 'identity', id: 'user-123' },
        { kind: 'identity', id: 'role-456' },
      ],
    }

    expect(extractPrimaryIdentity(expr)).toBe('user-123')
  })

  it('extracts from base of nested exclude expression', () => {
    const expr: IdentityExpr = {
      kind: 'exclude',
      base: {
        kind: 'union',
        operands: [
          { kind: 'identity', id: 'user-123' },
          { kind: 'identity', id: 'role-456' },
        ],
      },
      excluded: [{ kind: 'identity', id: 'blocked-789' }],
    }

    expect(extractPrimaryIdentity(expr)).toBe('user-123')
  })

  it('extracts through scope node', () => {
    const expr: IdentityExpr = {
      kind: 'scope',
      scopes: [{ nodes: ['ws-1'] }],
      expr: { kind: 'identity', id: 'user-123' },
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
        kind: 'scope',
        scopes: [{ nodes: ['ws-1'], perms: READ }],
        expr: { kind: 'identity', id: 'user-1' },
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
        base: {
          kind: 'union',
          operands: [
            { kind: 'identity', id: 'user-1' },
            {
              kind: 'scope',
              scopes: [{ perms: READ }],
              expr: { kind: 'identity', id: 'role-1' },
            },
          ],
        },
        excluded: [{ kind: 'identity', id: 'blocked-1' }],
      },
    }

    const encoded = encodeGrant(original)
    const decoded = await decodeGrant(encoded, verifier, 'principal')

    expect(decoded).toEqual(original)
  })
})
