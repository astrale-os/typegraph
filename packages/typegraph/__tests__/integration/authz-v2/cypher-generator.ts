/**
 * Cypher Generator
 *
 * Generates Cypher WHERE clauses for permission checks from identity expression trees.
 */

import type { IdentityExpr, CypherGeneratorConfig } from './types'

// =============================================================================
// DEFAULT CONFIGURATION
// =============================================================================

const DEFAULT_CONFIG: CypherGeneratorConfig = {
  maxDepth: 20,
  useExistsSyntax: false, // Default to pattern predicates for FalkorDB compatibility
}

// =============================================================================
// CYPHER GENERATOR
// =============================================================================

export class CypherGenerator {
  private config: CypherGeneratorConfig

  constructor(config: Partial<CypherGeneratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Update configuration (e.g., after probing EXISTS syntax).
   */
  setConfig(config: Partial<CypherGeneratorConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Generate pattern predicate for permission check.
   * Uses FalkorDB-compatible pattern in WHERE clause.
   * The outer MATCH should use :Node for indexed lookup.
   */
  private patternPermCheck(targetVar: string, identityId: string, perm: string): string {
    return `(${targetVar})-[:hasParent*0..${this.config.maxDepth}]->(:Node)<-[:hasPerm {perm: '${perm}'}]-(:Identity {id: '${identityId}'})`
  }

  /**
   * Generate permission check for a single identity.
   */
  private basePermCheck(targetVar: string, identityId: string, perm: string): string {
    return this.patternPermCheck(targetVar, identityId, perm)
  }

  /**
   * Generate Cypher WHERE clause for permission check.
   *
   * Recursively processes expression tree:
   * - base: Single EXISTS/size check
   * - union: (left OR right)
   * - intersect: (left AND right)
   */
  toPermCheck(expr: IdentityExpr, targetVar: string, perm: string): string {
    switch (expr.kind) {
      case 'base':
        return this.basePermCheck(targetVar, expr.id, perm)
      case 'union':
        return `(${this.toPermCheck(expr.left, targetVar, perm)} OR ${this.toPermCheck(expr.right, targetVar, perm)})`
      case 'intersect':
        return `(${this.toPermCheck(expr.left, targetVar, perm)} AND ${this.toPermCheck(expr.right, targetVar, perm)})`
    }
  }

  /**
   * Generate node scope check (is target in subtree?).
   * Uses pattern predicate with OR for each scope node.
   */
  nodeInScope(targetVar: string, scopeIds: string[]): string {
    if (scopeIds.length === 0) return 'true'

    // Generate pattern predicate for each scope node (use :Node for index)
    const patterns = scopeIds.map(
      (id) => `(${targetVar})-[:hasParent*0..${this.config.maxDepth}]->(:Node {id: '${id}'})`,
    )

    return patterns.length === 1 ? patterns[0]! : `(${patterns.join(' OR ')})`
  }
}

/**
 * Create a Cypher generator instance.
 */
export function createCypherGenerator(config?: Partial<CypherGeneratorConfig>): CypherGenerator {
  return new CypherGenerator(config)
}
