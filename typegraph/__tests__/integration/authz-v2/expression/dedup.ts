/**
 * Structural Deduplication for Identity Expressions
 *
 * Finds repeated subtrees in an expression and replaces them with references.
 * Format-agnostic - works with JSON compact or binary encoding.
 *
 * ## When to use
 *
 * - Call `hasRepeatedSubtrees(expr)` first — returns true if dedup will help
 * - Typical savings: 30-80% for expressions with shared subtrees
 * - No benefit (~2% overhead) for expressions without duplicates
 * - Best combined with binary encoding via `getCodec('binary', { dedup: true })`
 *
 * ## Activation
 *
 * ```typescript
 * // Via KernelServiceConfig:
 * new KernelService(registry, keyStore, { encoding: 'binary', dedup: true })
 *
 * // Via codec directly:
 * const codec = getCodec('binary', { dedup: true })
 * const encoded = codec.encodeExpr(expr)  // auto-dedup if repeated subtrees found
 * ```
 *
 * ## Pipeline
 *
 * ```
 * Encode: expr → dedup() → DedupedExpr → encode() → bytes → base64
 * Decode: base64 → bytes → decode() → DedupedExpr → expand() → IdentityExpr
 * ```
 *
 * @example
 * ```typescript
 * const shared = union(identity("A"), identity("B")).build()
 * const expr = intersect(raw(shared), exclude(raw(shared), identity("C"))).build()
 *
 * const deduped = dedup(expr)
 * // deduped.defs = [{ kind: 'union', operands: [{id: 'A'}, {id: 'B'}] }]
 * // deduped.root = { kind: 'intersect', operands: [{ $ref: 0 }, ...] }
 *
 * const original = expand(deduped)
 * // Back to full expression
 * ```
 */

import type { IdentityExpr, Scope } from '../types'

// =============================================================================
// TYPES
// =============================================================================

/**
 * Reference to a definition in DedupedExpr.defs.
 */
export type Ref = { $ref: number }

/**
 * Expression node that may contain references.
 */
export type RefExpr =
  | Ref
  | { kind: 'identity'; id: string }
  | { kind: 'scope'; scopes: Scope[]; expr: RefExpr }
  | { kind: 'union'; operands: RefExpr[] }
  | { kind: 'intersect'; operands: RefExpr[] }
  | { kind: 'exclude'; base: RefExpr; excluded: RefExpr[] }

/**
 * Deduplicated expression with shared definitions extracted.
 */
export type DedupedExpr = {
  defs: IdentityExpr[] // Shared subtrees (index = ref id)
  root: RefExpr // Root expression with Ref nodes
}

/**
 * Type guard to check if a value is a Ref.
 */
export function isRef(value: unknown): value is Ref {
  return (
    typeof value === 'object' &&
    value !== null &&
    '$ref' in value &&
    typeof (value as Ref).$ref === 'number' &&
    Number.isInteger((value as Ref).$ref) &&
    (value as Ref).$ref >= 0
  )
}

/**
 * Type guard to check if a value is a DedupedExpr.
 */
export function isDedupedExpr(value: unknown): value is DedupedExpr {
  return (
    typeof value === 'object' &&
    value !== null &&
    'defs' in value &&
    'root' in value &&
    Array.isArray((value as DedupedExpr).defs)
  )
}

// =============================================================================
// HASHING
// =============================================================================

/**
 * Compute a deterministic hash of an expression for duplicate detection.
 * Uses length-prefixed IDs to avoid false substring matches.
 * e.g., identity("A") -> "i[1]:A" vs identity("AB") -> "i[2]:AB"
 */
function hashExpr(expr: IdentityExpr): string {
  switch (expr.kind) {
    case 'identity':
      return `i[${expr.id.length}]:${expr.id}`
    case 'scope':
      return `s:${JSON.stringify(expr.scopes)}:(${hashExpr(expr.expr)})`
    case 'union':
      return `u:(${expr.operands.map(hashExpr).join('|')})`
    case 'intersect':
      return `n:(${expr.operands.map(hashExpr).join('|')})`
    case 'exclude':
      return `x:(${hashExpr(expr.base)}):(${expr.excluded.map(hashExpr).join('|')})`
  }
}

// =============================================================================
// DEDUPLICATION
// =============================================================================

/**
 * Collect hashes of all direct children of an expression.
 */
function collectChildHashes(expr: IdentityExpr): IdentityExpr[] {
  switch (expr.kind) {
    case 'identity':
      return []
    case 'scope':
      return [expr.expr]
    case 'union':
    case 'intersect':
      return expr.operands
    case 'exclude':
      return [expr.base, ...expr.excluded]
  }
}

/**
 * Count occurrences of each subtree hash in the expression.
 * Returns the set of all child hashes (for nesting detection).
 */
function countSubtrees(
  expr: IdentityExpr,
  counts: Map<string, { count: number; expr: IdentityExpr; childHashes: Set<string> }>,
): Set<string> {
  const hash = hashExpr(expr)
  const existing = counts.get(hash)

  // Collect child hashes by recursing first
  let childHashes = new Set<string>()
  const children = collectChildHashes(expr)

  for (const child of children) {
    const descendantHashes = countSubtrees(child, counts)
    const childHash = hashExpr(child)
    childHashes.add(childHash)
    for (const h of descendantHashes) {
      childHashes.add(h)
    }
  }

  if (existing) {
    existing.count++
  } else {
    counts.set(hash, { count: 1, expr, childHashes })
  }

  return childHashes
}

/**
 * Replace duplicate subtrees with references.
 */
