/**
 * Identity Evaluator
 *
 * Builds expression trees from identity composition edges (unionWith, intersectWith).
 */

import type { IdentityExpr, IdentityComposition, RawExecutor } from './types'

// =============================================================================
// ERRORS
// =============================================================================

export class CycleDetectedError extends Error {
  constructor(
    public readonly identityId: string,
    public readonly path: string[],
  ) {
    super(`Cycle detected in identity composition: ${path.join(' -> ')} -> ${identityId}`)
    this.name = 'CycleDetectedError'
  }
}

export class IdentityNotFoundError extends Error {
  constructor(public readonly identityId: string) {
    super(`Identity not found: ${identityId}`)
    this.name = 'IdentityNotFoundError'
  }
}

export class InvalidIdentityError extends Error {
  constructor(
    public readonly identityId: string,
    public readonly reason: string,
  ) {
    super(`Invalid identity ${identityId}: ${reason}`)
    this.name = 'InvalidIdentityError'
  }
}

// =============================================================================
// QUERIES
// =============================================================================

/**
 * Query to fetch identity composition data.
 * Uses OPTIONAL MATCH and count for FalkorDB compatibility.
 */
const FETCH_IDENTITY_QUERY = `
  MATCH (i:Identity {id: $id})
  OPTIONAL MATCH (i)-[:unionWith]->(u:Identity)
  OPTIONAL MATCH (i)-[:intersectWith]->(n:Identity)
  OPTIONAL MATCH (i)-[:excludeWith]->(e:Identity)
  OPTIONAL MATCH (i)-[:hasPerm]->(permTarget)
  WITH i,
       collect(DISTINCT u.id) AS unions,
       collect(DISTINCT n.id) AS intersects,
       collect(DISTINCT e.id) AS excludes,
       count(DISTINCT permTarget) > 0 AS hasDirectPerms
  RETURN
    i.id AS id,
    unions,
    intersects,
    excludes,
    hasDirectPerms
`

// =============================================================================
// IDENTITY EVALUATOR
// =============================================================================

export class IdentityEvaluator {
  constructor(private executor: RawExecutor) {}

  /**
   * Get whether EXISTS syntax is supported.
   * Always returns false for FalkorDB compatibility.
   */
  async supportsExistsSyntax(): Promise<boolean> {
    return false
  }

  /**
   * Fetch identity composition data from graph.
   */
  async fetchIdentity(id: string): Promise<IdentityComposition> {
    const results = await this.executor.run<IdentityComposition>(FETCH_IDENTITY_QUERY, { id })

    if (results.length === 0) {
      throw new IdentityNotFoundError(id)
    }

    const result = results[0]!
    return {
      id: result.id,
      unions: (result.unions ?? []).filter((u): u is string => u !== null),
      intersects: (result.intersects ?? []).filter((i): i is string => i !== null),
      excludes: (result.excludes ?? []).filter((e): e is string => e !== null),
      hasDirectPerms: result.hasDirectPerms ?? false,
    }
  }

  /**
   * Build expression tree with cycle detection.
   *
   * Algorithm:
   * 1. Check for cycle (visited set)
   * 2. Fetch identity data
   * 3. If leaf (no composition), return base
   * 4. Build union chain first (left-associative)
   * 5. Apply intersects last (wraps unions)
   *
   * Key insight: `new Set(visited)` creates fresh path per branch
   * to allow diamond patterns while detecting actual cycles.
   */
  async evalIdentity(id: string, visited: Set<string> = new Set()): Promise<IdentityExpr> {
    // Cycle detection - same node in current path
    if (visited.has(id)) {
      throw new CycleDetectedError(id, Array.from(visited))
    }
    visited.add(id)

    const { unions, intersects, excludes, hasDirectPerms } = await this.fetchIdentity(id)

    // Leaf node: no composition edges
    if (unions.length === 0 && intersects.length === 0 && excludes.length === 0) {
      return { kind: 'base', id }
    }

    // Start with self if has direct perms
    let result: IdentityExpr | null = hasDirectPerms ? { kind: 'base', id } : null

    // Build union chain: (X ∪ A ∪ B)
    for (const unionId of unions) {
      // Fresh visited set for each branch (allows diamonds, catches cycles)
      const unionExpr = await this.evalIdentity(unionId, new Set(visited))
      result = result ? { kind: 'union', left: result, right: unionExpr } : unionExpr
    }

    // Apply intersects: (...) ∩ C ∩ D
    for (const intersectId of intersects) {
      const intersectExpr = await this.evalIdentity(intersectId, new Set(visited))
      result = result ? { kind: 'intersect', left: result, right: intersectExpr } : intersectExpr
    }

    // Apply excludes (last): (...) \ E \ F
    for (const excludeId of excludes) {
      const excludeExpr = await this.evalIdentity(excludeId, new Set(visited))
      result = result ? { kind: 'exclude', left: result, right: excludeExpr } : null
    }

    // Edge case: no direct perms AND no valid composition
    if (!result) {
      throw new InvalidIdentityError(id, 'Identity has no permissions and no valid composition')
    }

    return result
  }
}

/**
 * Create an identity evaluator instance.
 */
export function createIdentityEvaluator(executor: RawExecutor): IdentityEvaluator {
  return new IdentityEvaluator(executor)
}
