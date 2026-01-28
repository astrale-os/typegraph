/**
 * Structural Deduplication for Identity Expressions
 *
 * Finds repeated subtrees in an expression and replaces them with references.
 * Format-agnostic - works with JSON compact or binary encoding.
 *
 * @example
 * ```typescript
 * const shared = union(identity("A"), identity("B"))
 * const expr = intersect(shared, exclude(shared, identity("C"))).build()
 *
 * const deduped = dedup(expr)
 * // deduped.defs = [{ kind: 'union', left: {id: 'A'}, right: {id: 'B'} }]
 * // deduped.root = { kind: 'intersect', left: { $ref: 0 }, right: ... }
 *
 * const original = expand(deduped)
 * // Back to full expression
 * ```
 */

import type { IdentityExpr, Scope } from './types'

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
  | { kind: 'identity'; id: string; scopes?: Scope[] }
  | { kind: 'union'; left: RefExpr; right: RefExpr }
  | { kind: 'intersect'; left: RefExpr; right: RefExpr }
  | { kind: 'exclude'; left: RefExpr; right: RefExpr }

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
 * e.g., identity("A") -> "i[1]:A:" vs identity("AB") -> "i[2]:AB:"
 */
function hashExpr(expr: IdentityExpr): string {
  switch (expr.kind) {
    case 'identity': {
      const scopeHash = expr.scopes ? JSON.stringify(expr.scopes) : ''
      // Length-prefix the ID to avoid "A" matching "AB" as substring
      return `i[${expr.id.length}]:${expr.id}:${scopeHash}`
    }
    case 'union':
      return `u:(${hashExpr(expr.left)}):(${hashExpr(expr.right)})`
    case 'intersect':
      return `n:(${hashExpr(expr.left)}):(${hashExpr(expr.right)})`
    case 'exclude':
      return `x:(${hashExpr(expr.left)}):(${hashExpr(expr.right)})`
  }
}

// =============================================================================
// DEDUPLICATION
// =============================================================================

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
  if (expr.kind !== 'identity') {
    const leftChildren = countSubtrees(expr.left, counts)
    const rightChildren = countSubtrees(expr.right, counts)
    // Include direct children and their descendants
    childHashes = new Set([
      ...leftChildren,
      ...rightChildren,
      hashExpr(expr.left),
      hashExpr(expr.right),
    ])
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

  // Otherwise, recurse (or return identity leaf as-is)
  if (expr.kind === 'identity') {
    return expr
  }

  return {
    kind: expr.kind,
    left: replaceWithRefs(expr.left, hashToRef),
    right: replaceWithRefs(expr.right, hashToRef),
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
 *
 * @example
 * ```typescript
 * const shared = union(identity("A"), identity("B"))
 * const expr = intersect(shared, exclude(shared, identity("C"))).build()
 *
 * const deduped = dedup(expr)
 * expect(deduped.defs.length).toBe(1)  // shared subtree extracted
 * ```
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

  if (refExpr.kind === 'identity') {
    return refExpr
  }

  return {
    kind: refExpr.kind,
    left: expandRefExpr(refExpr.left, defs),
    right: expandRefExpr(refExpr.right, defs),
  }
}

/**
 * Expand a deduplicated expression back to full form.
 *
 * @param deduped - Deduplicated expression with refs
 * @returns Full IdentityExpr with refs resolved
 *
 * @example
 * ```typescript
 * const deduped = dedup(expr)
 * const original = expand(deduped)
 * expect(original).toEqual(expr)  // round-trip
 * ```
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
