/**
 * Compact JSON Encoding for Identity Expressions
 *
 * Provides space-efficient JSON representation for wire transfer.
 * Reduces payload size ~50-70% compared to verbose format.
 *
 * Verbose format:
 * ```json
 * {"kind":"union","left":{"kind":"identity","id":"A","scopes":[{"nodes":["ws1"]}]},"right":{"kind":"identity","id":"B"}}
 * ```
 *
 * Compact format:
 * ```json
 * ["u",["i","A",[{"n":["ws1"]}]],["i","B"]]
 * ```
 *
 * Encoding scheme:
 * - Identity: ["i", id] or ["i", id, scopes]
 * - Union:    ["u", left, right]
 * - Intersect:["n", left, right]  (∩)
 * - Exclude:  ["x", left, right]  (\ set difference)
 *
 * Scope compaction:
 * - { nodes: [...] }      → { n: [...] }
 * - { perms: [...] }      → { p: [...] }
 * - { principals: [...] } → { r: [...] }  (r for "requestors")
 */

import type { IdentityExpr, Scope } from './types'

// =============================================================================
// COMPACT TYPES
// =============================================================================

/**
 * Compact scope representation.
 */
export type CompactScope = {
  n?: string[] // nodes
  p?: string[] // perms
  r?: string[] // principals (requestors)
}

/**
 * Compact expression representation (tuple-based).
 */
export type CompactExpr =
  | ['i', string] // identity without scopes
  | ['i', string, CompactScope[]] // identity with scopes
  | ['u', CompactExpr, CompactExpr] // union
  | ['n', CompactExpr, CompactExpr] // intersect
  | ['x', CompactExpr, CompactExpr] // exclude

// =============================================================================
// COMPACTION (Verbose → Compact)
// =============================================================================

/**
 * Compact a scope object.
 */
function compactScope(scope: Scope): CompactScope {
  const result: CompactScope = {}
  if (scope.nodes && scope.nodes.length > 0) {
    result.n = scope.nodes
  }
  if (scope.perms && scope.perms.length > 0) {
    result.p = scope.perms
  }
  if (scope.principals && scope.principals.length > 0) {
    result.r = scope.principals
  }
  return result
}

/**
 * Compact an identity expression to tuple format.
 *
 * @param expr - Verbose IdentityExpr
 * @returns Compact tuple representation
 *
 * @example
 * ```typescript
 * const compact = toCompact(expr.build())
 * const json = JSON.stringify(compact)
 * // ~50-70% smaller than JSON.stringify(expr.build())
 * ```
 */
export function toCompact(expr: IdentityExpr): CompactExpr {
  switch (expr.kind) {
    case 'identity': {
      if (expr.scopes && expr.scopes.length > 0) {
        const compactScopes = expr.scopes.map(compactScope)
        return ['i', expr.id, compactScopes]
      }
      return ['i', expr.id]
    }
    case 'union':
      return ['u', toCompact(expr.left), toCompact(expr.right)]
    case 'intersect':
      return ['n', toCompact(expr.left), toCompact(expr.right)]
    case 'exclude':
      return ['x', toCompact(expr.left), toCompact(expr.right)]
  }
}

// =============================================================================
// EXPANSION (Compact → Verbose)
// =============================================================================

/**
 * Expand a compact scope to verbose format.
 */
function expandScope(compact: CompactScope): Scope {
  const result: Scope = {}
  if (compact.n && compact.n.length > 0) {
    result.nodes = compact.n
  }
  if (compact.p && compact.p.length > 0) {
    result.perms = compact.p
  }
  if (compact.r && compact.r.length > 0) {
    result.principals = compact.r
  }
  return result
}

/**
 * Expand a compact expression to verbose format.
 *
 * @param compact - Compact tuple representation
 * @returns Verbose IdentityExpr
 *
 * @example
 * ```typescript
 * const compact = JSON.parse(compactJson) as CompactExpr
 * const expr = fromCompact(compact)
 * // Now usable with evaluator and checker
 * ```
 */
export function fromCompact(compact: CompactExpr): IdentityExpr {
  const [kind, ...rest] = compact

  switch (kind) {
    case 'i': {
      const [id, scopes] = rest as [string, CompactScope[]?]
      if (scopes && scopes.length > 0) {
        return {
          kind: 'identity',
          id,
          scopes: scopes.map(expandScope),
        }
      }
      return { kind: 'identity', id }
    }
    case 'u':
      return {
        kind: 'union',
        left: fromCompact(rest[0] as CompactExpr),
        right: fromCompact(rest[1] as CompactExpr),
      }
    case 'n':
      return {
        kind: 'intersect',
        left: fromCompact(rest[0] as CompactExpr),
        right: fromCompact(rest[1] as CompactExpr),
      }
    case 'x':
      return {
        kind: 'exclude',
        left: fromCompact(rest[0] as CompactExpr),
        right: fromCompact(rest[1] as CompactExpr),
      }
    default:
      throw new Error(`Unknown compact expression kind: ${kind}`)
  }
}

// =============================================================================
// CONVENIENCE FUNCTIONS
// =============================================================================

/**
 * Serialize expression to compact JSON string.
 *
 * @param expr - Verbose IdentityExpr
 * @returns Compact JSON string
 */
export function toCompactJSON(expr: IdentityExpr): string {
  return JSON.stringify(toCompact(expr))
}

/**
 * Parse compact JSON string to verbose expression.
 *
 * @param json - Compact JSON string
 * @returns Verbose IdentityExpr
 */
export function fromCompactJSON(json: string): IdentityExpr {
  return fromCompact(JSON.parse(json) as CompactExpr)
}

// =============================================================================
// SIZE COMPARISON UTILITIES
// =============================================================================

/**
 * Compare sizes between verbose and compact JSON representations.
 * Useful for debugging and optimization decisions.
 *
 * @param expr - Expression to analyze
 * @returns Size comparison stats
 */
export function compareSizes(expr: IdentityExpr): {
  verbose: number
  compact: number
  savings: number
  savingsPercent: number
} {
  const verbose = JSON.stringify(expr).length
  const compact = toCompactJSON(expr).length
  const savings = verbose - compact
  const savingsPercent = Math.round((savings / verbose) * 100)

  return { verbose, compact, savings, savingsPercent }
}
