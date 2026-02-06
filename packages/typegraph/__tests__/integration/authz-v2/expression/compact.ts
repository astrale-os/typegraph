/**
 * Compact JSON Encoding for Identity Expressions
 *
 * Encoding:
 * - Identity:  ["i", id]
 * - Scope:     ["s", CompactScope[], innerExpr]
 * - Union:     ["u", [operand1, operand2, ...]]
 * - Intersect: ["n", [operand1, operand2, ...]]
 * - Exclude:   ["x", base, [excl1, excl2, ...]]
 *
 * Scopes: { n?: nodes[], p?: perms[], r?: principals[] }
 */

import type { IdentityExpr, Scope } from '../types'

// Max recursion depth to prevent stack overflow from malicious input
const MAX_DEPTH = 100

export type CompactScope = { n?: string[]; p?: string[]; r?: string[] }

export type CompactExpr =
  | ['i', string]
  | ['s', CompactScope[], CompactExpr]
  | ['u', CompactExpr[]]
  | ['n', CompactExpr[]]
  | ['x', CompactExpr, CompactExpr[]]

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
      return ['i', expr.id]
    case 'scope':
      return ['s', expr.scopes.map(compactScope), toCompact(expr.expr, depth + 1)]
    case 'union':
      return ['u', expr.operands.map((op) => toCompact(op, depth + 1))]
    case 'intersect':
      return ['n', expr.operands.map((op) => toCompact(op, depth + 1))]
    case 'exclude':
      return [
        'x',
        toCompact(expr.base, depth + 1),
        expr.excluded.map((ex) => toCompact(ex, depth + 1)),
      ]
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
      return { kind: 'identity', id }
    }
    case 's': {
      if (rest.length !== 2) throw new Error('Invalid scope expression')
      const scopes = rest[0]
      if (!Array.isArray(scopes)) throw new Error('Invalid scope scopes')
      const expanded = scopes.map(expandScope)
      if (expanded.length === 0) throw new Error('Scope must have at least one scope')
      return { kind: 'scope', scopes: expanded, expr: fromCompact(rest[1], depth + 1) }
    }
    case 'u':
    case 'n': {
      const operands = rest[0]
      if (!Array.isArray(operands) || operands.length < 2) {
        throw new Error(`${kind === 'u' ? 'union' : 'intersect'} must have at least 2 operands`)
      }
      const kindMap = { u: 'union', n: 'intersect' } as const
      return {
        kind: kindMap[kind as 'u' | 'n'],
        operands: operands.map((op: unknown) => fromCompact(op, depth + 1)),
      }
    }
    case 'x': {
      if (rest.length !== 2) throw new Error('Invalid exclude expression')
      const base = fromCompact(rest[0], depth + 1)
      const excluded = rest[1]
      if (!Array.isArray(excluded) || excluded.length < 1) {
        throw new Error('exclude must have at least 1 excluded operand')
      }
      return {
        kind: 'exclude',
        base,
        excluded: excluded.map((ex: unknown) => fromCompact(ex, depth + 1)),
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
