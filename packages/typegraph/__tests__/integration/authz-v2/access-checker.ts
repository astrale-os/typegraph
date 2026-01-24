/**
 * Access Checker
 *
 * Main entry point for AUTH_V2 access checks.
 * Implements the two-phase access check algorithm.
 */

import type {
  AccessResult,
  AccessCheckerConfig,
  IdentityInput,
  IdentityExpr,
  RawExecutor,
} from './types'
import { type IdentityEvaluator, createIdentityEvaluator } from './identity-evaluator'
import { type CypherGenerator, createCypherGenerator } from './cypher-generator'
import { type ScopedEvaluator, createScopedEvaluator } from './scoped-evaluator'

// =============================================================================
// ACCESS CHECKER
// =============================================================================

export class AccessChecker {
  private identityEvaluator: IdentityEvaluator
  private cypherGen: CypherGenerator
  private scopedEval: ScopedEvaluator
  private initialized = false

  // Simple caches
  private exprCache = new Map<string, IdentityExpr>()
  private typeCache = new Map<string, string | null>()

  constructor(
    private executor: RawExecutor,
    private config: AccessCheckerConfig = {},
  ) {
    this.identityEvaluator = createIdentityEvaluator(executor)
    this.cypherGen = createCypherGenerator({ maxDepth: config.maxDepth ?? 20 })
    this.scopedEval = createScopedEvaluator(this.cypherGen)
  }

  /**
   * Initialize the checker (probe EXISTS syntax).
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return

    const supportsExists = await this.identityEvaluator.supportsExistsSyntax()
    this.cypherGen.setConfig({ useExistsSyntax: supportsExists })
    this.initialized = true
  }

  /**
   * Two-phase access check as per AUTH_V2.md.
   *
   * Phase 1: Type check (conditional)
   *   - Get target's type via ofType edge
   *   - If has type: check if any typeIdentities has 'use' on type
   *   - If no type: skip
   *
   * Phase 2: Target check
   *   - Check if any targetIdentities has requested perm on target
   *
   * Formula:
   *   typeCheck   = target has no type OR ANY(typeIdentities has 'use' on type)
   *   targetCheck = ANY(targetIdentities has perm on target)
   *   hasAccess   = typeCheck AND targetCheck
   */
  async hasAccess(
    typeIdentities: IdentityInput[],
    targetIdentities: IdentityInput[],
    targetId: string,
    perm: string,
  ): Promise<AccessResult> {
    await this.initialize()

    // Phase 1: Type check (only if target has a type)
    const typeId = await this.getTargetTypeCached(targetId)

    if (typeId) {
      // Target has a type - need type check
      if (typeIdentities.length === 0) {
        return { granted: false, reason: 'type' }
      }

      const typePass = await this.checkPerm(typeIdentities, typeId, 'use')
      if (!typePass) {
        return { granted: false, reason: 'type' }
      }
    }

    // Phase 2: Target check
    if (targetIdentities.length === 0) {
      return { granted: false, reason: 'target' }
    }

    const targetPass = await this.checkPerm(targetIdentities, targetId, perm)

    if (!targetPass) {
      return { granted: false, reason: 'target' }
    }

    return { granted: true }
  }

  /**
   * Build combined permission check for multiple identities.
   */
  private async buildPermCheck(
    identities: IdentityInput[],
    targetVar: string,
    perm: string,
  ): Promise<string> {
    if (identities.length === 0) {
      return 'false'
    }

    const parts = await Promise.all(
      identities.map(async ({ identityId, scopes }) => {
        const expr = await this.evalIdentityCached(identityId)
        return this.scopedEval.scopedPermCheck(expr, targetVar, perm, scopes)
      }),
    )

    return parts.join(' OR ')
  }

  /**
   * Execute permission check against graph.
   */
  private async checkPerm(
    identities: IdentityInput[],
    targetId: string,
    perm: string,
  ): Promise<boolean> {
    if (identities.length === 0) {
      return false
    }

    const permCheck = await this.buildPermCheck(identities, 'target', perm)

    // Short-circuit if all scopes deny
    if (permCheck === 'false') {
      return false
    }

    // Use :Node label for indexed lookup
    const query = `
      MATCH (target:Node {id: $targetId})
      WHERE ${permCheck}
      RETURN true AS hasPerm
    `

    const results = await this.executor.run<{ hasPerm: boolean }>(query, { targetId })
    return results[0]?.hasPerm ?? false
  }

  /**
   * Get target's type via ofType edge.
   */
  private async getTargetType(targetId: string): Promise<string | null> {
    // Use :Node label for indexed lookup
    const query = `
      MATCH (t:Node {id: $targetId})
      OPTIONAL MATCH (t)-[:ofType]->(type:Type)
      RETURN type.id AS typeId
    `

    const results = await this.executor.run<{ typeId: string | null }>(query, { targetId })
    return results[0]?.typeId ?? null
  }

  /**
   * Get target type with caching.
   */
  private async getTargetTypeCached(targetId: string): Promise<string | null> {
    if (this.typeCache.has(targetId)) {
      return this.typeCache.get(targetId)!
    }

    const typeId = await this.getTargetType(targetId)
    this.typeCache.set(targetId, typeId)
    return typeId
  }

  /**
   * Evaluate identity with caching.
   */
  private async evalIdentityCached(id: string): Promise<IdentityExpr> {
    if (this.exprCache.has(id)) {
      return this.exprCache.get(id)!
    }

    const expr = await this.identityEvaluator.evalIdentity(id)
    this.exprCache.set(id, expr)
    return expr
  }

  /**
   * Clear all caches.
   */
  clearCache(): void {
    this.exprCache.clear()
    this.typeCache.clear()
  }
}

/**
 * Create an access checker instance.
 */
export function createAccessChecker(
  executor: RawExecutor,
  config?: AccessCheckerConfig,
): AccessChecker {
  return new AccessChecker(executor, config)
}
