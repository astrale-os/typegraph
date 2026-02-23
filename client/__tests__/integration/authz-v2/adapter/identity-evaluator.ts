/**
 * Identity Evaluator
 *
 * Builds expression trees from identity composition edges (unionWith, intersectWith).
 *
 * Performance optimization: Uses batch fetching with UNWIND to resolve entire
 * composition graphs in O(1) database round-trips instead of O(N) sequential queries.
 *
 * Caching: Request-scoped by design. Create a cache with `createCompositionCache()`
 * and pass it to multiple `evalExpr` calls within the same request for reuse.
 * No instance-level caching to avoid staleness issues in authorization decisions.
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
// COMPOSITION CACHE (REQUEST-SCOPED)
// =============================================================================

/**
 * Request-scoped cache for identity compositions.
 *
 * Usage:
 * ```typescript
 * // Create once per request
 * const cache = createCompositionCache()
 *
 * // Reuse across multiple evalExpr calls
 * const expr1 = await evaluator.evalExpr(identity('USER1'), { cache })
 * const expr2 = await evaluator.evalExpr(identity('USER2'), { cache })
 *
 * // Cache is garbage collected when request ends
 * ```
 *
 * Why request-scoped?
 * - Avoids staleness: cache dies with request, no cross-request stale data
 * - Safe for authorization: no risk of incorrect grant/deny from stale cache
 * - Simple lifecycle: no invalidation logic needed
 */
export type CompositionCache = Map<string, IdentityComposition>

/** Create a fresh composition cache for request-scoped reuse. */
export function createCompositionCache(): CompositionCache {
  return new Map()
}

// =============================================================================
// EVAL OPTIONS
// =============================================================================

export interface EvalExprOptions {
  /** Maximum composition depth to traverse (default: 10) */
  maxDepth?: number

  /**
   * Optional cache for request-scoped reuse.
   * If not provided, a fresh cache is created for this call only.
   */
  cache?: CompositionCache
}

// =============================================================================
// IDENTITY EVALUATOR
// =============================================================================

export class IdentityEvaluator {
  private vocab: GraphVocab

  constructor(
    private executor: RawExecutor,
    vocab?: Partial<GraphVocab>,
  ) {
    this.vocab = resolveVocab(vocab)
  }

  /**
   * Fetch compositions for given root identities and their transitive dependencies.
   *
   * Returns ALL identities reachable from roots via composition edges,
   * enabling in-memory tree building without additional queries.
   *
   * @param rootIds - Identity IDs to fetch (and their transitive dependencies)
   * @param maxDepth - Maximum depth to traverse (default: 10)
   * @returns Map of identity ID to composition data
   */
  async batchFetchCompositions(
    rootIds: string[],
    maxDepth: number = 10,
  ): Promise<Map<string, IdentityComposition>> {
    if (rootIds.length === 0) return new Map()

    const v = this.vocab

    const query = `
      UNWIND $rootIds AS rootId
      MATCH (root:${v.identity} {id: rootId})
      OPTIONAL MATCH path = (root)-[:${v.union}|${v.intersect}|${v.exclude}*0..${maxDepth}]->(i:${v.identity})
      WITH DISTINCT coalesce(i, root) AS identity
      RETURN
        identity.id AS id,
        [(identity)-[:${v.union}]->(u:${v.identity}) | u.id] AS unions,
        [(identity)-[:${v.intersect}]->(n:${v.identity}) | n.id] AS intersects,
        [(identity)-[:${v.exclude}]->(e:${v.identity}) | e.id] AS excludes,
        size([(identity)-[:${v.perm}]->() | 1]) > 0 AS hasDirectPerms
    `

    const results = await this.executor.run<{
      id: string
      unions: (string | null)[]
      intersects: (string | null)[]
      excludes: (string | null)[]
      hasDirectPerms: boolean
    }>(query, { rootIds })

    const compositions = new Map<string, IdentityComposition>()
    for (const row of results) {
      compositions.set(row.id, {
        id: row.id,
        unions: row.unions.filter((u): u is string => u !== null),
        intersects: row.intersects.filter((i): i is string => i !== null),
        excludes: row.excludes.filter((e): e is string => e !== null),
        hasDirectPerms: row.hasDirectPerms ?? false,
      })
    }
    return compositions
  }

  /**
   * Evaluate a single identity, expanding its composition graph.
   *
   * @deprecated Use evalExpr for better performance (batch fetching).
   * This method makes O(N) sequential queries where N = graph size.
   */
  async evalIdentity(id: string, _visited: Set<string> = new Set()): Promise<IdentityExpr> {
    // Use evalExpr with a fresh cache - simpler and consistent behavior
    return this.evalExpr({ kind: 'identity', id })
  }

  /**
   * Evaluate an expression, expanding identity leaves outside scope nodes.
   *
   * Uses batch fetching to resolve entire composition graphs in O(1) database
   * round-trips instead of O(N) sequential queries.
   *
   * Scope nodes are preserved as-is (scoped subtrees not expanded).
   *
   * @param exprOrBuilder - Raw IdentityExpr or Expr builder
   * @param options - Optional settings for depth limit and request-scoped caching
   * @returns Fully resolved IdentityExpr with DB compositions expanded
   */
  async evalExpr(
    exprOrBuilder: IdentityExpr | ExprBuilder,
    options: EvalExprOptions = {},
  ): Promise<IdentityExpr> {
    const { maxDepth = 10, cache = new Map() } = options
    const expr = isExprBuilder(exprOrBuilder) ? exprOrBuilder.build() : exprOrBuilder

    // 1. Collect identity IDs outside scope nodes that need resolution
    const unscopedIds = this.collectUnscopedIdentities(expr)
    if (unscopedIds.length === 0) return expr

    // 2. Determine which IDs need fetching (not in cache)
    const uncachedIds = unscopedIds.filter((id) => !cache.has(id))

    // 3. Batch fetch all uncached compositions in single query
    if (uncachedIds.length > 0) {
      const fetched = await this.batchFetchCompositions(uncachedIds, maxDepth)
      for (const [id, composition] of fetched) {
        cache.set(id, composition)
      }
    }

    // 4. Build expression tree in-memory (no further I/O)
    return this.buildResolvedExpr(expr, cache)
  }

