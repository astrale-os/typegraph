/**
 * Identity Evaluator
 *
 * Builds expression trees from identity composition edges (unionWith, intersectWith).
 */

import type { IdentityExpr, IdentityComposition, RawExecutor } from '../types'
import { isExprBuilder, type ExprBuilder } from '../expression/builder'
import { type GraphVocab, resolveVocab } from './vocabulary'

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

// =============================================================================
// IDENTITY EVALUATOR
// =============================================================================

export class IdentityEvaluator {
  private vocab: GraphVocab
  private compositionCache = new Map<string, IdentityComposition>()

  constructor(
    private executor: RawExecutor,
    vocab?: Partial<GraphVocab>,
  ) {
    this.vocab = resolveVocab(vocab)
  }

  /** Build identity fetch query from vocabulary. */
  private get fetchQuery(): string {
    const v = this.vocab
    return `
      MATCH (i:${v.identity} {id: $id})
      OPTIONAL MATCH (i)-[:${v.union}]->(u:${v.identity})
      OPTIONAL MATCH (i)-[:${v.intersect}]->(n:${v.identity})
      OPTIONAL MATCH (i)-[:${v.exclude}]->(e:${v.identity})
      OPTIONAL MATCH (i)-[:${v.perm}]->(permTarget)
      WITH i,
           collect(DISTINCT u.id) AS unions,
           collect(DISTINCT n.id) AS intersects,
           collect(DISTINCT e.id) AS excludes,
           count(DISTINCT permTarget) > 0 AS hasDirectPerms
      RETURN i.id AS id, unions, intersects, excludes, hasDirectPerms
    `
  }

  /**
   * Fetch identity composition data from graph.
   */
  async fetchIdentity(id: string): Promise<IdentityComposition> {
    const cached = this.compositionCache.get(id)
    if (cached) return cached

    const results = await this.executor.run<IdentityComposition>(this.fetchQuery, { id })

    if (results.length === 0) {
      throw new IdentityNotFoundError(id)
    }

    const result = results[0]!
    const composition: IdentityComposition = {
      id: result.id,
      unions: (result.unions ?? []).filter((u): u is string => u !== null),
      intersects: (result.intersects ?? []).filter((i): i is string => i !== null),
      excludes: (result.excludes ?? []).filter((e): e is string => e !== null),
      hasDirectPerms: result.hasDirectPerms ?? false,
    }
    this.compositionCache.set(id, composition)
    return composition
  }

  clearCompositionCache(): void {
    this.compositionCache.clear()
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
      return { kind: 'identity', id }
    }

    // Start with self if has direct perms
    let result: IdentityExpr | null = hasDirectPerms ? { kind: 'identity', id } : null

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

    // Edge case: exclude-only identity (no base set to subtract from) or no composition at all
    if (!result) {
      const hasExcludes = excludes.length > 0
      const reason = hasExcludes
        ? 'Identity has only exclude composition edges with no base set (unions/intersects/direct perms)'
        : 'Identity has no permissions and no valid composition'
      throw new InvalidIdentityError(id, reason)
    }

    return result
  }

  /**
   * Evaluate an expression, expanding unscoped identity leaves.
   *
   * Accepts either a raw IdentityExpr or an Expr builder (auto-calls .build()).
   * For each identity leaf without scopes, expands its DB composition.
   * Scoped leaves are preserved as-is (scopes indicate explicit restriction).
   *
   * @param exprOrBuilder - Raw IdentityExpr or Expr builder
   * @returns Fully resolved IdentityExpr with DB compositions expanded
   *
   * @example
   * ```typescript
   * // With builder
   * const resolved = await evaluator.evalExpr(identity("USER1"))
   *
   * // With raw expression
   * const resolved = await evaluator.evalExpr({ kind: 'identity', id: 'USER1' })
   *
   * // Scoped leaves are NOT expanded
   * const resolved = await evaluator.evalExpr(
   *   identity("USER1", { nodes: ["ws1"] })  // Preserved as-is
   * )
   * ```
   */
  async evalExpr(exprOrBuilder: IdentityExpr | ExprBuilder): Promise<IdentityExpr> {
    const expr = isExprBuilder(exprOrBuilder) ? exprOrBuilder.build() : exprOrBuilder
    return this.resolveExpr(expr)
  }

  /**
   * Internal: recursively resolve an expression tree.
   * Expands unscoped identity leaves, preserves scoped ones.
   */
  private async resolveExpr(expr: IdentityExpr): Promise<IdentityExpr> {
    switch (expr.kind) {
      case 'identity': {
        // Scoped leaves are preserved (explicit restriction)
        if (expr.scopes && expr.scopes.length > 0) {
          return expr
        }
        // Unscoped leaves: expand DB composition
        return this.evalIdentity(expr.id)
      }
      case 'union':
      case 'intersect':
      case 'exclude': {
        // Recursively resolve both branches
        const [left, right] = await Promise.all([
          this.resolveExpr(expr.left),
          this.resolveExpr(expr.right),
        ])
        return { kind: expr.kind, left, right }
      }
    }
  }
}

/**
 * Create an identity evaluator instance.
 */
export function createIdentityEvaluator(
  executor: RawExecutor,
  vocab?: Partial<GraphVocab>,
): IdentityEvaluator {
  return new IdentityEvaluator(executor, vocab)
}
