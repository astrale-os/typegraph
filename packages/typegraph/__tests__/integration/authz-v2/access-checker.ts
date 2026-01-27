/**
 * Access Checker
 *
 * Main entry point for AUTH_V2 access checks.
 * Single responsibility: expression → cypher → decision
 *
 * Two APIs:
 * - checkAccess (hot path): Simple grant/deny
 * - explainAccess (cold path): Detailed explanation
 */

import type {
  AccessDecision,
  AccessExplanation,
  PhaseExplanation,
  LeafEvaluation,
  FilterDetail,
  Subject,
  AccessCheckerConfig,
  IdentityExpr,
  RawExecutor,
  Scope,
  NodeId,
  IdentityId,
  PermissionT,
} from './types'

// =============================================================================
// ACCESS CHECKER
// =============================================================================

export class AccessChecker {
  private maxDepth: number
  private typeCache = new Map<NodeId, NodeId | null>()

  constructor(
    private executor: RawExecutor,
    config: AccessCheckerConfig = {},
  ) {
    this.maxDepth = config.maxDepth ?? 20
  }

  // ===========================================================================
  // HOT PATH: checkAccess
  // ===========================================================================

  /**
   * Hot path: Simple access check returning only grant/deny.
   * Takes subject with expressions + principal for scope filtering.
   */
  async checkAccess(
    subject: Subject,
    targetId: NodeId,
    perm: PermissionT,
    principal: IdentityId,
  ): Promise<AccessDecision> {
    const { forType, forTarget } = subject

    // Phase 1: Type check (only if target has a type)
    const typeId = await this.getTargetType(targetId)

    if (typeId) {
      // Type check is NOT scoped by principal - always unrestricted
      const typeCypher = this.toCypher(forType, 'target', 'use', undefined)
      if (typeCypher === 'false') {
        return { granted: false, deniedBy: 'type' }
      }

      const typeGranted = await this.executeCheck(typeCypher, typeId)
      if (!typeGranted) {
        return { granted: false, deniedBy: 'type' }
      }
    }

    // Phase 2: Target check (scoped by principal)
    const targetCypher = this.toCypher(forTarget, 'target', perm, principal)
    if (targetCypher === 'false') {
      return { granted: false, deniedBy: 'target' }
    }

    const targetGranted = await this.executeCheck(targetCypher, targetId)
    return targetGranted ? { granted: true } : { granted: false, deniedBy: 'target' }
  }

  /**
   * Execute a permission check query.
   */
  private async executeCheck(cypherCheck: string, targetId: NodeId): Promise<boolean> {
    const query = `
      MATCH (target:Node {id: $targetId})
      WHERE ${cypherCheck}
      RETURN true AS found
      LIMIT 1
    `
    const results = await this.executor.run<{ found: boolean }>(query, { targetId })
    return results[0]?.found ?? false
  }

  // ===========================================================================
  // COLD PATH: explainAccess
  // ===========================================================================

  /**
   * Cold path: Detailed access explanation for debugging.
   */
  async explainAccess(
    subject: Subject,
    targetId: NodeId,
    perm: PermissionT,
    principal: IdentityId,
  ): Promise<AccessExplanation> {
    const { forType, forTarget } = subject

    // Get target type
    const typeId = await this.getTargetType(targetId)

    // Phase 1: Type check (NOT scoped)
    let typeCheck: PhaseExplanation
    let typeGranted = true

    if (typeId) {
      typeCheck = await this.explainPhase(forType, typeId, 'use', undefined)
      typeGranted = typeCheck.leaves.some((l) => l.status === 'granted')
    } else {
      typeCheck = { expression: forType, leaves: [], cypher: 'true' }
    }

    // Phase 2: Target check (scoped by principal)
    const targetCheck = await this.explainPhase(forTarget, targetId, perm, principal)
    const targetGranted = targetCheck.leaves.some((l) => l.status === 'granted')

    const granted = typeGranted && targetGranted

    return {
      targetId,
      perm,
      principal,
      granted,
      deniedBy: !granted ? (!typeGranted ? 'type' : 'target') : undefined,
      typeCheck,
      targetCheck,
    }
  }

