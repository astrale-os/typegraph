/**
 * PayloadCodec — Encoding Strategy for JWT Payloads
 *
 * Configurable codec for encoding/decoding identity expressions in JWT payloads.
 * Default: 'json' (current behavior, no transformation).
 * Alternatives: 'compact' (~60% smaller), 'binary' (~79% smaller via base64).
 */

import type { IdentityExpr } from '../types'

import { identityExprToUnresolved } from '../authentication/grant-encoding'
import { toCompact, fromCompact } from './compact'
import { isDedupedExpr, expand, dedup } from './dedup'
import { encode, decode } from './encoding'

// =============================================================================
// TYPES
// =============================================================================

export type ExpressionEncoding = 'json' | 'compact' | 'binary'

export interface PayloadCodec {
  encodeExpr(expr: IdentityExpr): unknown
  decodeExpr(encoded: unknown): IdentityExpr
}

// =============================================================================
// JSON CODEC (default — identity/no-op)
// =============================================================================

export const jsonCodec: PayloadCodec = {
  encodeExpr(expr: IdentityExpr): unknown {
    return identityExprToUnresolved(expr)
  },
  decodeExpr(encoded: unknown): IdentityExpr {
    // UnresolvedIdentityExpr with plain IDs is structurally compatible with IdentityExpr
    return encoded as IdentityExpr
  },
}

// =============================================================================
// COMPACT CODEC
// =============================================================================

export const compactCodec: PayloadCodec = {
  encodeExpr(expr: IdentityExpr): unknown {
    return toCompact(expr)
  },
  decodeExpr(encoded: unknown): IdentityExpr {
    return fromCompact(encoded)
  },
}

// =============================================================================
// BINARY CODEC (base64 for JSON transport)
// =============================================================================

export const binaryCodec: PayloadCodec = {
  encodeExpr(expr: IdentityExpr): unknown {
    const binary = encode(expr)
    let binaryString = ''
    for (let i = 0; i < binary.length; i++) {
      binaryString += String.fromCharCode(binary[i]!)
    }
    return btoa(binaryString)
  },
  decodeExpr(encoded: unknown): IdentityExpr {
    if (typeof encoded !== 'string') {
      throw new Error('Binary codec expects a base64 string')
    }
    const binaryString = atob(encoded)
    const bytes = new Uint8Array(binaryString.length)
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)
    }
    const result = decode(bytes)
    // If deduped, expand to full IdentityExpr
    if (isDedupedExpr(result)) {
      return expand(result)
    }
    return result
  },
}

// =============================================================================
// DEDUP BINARY CODEC
// =============================================================================

/**
 * Binary codec with structural deduplication.
 *
 * On encode: dedup(expr) → if shared defs found, encode DedupedExpr; else encode plain.
 * On decode: decode bytes → if deduped, expand; else return as-is.
 *
 * Use when expressions may have repeated subtrees (30-80% additional savings).
 * No overhead when no duplicates exist (falls back to plain binary).
 */
const dedupBinaryCodec: PayloadCodec = {
  encodeExpr(expr: IdentityExpr): unknown {
    const deduped = dedup(expr)
    const binary = deduped.defs.length > 0 ? encode(deduped) : encode(expr)
    let s = ''
    for (let i = 0; i < binary.length; i++) {
      s += String.fromCharCode(binary[i]!)
    }
    return btoa(s)
  },
  decodeExpr(encoded: unknown): IdentityExpr {
    if (typeof encoded !== 'string') {
      throw new Error('Binary codec expects a base64 string')
    }
    const s = atob(encoded)
    const bytes = new Uint8Array(s.length)
    for (let i = 0; i < s.length; i++) {
      bytes[i] = s.charCodeAt(i)
    }
    const result = decode(bytes)
    if (isDedupedExpr(result)) {
      return expand(result)
    }
    return result
  },
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Get a PayloadCodec for the given encoding strategy.
 *
 * @param encoding - 'json' | 'compact' | 'binary'
 * @param options.dedup - Enable structural deduplication (only effective with 'binary').
 *   Repeated subtrees are extracted into shared definitions, reducing size 30-80%.
 *   No overhead when no duplicates exist. Default: false.
 */
export function getCodec(
  encoding: ExpressionEncoding,
  options?: { dedup?: boolean },
): PayloadCodec {
  if (options?.dedup && encoding === 'binary') {
    return dedupBinaryCodec
  }
  switch (encoding) {
    case 'json':
      return jsonCodec
    case 'compact':
      return compactCodec
    case 'binary':
      return binaryCodec
  }
}