  /**
   * Collect all identity IDs from an expression tree, including inside scope nodes.
   * Scopes restrict WHERE permissions apply, not identity composition expansion.
   */
  private collectUnscopedIdentities(expr: IdentityExpr): string[] {
    const ids: string[] = []
    const collect = (e: IdentityExpr) => {
      switch (e.kind) {
        case 'identity':
          ids.push(e.id)
          break
        case 'scope':
          // Expand identities inside scopes — scopes restrict WHERE, not WHAT
          collect(e.expr)
          break
        case 'union':
        case 'intersect':
          for (const op of e.operands) collect(op)
          break
        case 'exclude':
          collect(e.base)
          for (const ex of e.excluded) collect(ex)
          break
      }
    }
    collect(expr)
    return [...new Set(ids)] // Dedupe
  }

  /**
   * Build resolved expression tree from compositions.
   * Operates entirely in-memory with no I/O.
   */
  private buildResolvedExpr(expr: IdentityExpr, compositions: CompositionCache): IdentityExpr {
    switch (expr.kind) {
      case 'identity':
        return this.buildExprFromCompositions(expr.id, compositions)
      case 'scope':
        // Expand identities inside scope, preserve scope wrapper
        return { kind: 'scope', scopes: expr.scopes, expr: this.buildResolvedExpr(expr.expr, compositions) }
      case 'union':
        return {
          kind: 'union',
          operands: expr.operands.map((op) => this.buildResolvedExpr(op, compositions)),
        }
      case 'intersect':
        return {
          kind: 'intersect',
          operands: expr.operands.map((op) => this.buildResolvedExpr(op, compositions)),
        }
      case 'exclude':
        return {
          kind: 'exclude',
          base: this.buildResolvedExpr(expr.base, compositions),
          excluded: expr.excluded.map((ex) => this.buildResolvedExpr(ex, compositions)),
        }
    }
  }

  /**
   * Build expression tree from composition data with cycle detection.
   *
   * @param id - Identity ID to build expression for
   * @param compositions - Fetched compositions cache
   * @param visited - Set of visited IDs in current path (for cycle detection)
   * @throws CycleDetectedError if a cycle is found
   * @throws IdentityNotFoundError if identity not in compositions
   * @throws InvalidIdentityError if identity has invalid composition
   */
  private buildExprFromCompositions(
    id: string,
    compositions: CompositionCache,
    visited: Set<string> = new Set(),
  ): IdentityExpr {
    // Cycle detection
    if (visited.has(id)) {
      throw new CycleDetectedError(id, Array.from(visited))
    }
    visited.add(id)

    // Missing identity - explicit error
    // Note: This can happen if composition graph exceeds maxDepth.
    // The query truncates at maxDepth, so deeper nodes won't be in the map.
    const composition = compositions.get(id)
    if (!composition) {
      throw new IdentityNotFoundError(id)
    }

    const { unions, intersects, excludes, hasDirectPerms } = composition

    // Exclude-only validation (must remain)
    if (excludes.length > 0 && unions.length === 0 && intersects.length === 0 && !hasDirectPerms) {
      throw new InvalidIdentityError(
        id,
        'Identity has only exclude composition edges with no base set',
      )
    }

    // Leaf node
    if (unions.length === 0 && intersects.length === 0 && excludes.length === 0) {
      return { kind: 'identity', id }
    }

    // Collect all operands for union/intersect, build list-based result
    const selfExpr: IdentityExpr = { kind: 'identity', id }

    // Build union operands
    const unionOperands: IdentityExpr[] = []
    if (hasDirectPerms) unionOperands.push(selfExpr)
    for (const unionId of unions) {
      unionOperands.push(
        this.buildExprFromCompositions(unionId, compositions, new Set(visited)),
      )
    }

    // Build intersect operands
    const intersectOperands: IdentityExpr[] = []
    for (const intersectId of intersects) {
      intersectOperands.push(
        this.buildExprFromCompositions(intersectId, compositions, new Set(visited)),
      )
    }

    // Build excluded list
    const excludedExprs: IdentityExpr[] = []
    for (const excludeId of excludes) {
      excludedExprs.push(
        this.buildExprFromCompositions(excludeId, compositions, new Set(visited)),
      )
    }

    // Assemble result
    let result: IdentityExpr

    // Start with union if we have union operands
    if (unionOperands.length >= 2) {
      result = { kind: 'union', operands: unionOperands }
    } else if (unionOperands.length === 1) {
      result = unionOperands[0]!
    } else if (!hasDirectPerms && intersectOperands.length === 0) {
      throw new InvalidIdentityError(id, 'Identity has no permissions and no valid composition')
    } else {
      // No unions, no self perms — shouldn't normally reach here with excludes
      // but handle gracefully
      result = selfExpr
    }

    // Apply intersects
    if (intersectOperands.length > 0) {
      result = { kind: 'intersect', operands: [result, ...intersectOperands] }
    }

    // Apply excludes
    if (excludedExprs.length > 0) {
      result = { kind: 'exclude', base: result, excluded: excludedExprs }
    }

    return result
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