  /**
   * Explain a single phase with full leaf details.
   */
  private async explainPhase(
    expr: IdentityExpr,
    targetId: NodeId,
    perm: PermissionT,
    principal: IdentityId | undefined,
  ): Promise<PhaseExplanation> {
    // Collect leaves from expression tree
    const leaves = this.collectLeaves(expr, [], principal, perm)

    // Generate cypher
    const cypher = this.toCypher(expr, 'target', perm, principal)

    // Query details for non-filtered leaves
    const activeLeaves = leaves.filter((l) => l.status !== 'filtered')
    if (activeLeaves.length > 0) {
      await this.queryLeafDetails(activeLeaves, targetId, perm)
    }

    return {
      expression: expr,
      leaves,
      cypher,
    }
  }

  /**
   * Collect all leaves from expression tree with path tracking.
   */
  private collectLeaves(
    expr: IdentityExpr,
    path: number[],
    principal: IdentityId | undefined,
    perm: PermissionT,
  ): LeafEvaluation[] {
    switch (expr.kind) {
      case 'identity': {
        const filterResult = this.checkFilter(expr.scopes, principal, perm)

        if (!filterResult.allowed) {
          return [
            {
              path,
              identityId: expr.id,
              status: 'filtered',
              filterDetail: filterResult.details,
            },
          ]
        }

        // Will be updated by queryLeafDetails
        return [
          {
            path,
            identityId: expr.id,
            status: 'missing', // Placeholder, updated after query
          },
        ]
      }

      case 'union':
      case 'intersect':
      case 'exclude': {
        const leftLeaves = this.collectLeaves(expr.left, [...path, 0], principal, perm)
        const rightLeaves = this.collectLeaves(expr.right, [...path, 1], principal, perm)
        return [...leftLeaves, ...rightLeaves]
      }
    }
  }

  // ===========================================================================
  // SHARED: Scope Validation
  // ===========================================================================

  /**
   * Check if a single scope allows the given principal and perm.
   */
  private scopePasses(
    scope: Scope,
    principal: IdentityId | undefined,
    perm: PermissionT,
  ): { passes: boolean; failedCheck?: 'principal' | 'perm' } {
    if (scope.principals?.length && (!principal || !scope.principals.includes(principal))) {
      return { passes: false, failedCheck: 'principal' }
    }
    if (scope.perms?.length && !scope.perms.includes(perm)) {
      return { passes: false, failedCheck: 'perm' }
    }
    return { passes: true }
  }

  /**
   * Check if scopes allow the request (for cold path).
   */
  private checkFilter(
    scopes: Scope[] | undefined,
    principal: IdentityId | undefined,
    perm: PermissionT,
  ): { allowed: boolean; details?: FilterDetail[] } {
    if (!scopes?.length) {
      return { allowed: true }
    }

    const details: FilterDetail[] = []

    for (let i = 0; i < scopes.length; i++) {
      const result = this.scopePasses(scopes[i]!, principal, perm)
      if (result.passes) {
        return { allowed: true }
      }
      details.push({ scopeIndex: i, failedCheck: result.failedCheck! })
    }

    return { allowed: false, details }
  }

  /**
   * Query grantedAt, inheritancePath, and searchedPath for each leaf.
   */
  private async queryLeafDetails(
    leaves: LeafEvaluation[],
    targetId: NodeId,
    perm: PermissionT,
  ): Promise<void> {
    const identityIds = [...new Set(leaves.map((l) => l.identityId))]

    for (const identityId of identityIds) {
      const query = `
        MATCH (target:Node {id: $targetId})
        MATCH path = (target)-[:hasParent*0..${this.maxDepth}]->(ancestor:Node)
        OPTIONAL MATCH (ancestor)<-[:hasPerm {perm: $perm}]-(i:Identity {id: $identityId})
        WITH target, ancestor, path, i
        ORDER BY length(path)
        WITH collect({
          ancestor: ancestor.id,
          pathNodes: [n IN nodes(path) | n.id],
          hasPermission: i IS NOT NULL
        }) AS results
        RETURN results
      `

      const queryResults = await this.executor.run<{
        results: Array<{ ancestor: string; pathNodes: string[]; hasPermission: boolean }>
      }>(query, { targetId, perm, identityId })

      const results = queryResults[0]?.results ?? []
      const grantedResult = results.find((r) => r.hasPermission)
      const searchedPath = results.length > 0 ? (results[results.length - 1]?.pathNodes ?? []) : []

      for (const leaf of leaves) {
        if (leaf.identityId !== identityId) continue

        if (grantedResult) {
          leaf.status = 'granted'
          leaf.grantedAt = grantedResult.ancestor
          leaf.inheritancePath = grantedResult.pathNodes
        } else {
          leaf.status = 'missing'
          leaf.searchedPath = searchedPath
        }
      }
    }
  }

