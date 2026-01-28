/**
 * Compact JSON Encoding for Identity Expressions
 *
 * Encoding: ["i", id, scopes?] | ["u"|"n"|"x", left, right]
 * Scopes:   { n?: nodes[], p?: perms[], r?: principals[] }
 */

import type { IdentityExpr, Scope } from './types'

// Max recursion depth to prevent stack overflow from malicious input
const MAX_DEPTH = 100

export type CompactScope = { n?: string[]; p?: string[]; r?: string[] }

export type CompactExpr =
  | ['i', string]
  | ['i', string, CompactScope[]]
  | ['u', CompactExpr, CompactExpr]
  | ['n', CompactExpr, CompactExpr]
  | ['x', CompactExpr, CompactExpr]

// =============================================================================
// ENCODE (Verbose → Compact)
// =============================================================================

function compactScope(scope: Scope): CompactScope {
  const r: CompactScope = {}
  if (scope.nodes?.length) r.n = scope.nodes
  if (scope.perms?.length) r.p = scope.perms
  if (scope.principals?.length) r.r = scope.principals
  return r
}

export function toCompact(expr: IdentityExpr, depth = 0): CompactExpr {
  if (depth > MAX_DEPTH) throw new Error('Expression too deeply nested')

  switch (expr.kind) {
    case 'identity':
      return expr.scopes?.length ? ['i', expr.id, expr.scopes.map(compactScope)] : ['i', expr.id]
    case 'union':
      return ['u', toCompact(expr.left, depth + 1), toCompact(expr.right, depth + 1)]
    case 'intersect':
      return ['n', toCompact(expr.left, depth + 1), toCompact(expr.right, depth + 1)]
    case 'exclude':
      return ['x', toCompact(expr.left, depth + 1), toCompact(expr.right, depth + 1)]
  }
}

// =============================================================================
// DECODE (Compact → Verbose)
// =============================================================================

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

function expandScope(c: unknown): Scope {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) throw new Error('Invalid scope')
  const s = c as Record<string, unknown>
  const r: Scope = {}
  if (s.n !== undefined) {
    if (!isStringArray(s.n)) throw new Error('Invalid scope.nodes')
    if (s.n.length) r.nodes = s.n
  }
  if (s.p !== undefined) {
    if (!isStringArray(s.p)) throw new Error('Invalid scope.perms')
    if (s.p.length) r.perms = s.p
  }
  if (s.r !== undefined) {
    if (!isStringArray(s.r)) throw new Error('Invalid scope.principals')
    if (s.r.length) r.principals = s.r
  }
  return r
}

export function fromCompact(input: unknown, depth = 0): IdentityExpr {
  if (depth > MAX_DEPTH) throw new Error('Expression too deeply nested')
  if (!Array.isArray(input) || input.length < 2) throw new Error('Invalid expression')

  const [kind, ...rest] = input

  switch (kind) {
    case 'i': {
      const id = rest[0]
      if (typeof id !== 'string' || !id) throw new Error('Invalid identity id')
      const scopes = rest[1]
      if (scopes === undefined) return { kind: 'identity', id }
      if (!Array.isArray(scopes)) throw new Error('Invalid identity scopes')
      // Preserve all scopes including empty ones to maintain round-trip semantics
      const expanded = scopes.map(expandScope)
      return expanded.length ? { kind: 'identity', id, scopes: expanded } : { kind: 'identity', id }
    }
    case 'u':
    case 'n':
    case 'x': {
      if (rest.length !== 2) throw new Error('Invalid binary expression')
      const kindMap = { u: 'union', n: 'intersect', x: 'exclude' } as const
      return {
        kind: kindMap[kind as 'u' | 'n' | 'x'],
        left: fromCompact(rest[0], depth + 1),
        right: fromCompact(rest[1], depth + 1),
      }
    }
    default:
      throw new Error('Unknown expression kind')
  }
}

// =============================================================================
// JSON HELPERS
// =============================================================================

export function toCompactJSON(expr: IdentityExpr): string {
  return JSON.stringify(toCompact(expr))
}

export function fromCompactJSON(json: string): IdentityExpr {
  return fromCompact(JSON.parse(json))
}
