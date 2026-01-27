/**
 * Cypher Generator
 *
 * Generates Cypher WHERE clauses for permission checks from identity expression trees.
 * Supports principal filtering on leaf nodes with empty-set propagation.
 */

import type { IdentityExpr, CypherGeneratorConfig, Scope } from './types'
import { anyScopeAllows } from './scope-utils'

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: CypherGeneratorConfig = {
  maxDepth: 20,
  useExistsSyntax: false,
}

// =============================================================================
// CYPHER GENERATOR
// =============================================================================

export class CypherGenerator {
  private config: CypherGeneratorConfig

  constructor(config: Partial<CypherGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  setConfig(config: Partial<CypherGeneratorConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Generate pattern predicate for permission check.
   */
  private patternPermCheck(targetVar: string, identityId: string, perm: string): string {
    return `(${targetVar})-[:hasParent*0..${this.config.maxDepth}]->(:Node)<-[:hasPerm {perm: '${perm}'}]-(:Identity {id: '${identityId}'})`
  }

  /**
   * Generate node scope check (is target in subtree?).
   */
  nodeInScope(targetVar: string, scopeIds: string[]): string {
    if (scopeIds.length === 0) return 'true'

    const patterns = scopeIds.map(
      (id) => `(${targetVar})-[:hasParent*0..${this.config.maxDepth}]->(:Node {id: '${id}'})`,
    )

    return patterns.length === 1 ? patterns[0]! : `(${patterns.join(' OR ')})`
  }

  /**
   * Generate Cypher WHERE clause for permission check with principal filtering.
   *
   * Principal filtering applies at leaf nodes (kind: 'identity'):
   * - If scopes don't allow the principal+perm, returns 'false' (empty set)
   * - Empty sets propagate: A ∪ ∅ = A, A ∩ ∅ = ∅, A \ ∅ = A
   *
   * @param expr - Identity expression tree
   * @param targetVar - Cypher variable for target node
   * @param perm - Permission being requested
   * @param principal - Principal invoking the access check. If undefined,
   *                    identities with principal restrictions are filtered out (empty set).
   */
  toPermCheck(expr: IdentityExpr, targetVar: string, perm: string, principal?: string): string {
    switch (expr.kind) {
      case 'identity':
        return this.identityPermCheck(expr, targetVar, perm, principal)

      case 'union': {
        const left = this.toPermCheck(expr.left, targetVar, perm, principal)
        const right = this.toPermCheck(expr.right, targetVar, perm, principal)
        // A ∪ ∅ = A, ∅ ∪ A = A, ∅ ∪ ∅ = ∅
        if (left === 'false' && right === 'false') return 'false'
        if (left === 'false') return right
        if (right === 'false') return left
        return `(${left} OR ${right})`
      }

      case 'intersect': {
        const left = this.toPermCheck(expr.left, targetVar, perm, principal)
        const right = this.toPermCheck(expr.right, targetVar, perm, principal)
        // A ∩ ∅ = ∅, ∅ ∩ A = ∅
        if (left === 'false' || right === 'false') return 'false'
        return `(${left} AND ${right})`
      }

      case 'exclude': {
        const left = this.toPermCheck(expr.left, targetVar, perm, principal)
        const right = this.toPermCheck(expr.right, targetVar, perm, principal)
        // ∅ \ A = ∅, A \ ∅ = A
        if (left === 'false') return 'false'
        if (right === 'false') return left
        return `(${left} AND NOT ${right})`
      }
    }
  }

  /**
   * Generate permission check for an identity leaf with scope filtering.
   *
   * Algorithm:
   * 1. Filter scopes by principal+perm
   * 2. If no scope allows → return 'false' (empty set)
   * 3. Generate base permission pattern
   * 4. If applicable scopes have node restrictions, combine with AND
   * 5. Multiple applicable scopes are OR'd
   */
  private identityPermCheck(
    expr: Extract<IdentityExpr, { kind: 'identity' }>,
    targetVar: string,
    perm: string,
    principal?: string,
  ): string {
    const { allowed, applicableScopes } = anyScopeAllows(expr.scopes, principal, perm)

    // No scope allows this principal+perm → empty set
    if (!allowed) {
      return 'false'
    }

    // Generate base permission check
    const permPattern = this.patternPermCheck(targetVar, expr.id, perm)

    // No scopes or no applicable scopes = unrestricted (just perm check)
    if (applicableScopes.length === 0) {
      return permPattern
    }

    // Build scope checks: each applicable scope generates (nodeCheck AND permCheck) or just permCheck
    const scopeChecks = applicableScopes.map((scope) => {
      if (!scope.nodes?.length) {
        return permPattern
      }
      const nodeCheck = this.nodeInScope(targetVar, scope.nodes)
      return `(${nodeCheck} AND ${permPattern})`
    })

    // Single scope: return directly
    if (scopeChecks.length === 1) {
      return scopeChecks[0]!
    }

    // Multiple scopes: OR them together
    return `(${scopeChecks.join(' OR ')})`
  }
}

/**
 * Create a Cypher generator instance.
 */
export function createCypherGenerator(config?: Partial<CypherGeneratorConfig>): CypherGenerator {
  return new CypherGenerator(config)
}