  // ===========================================================================
  // SHARED: Cypher Generation
  // ===========================================================================

  /**
   * Generate Cypher WHERE clause for permission check.
   */
  private toCypher(
    expr: IdentityExpr,
    targetVar: string,
    perm: PermissionT,
    principal: IdentityId | undefined,
  ): string {
    switch (expr.kind) {
      case 'identity':
        return this.identityToCypher(expr, targetVar, perm, principal)

      case 'union': {
        const left = this.toCypher(expr.left, targetVar, perm, principal)
        const right = this.toCypher(expr.right, targetVar, perm, principal)
        if (left === 'false' && right === 'false') return 'false'
        if (left === 'false') return right
        if (right === 'false') return left
        return `(${left} OR ${right})`
      }

      case 'intersect': {
        const left = this.toCypher(expr.left, targetVar, perm, principal)
        const right = this.toCypher(expr.right, targetVar, perm, principal)
        if (left === 'false' || right === 'false') return 'false'
        return `(${left} AND ${right})`
      }

      case 'exclude': {
        const left = this.toCypher(expr.left, targetVar, perm, principal)
        const right = this.toCypher(expr.right, targetVar, perm, principal)
        if (left === 'false') return 'false'
        if (right === 'false') return left
        return `(${left} AND NOT ${right})`
      }
    }
  }

  /**
   * Generate Cypher for a single identity with scope filtering.
   */
  private identityToCypher(
    expr: Extract<IdentityExpr, { kind: 'identity' }>,
    targetVar: string,
    perm: PermissionT,
    principal: IdentityId | undefined,
  ): string {
    const scopes = expr.scopes

    // Check if allowed by scopes
    const { allowed, applicableScopes } = this.scopesAllow(scopes, principal, perm)
    if (!allowed) return 'false'

    // Base permission pattern
    const permPattern = `(${targetVar})-[:hasParent*0..${this.maxDepth}]->(:Node)<-[:hasPerm {perm: '${perm}'}]-(:Identity {id: '${expr.id}'})`

    // No scopes or no node restrictions
    if (applicableScopes.length === 0) {
      return permPattern
    }

    // Apply node scope restrictions
    const scopeChecks = applicableScopes.map((scope) => {
      if (!scope.nodes?.length) return permPattern

      const nodePatterns = scope.nodes.map(
        (id) => `(${targetVar})-[:hasParent*0..${this.maxDepth}]->(:Node {id: '${id}'})`,
      )
      const nodeCheck =
        nodePatterns.length === 1 ? nodePatterns[0] : `(${nodePatterns.join(' OR ')})`
      return `(${nodeCheck} AND ${permPattern})`
    })

    return scopeChecks.length === 1 ? scopeChecks[0]! : `(${scopeChecks.join(' OR ')})`
  }

  /**
   * Check which scopes allow the given principal and perm.
   */
  private scopesAllow(
    scopes: Scope[] | undefined,
    principal: IdentityId | undefined,
    perm: PermissionT,
  ): { allowed: boolean; applicableScopes: Scope[] } {
    if (!scopes?.length) {
      return { allowed: true, applicableScopes: [] }
    }

    const applicableScopes = scopes.filter(
      (scope) => this.scopePasses(scope, principal, perm).passes,
    )

    return {
      allowed: applicableScopes.length > 0,
      applicableScopes,
    }
  }

  // ===========================================================================
  // SHARED: Utilities
  // ===========================================================================

  /**
   * Get target's type via ofType edge (cached).
   */
  private async getTargetType(targetId: NodeId): Promise<NodeId | null> {
    if (this.typeCache.has(targetId)) {
      return this.typeCache.get(targetId)!
    }

    const query = `
      MATCH (t:Node {id: $targetId})
      OPTIONAL MATCH (t)-[:ofType]->(type:Type)
      RETURN type.id AS typeId
      LIMIT 1
    `

    const results = await this.executor.run<{ typeId: NodeId | null }>(query, { targetId })
    const typeId = results[0]?.typeId ?? null
    this.typeCache.set(targetId, typeId)
    return typeId
  }

  /**
   * Clear type cache.
   */
  clearCache(): void {
    this.typeCache.clear()
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createAccessChecker(
  executor: RawExecutor,
  config?: AccessCheckerConfig,
): AccessChecker {
  return new AccessChecker(executor, config)
}
