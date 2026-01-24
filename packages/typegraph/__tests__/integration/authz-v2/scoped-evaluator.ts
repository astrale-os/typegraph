/**
 * Scoped Evaluator
 *
 * Applies scope restrictions to permission checks.
 * Scopes restrict permissions by nodes (subtrees) and/or permission types.
 */

import type { IdentityExpr, Scope } from './types'
import { type CypherGenerator } from './cypher-generator'

// =============================================================================
// SCOPED EVALUATOR
// =============================================================================

export class ScopedEvaluator {
  constructor(private cypherGen: CypherGenerator) {}

  /**
   * Generate scoped permission check Cypher.
   *
   * Algorithm:
   * 1. No scopes = unrestricted, just permission check
   * 2. Filter scopes that allow this perm
   * 3. If no scope allows this perm, return 'false'
   * 4. For each applicable scope, build (nodeCheck AND permCheck)
   * 5. OR all scope checks together
   *
   * @param expr - Identity expression tree
   * @param targetVar - Cypher variable for target node
   * @param perm - Permission being requested
   * @param scopes - Scope restrictions (OR'd together)
   */
  scopedPermCheck(expr: IdentityExpr, targetVar: string, perm: string, scopes?: Scope[]): string {
    // No scopes = unrestricted
    if (!scopes?.length) {
      return `(${this.cypherGen.toPermCheck(expr, targetVar, perm)})`
    }

    // Filter scopes that allow this permission
    const applicableScopes = scopes.filter(
      (scope) => !scope.perms?.length || scope.perms.includes(perm),
    )

    // No scope allows this permission
    if (applicableScopes.length === 0) {
      return 'false'
    }

    // Generate permission check once (reused across scopes)
    const permCheck = this.cypherGen.toPermCheck(expr, targetVar, perm)

    // Build OR of all applicable scope checks
    const scopeChecks = applicableScopes.map((scope) => {
      // Empty nodes = anywhere
      if (!scope.nodes?.length) {
        return permCheck
      }

      // Combine node scope check AND permission check
      const nodeCheck = this.cypherGen.nodeInScope(targetVar, scope.nodes)
      return `(${nodeCheck} AND ${permCheck})`
    })

    // Single scope: no need for outer parens
    if (scopeChecks.length === 1) {
      return `(${scopeChecks[0]})`
    }

    // Multiple scopes: OR them together
    return `(${scopeChecks.join(' OR ')})`
  }
}

/**
 * Create a scoped evaluator instance.
 */
export function createScopedEvaluator(cypherGen: CypherGenerator): ScopedEvaluator {
  return new ScopedEvaluator(cypherGen)
}