function replaceWithRefs(expr: IdentityExpr, hashToRef: Map<string, number>): RefExpr {
  const hash = hashExpr(expr)
  const refIndex = hashToRef.get(hash)

  // If this subtree is in defs, return a reference
  if (refIndex !== undefined) {
    return { $ref: refIndex }
  }

  switch (expr.kind) {
    case 'identity':
      return expr
    case 'scope':
      return { kind: 'scope', scopes: expr.scopes, expr: replaceWithRefs(expr.expr, hashToRef) }
    case 'union':
      return { kind: 'union', operands: expr.operands.map((op) => replaceWithRefs(op, hashToRef)) }
    case 'intersect':
      return {
        kind: 'intersect',
        operands: expr.operands.map((op) => replaceWithRefs(op, hashToRef)),
      }
    case 'exclude':
      return {
        kind: 'exclude',
        base: replaceWithRefs(expr.base, hashToRef),
        excluded: expr.excluded.map((ex) => replaceWithRefs(ex, hashToRef)),
      }
  }
}

/**
 * Deduplicate an expression by extracting repeated subtrees.
 *
 * Only subtrees that appear 2+ times are extracted.
 * Prioritizes larger subtrees (processed largest-first).
 *
 * @param expr - The expression to deduplicate
 * @returns Deduplicated expression with shared definitions
 */
export function dedup(expr: IdentityExpr): DedupedExpr {
  // Step 1: Count all subtree occurrences (also tracks child relationships)
  const counts = new Map<string, { count: number; expr: IdentityExpr; childHashes: Set<string> }>()
  countSubtrees(expr, counts)

  // Step 2: Find subtrees that appear 2+ times
  // Sort by hash length descending to prioritize larger subtrees
  const duplicates = Array.from(counts.entries())
    .filter(([_, { count }]) => count >= 2)
    .sort((a, b) => b[0].length - a[0].length)

  // Step 3: Build defs array and hash→ref mapping
  // Skip subtrees that are children of already-included subtrees
  const defs: IdentityExpr[] = []
  const hashToRef = new Map<string, number>()

  for (const [hash, { expr: subtree }] of duplicates) {
    // Skip if this subtree is a child of an already-included subtree
    // (parent already includes this, so extracting separately is redundant)
    let isChildOfIncluded = false
    for (const [includedHash, includedData] of counts) {
      if (hashToRef.has(includedHash) && includedData.childHashes.has(hash)) {
        isChildOfIncluded = true
        break
      }
    }

    if (!isChildOfIncluded) {
      hashToRef.set(hash, defs.length)
      defs.push(subtree)
    }
  }

  // Step 4: Replace duplicates with refs in the tree
  const root = replaceWithRefs(expr, hashToRef)

  return { defs, root }
}

// =============================================================================
// EXPANSION
// =============================================================================

/**
 * Expand a RefExpr back to a full IdentityExpr.
 */
function expandRefExpr(refExpr: RefExpr, defs: IdentityExpr[]): IdentityExpr {
  if (isRef(refExpr)) {
    const def = defs[refExpr.$ref]
    if (!def) {
      throw new Error(`Invalid reference: $ref ${refExpr.$ref} not found in defs`)
    }
    return def
  }

  switch (refExpr.kind) {
    case 'identity':
      return refExpr
    case 'scope':
      return { kind: 'scope', scopes: refExpr.scopes, expr: expandRefExpr(refExpr.expr, defs) }
    case 'union':
      return {
        kind: 'union',
        operands: refExpr.operands.map((op) => expandRefExpr(op, defs)),
      }
    case 'intersect':
      return {
        kind: 'intersect',
        operands: refExpr.operands.map((op) => expandRefExpr(op, defs)),
      }
    case 'exclude':
      return {
        kind: 'exclude',
        base: expandRefExpr(refExpr.base, defs),
        excluded: refExpr.excluded.map((ex) => expandRefExpr(ex, defs)),
      }
  }
}

/**
 * Expand a deduplicated expression back to full form.
 *
 * @param deduped - Deduplicated expression with refs
 * @returns Full IdentityExpr with refs resolved
 */
export function expand(deduped: DedupedExpr): IdentityExpr {
  return expandRefExpr(deduped.root, deduped.defs)
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Check if an expression has repeated subtrees (dedup would help).
 *
 * @param expr - Expression to check
 * @returns true if there are duplicate subtrees
 */
export function hasRepeatedSubtrees(expr: IdentityExpr): boolean {
  const counts = new Map<string, { count: number; expr: IdentityExpr; childHashes: Set<string> }>()
  countSubtrees(expr, counts)

  for (const { count } of counts.values()) {
    if (count >= 2) {
      return true
    }
  }
  return false
}

/**
 * Get statistics about potential deduplication.
 *
 * @param expr - Expression to analyze
 * @returns Stats about repeated subtrees
 */
export function dedupStats(expr: IdentityExpr): {
  totalSubtrees: number
  uniqueSubtrees: number
  duplicateSubtrees: number
  potentialSavings: number
} {
  const counts = new Map<string, { count: number; expr: IdentityExpr; childHashes: Set<string> }>()
  countSubtrees(expr, counts)

  let totalSubtrees = 0
  let duplicateSubtrees = 0

  for (const { count } of counts.values()) {
    totalSubtrees += count
    if (count >= 2) {
      duplicateSubtrees += count - 1 // All but first occurrence
    }
  }

  return {
    totalSubtrees,
    uniqueSubtrees: counts.size,
    duplicateSubtrees,
    potentialSavings: totalSubtrees > 0 ? Math.round((duplicateSubtrees / totalSubtrees) * 100) : 0,
  }
}
