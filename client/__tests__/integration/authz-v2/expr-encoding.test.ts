/**
 * AUTH_V2 Tests: Binary Expression Encoding
 *
 * Tests for binary varint encoding of identity expressions.
 */

import { describe, it, expect } from 'vitest'

import type { IdentityExpr } from './types'

import { identity, union, intersect, exclude } from './expression/builder'
import { dedup, expand, isDedupedExpr } from './expression/dedup'
import { encode, decode, encodeBase64, decodeBase64, compareSizes } from './expression/encoding'
import { READ, EDIT, USE, SHARE } from './testing/helpers'

describe('AUTH_V2: Binary Expression Encoding', () => {
  // ===========================================================================
  // BASIC ENCODING
  // ===========================================================================

  describe('encode/decode round-trip', () => {
    it('round-trips simple identity', () => {
      const expr = identity('USER1').build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips identity with node scope', () => {
      const expr = identity('USER1', { nodes: ['ws1', 'ws2'] }).build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips identity with perm scope', () => {
      const expr = identity('ROLE1', { perms: READ | EDIT | USE }).build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips identity with principal scope', () => {
      const expr = identity('APP1', { principals: ['p1', 'p2'] }).build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips identity with full scope', () => {
      const expr = identity('USER1', {
        nodes: ['ws1'],
        perms: READ,
        principals: ['p1'],
      }).build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips identity with multiple scopes', () => {
      const expr = identity('USER1', [{ nodes: ['ws1'] }, { perms: READ }]).build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips union', () => {
      const expr = union(identity('A'), identity('B')).build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips intersect', () => {
      const expr = intersect(identity('A'), identity('B')).build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips exclude', () => {
      const expr = exclude(identity('A'), identity('B')).build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips complex nested expression', () => {
      const expr = intersect(
        union(identity('A', { nodes: ['ws1'] }), identity('B').scope({ perms: EDIT })),
        exclude(identity('C'), identity('D', [{ principals: ['p1'] }])),
      ).build()

      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips the user API example', () => {
      const ref1 = union(identity('X', { nodes: ['node-A'] }), identity('Y'))
      const restrictedIdentity = ref1.intersect(identity('Z'))
      const finalIdentity = intersect(
        identity('H').scope({ perms: READ }),
        restrictedIdentity.exclude(identity('M')),
      )

      const expr = finalIdentity.build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('round-trips exclude with multiple excluded operands', () => {
      const expr: IdentityExpr = {
        kind: 'exclude',
        base: { kind: 'identity', id: 'A' },
        excluded: [
          { kind: 'identity', id: 'B' },
          { kind: 'identity', id: 'C' },
        ],
      }
      const binary = encode(expr)
      const decoded = decode(binary)
      expect(decoded).toEqual(expr)
    })
  })

  // ===========================================================================
  // DEDUPED EXPRESSION ENCODING
  // ===========================================================================

  describe('deduped expression encoding', () => {
    it('round-trips deduped expression without duplicates', () => {
      const expr = union(identity('A'), identity('B')).build()
      const deduped = dedup(expr)

      const binary = encode(deduped)
      const decoded = decode(binary)

      expect(isDedupedExpr(decoded)).toBe(true)
      expect(expand(decoded as any)).toEqual(expr)
    })

    it('round-trips deduped expression with shared identity', () => {
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
      expect(deduped.defs.length).toBeGreaterThan(0) // Has defs

      const binary = encode(deduped)
      const decoded = decode(binary)

      expect(isDedupedExpr(decoded)).toBe(true)
      expect(expand(decoded as any)).toEqual(expr)
    })

    it('round-trips deduped expression with shared complex subtree', () => {
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
      const binary = encode(deduped)
      const decoded = decode(binary)

      expect(isDedupedExpr(decoded)).toBe(true)
      expect(expand(decoded as any)).toEqual(expr)
    })

    it('deduped encoding is smaller than regular for expressions with duplicates', () => {
      const shared = union(
        identity('USER1', { nodes: ['workspace-1'] }),
        identity('ROLE1', { perms: READ | EDIT }),
      ).build()

      const expr: IdentityExpr = {
        kind: 'intersect',
        operands: [
          shared,
          {
            kind: 'exclude',
            base: shared,
            excluded: [{ kind: 'identity', id: 'BLOCKED' }],
          },
        ],
      }

      const regularBinary = encode(expr)
      const dedupedBinary = encode(dedup(expr))

      expect(dedupedBinary.length).toBeLessThan(regularBinary.length)
    })
  })

  // ===========================================================================
  // BASE64 ENCODING
  // ===========================================================================

  describe('base64 encoding', () => {
    it('round-trips simple expression via base64', () => {
      const expr = union(identity('A'), identity('B')).build()
      const base64 = encodeBase64(expr)
      const decoded = decodeBase64(base64)

      expect(decoded).toEqual(expr)
    })

    it('round-trips complex expression via base64', () => {
      const expr = intersect(
        union(identity('A', { nodes: ['ws1'] }), identity('B')),
        exclude(identity('C'), identity('D')),
      ).build()

      const base64 = encodeBase64(expr)
      const decoded = decodeBase64(base64)

      expect(decoded).toEqual(expr)
    })

    it('round-trips deduped expression via base64', () => {
      const shared = union(identity('A'), identity('B')).build()
      const expr: IdentityExpr = {
        kind: 'intersect',
        operands: [shared, shared],
      }

      const deduped = dedup(expr)
      const base64 = encodeBase64(deduped)
      const decoded = decodeBase64(base64)

      expect(isDedupedExpr(decoded)).toBe(true)
      expect(expand(decoded as any)).toEqual(expr)
    })

    it('produces valid base64 string', () => {
      const expr = identity('USER1').build()
      const base64 = encodeBase64(expr)

      // Should be valid base64 (alphanumeric, +, /, =)
      expect(base64).toMatch(/^[A-Za-z0-9+/=]+$/)
    })
  })

  // ===========================================================================
  // SIZE COMPARISON
  // ===========================================================================

  describe('compareSizes()', () => {
    it('binary is smaller than verbose JSON', () => {
      const expr = union(identity('USER1'), identity('ROLE1')).build()
      const sizes = compareSizes(expr)

      expect(sizes.binary).toBeLessThan(sizes.verbose)
    })

    it('binary is smaller than compact JSON', () => {
      const expr = union(identity('USER1'), identity('ROLE1')).build()
      const sizes = compareSizes(expr)

      expect(sizes.binary).toBeLessThan(sizes.compact)
    })

    it('reports significant savings for complex expression', () => {
      const expr = intersect(
        union(
          identity('USER1', { nodes: ['workspace-1', 'workspace-2'] }),
          identity('ROLE1', { perms: READ | EDIT | USE }),
        ),
        exclude(identity('GROUP1'), identity('BLOCKED', { principals: ['principal-1'] })),
      ).build()

      const sizes = compareSizes(expr)

      // Binary should be at least 50% smaller than verbose
      expect(sizes.binary).toBeLessThan(sizes.verbose * 0.5)
    })

    it('base64 is larger than binary but smaller than verbose', () => {
      const expr = union(identity('A'), identity('B')).build()
      const sizes = compareSizes(expr)

      expect(sizes.binaryBase64).toBeGreaterThan(sizes.binary)
      expect(sizes.binaryBase64).toBeLessThan(sizes.verbose)
    })
  })

  // ===========================================================================
  // EDGE CASES
  // ===========================================================================

  describe('edge cases', () => {
    it('handles empty string ID (raw expr)', () => {
      // Note: identity() builder now rejects empty strings, but encoding should still work
      const expr: IdentityExpr = { kind: 'identity', id: '' }
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('handles very long ID', () => {
      const longId = 'a'.repeat(1000)
      const expr = identity(longId).build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('handles unicode in ID', () => {
      const expr = identity('user@例え.com').build()
      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('handles many scopes', () => {
      const scopes = Array.from({ length: 50 }, (_, i) => ({
        nodes: [`node-${i}`],
        perms: 1 << (i % 4),
      }))
      const expr = identity('USER1', scopes).build()

      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('handles deeply nested expression', () => {
      let expr: IdentityExpr = identity('LEAF').build()
      for (let i = 0; i < 50; i++) {
        expr = { kind: 'union', operands: [expr, { kind: 'identity', id: `N${i}` }] }
      }

      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('handles large varint values', () => {
      // Create expression with enough scopes to require multi-byte varint
      const manyNodes = Array.from({ length: 200 }, (_, i) => `node-${i}`)
      const expr = identity('USER1', { nodes: manyNodes }).build()

      const binary = encode(expr)
      const decoded = decode(binary)

      expect(decoded).toEqual(expr)
    })

    it('throws on invalid tag', () => {
      const invalidBinary = new Uint8Array([0xff]) // Invalid tag
      expect(() => decode(invalidBinary)).toThrow('Unknown expression tag')
    })

    it('throws on truncated buffer', () => {
      const expr = identity('USER1').build()
      const binary = encode(expr)
      const truncated = binary.subarray(0, 2) // Truncate

      expect(() => decode(truncated)).toThrow()
    })

    it('throws on empty buffer', () => {
      const emptyBinary = new Uint8Array(0)
      expect(() => decode(emptyBinary)).toThrow('Cannot decode empty buffer')
    })

    it('throws on malformed varint with too many continuation bytes', () => {
      // Craft a buffer with 6 continuation bytes (exceeds 35-bit limit)
      const malformedVarint = new Uint8Array([
        0x01, // TAG_IDENTITY
        0x80,
        0x80,
        0x80,
        0x80,
        0x80,
        0x80, // 6 continuation bytes - should fail
      ])
      expect(() => decode(malformedVarint)).toThrow('Varint too long')
    })

    it('throws on extra bytes after expression', () => {
      const expr: IdentityExpr = { kind: 'identity', id: 'A' }
      const binary = encode(expr)
      // Append extra bytes
      const withExtra = new Uint8Array(binary.length + 2)
      withExtra.set(binary)
      withExtra[binary.length] = 0xff
      withExtra[binary.length + 1] = 0xfe

      expect(() => decode(withExtra)).toThrow('Unexpected 2 bytes after expression')
    })
  })

  // ===========================================================================
  // BINARY FORMAT VERIFICATION
  // ===========================================================================

  describe('binary format', () => {
    it('simple identity starts with correct tag', () => {
      const expr = identity('A').build()
      const binary = encode(expr)

      expect(binary[0]).toBe(0x01) // TAG_IDENTITY
    })

    it('scoped identity starts with correct tag', () => {
      const expr = identity('A', { nodes: ['ws1'] }).build()
      const binary = encode(expr)

      expect(binary[0]).toBe(0x03) // TAG_SCOPE
    })

    it('union starts with correct tag', () => {
      const expr = union(identity('A'), identity('B')).build()
      const binary = encode(expr)

      expect(binary[0]).toBe(0x10) // TAG_UNION
    })

    it('intersect starts with correct tag', () => {
      const expr = intersect(identity('A'), identity('B')).build()
      const binary = encode(expr)

      expect(binary[0]).toBe(0x11) // TAG_INTERSECT
    })

    it('exclude starts with correct tag', () => {
      const expr = exclude(identity('A'), identity('B')).build()
      const binary = encode(expr)

      expect(binary[0]).toBe(0x12) // TAG_EXCLUDE
    })

    it('deduped starts with correct tag', () => {
      const expr = union(identity('A'), identity('B')).build()
      const deduped = dedup(expr)
      const binary = encode(deduped)

      expect(binary[0]).toBe(0x30) // TAG_DEDUPED
    })
  })
})
