/**
 * Access Checker
 *
 * Main entry point for AUTH_V2 access checks.
 * Single responsibility: expression → cypher → decision
 *
 * Two APIs:
 * - checkAccess (hot path): Simple grant/deny
 * - explainAccess (cold path): Detailed explanation
 *
 * Security: All inputs are validated before Cypher generation to prevent injection.
 */

import type {
  AccessDecision,
  AccessExplanation,
  PhaseExplanation,
  LeafEvaluation,
  FilterDetail,
  Grant,
  AccessCheckerConfig,
  IdentityExpr,
  RawExecutor,
  Scope,
  NodeId,
  IdentityId,
  PermissionT,
} from './types'

// =============================================================================
// INPUT VALIDATION (Security: Cypher Injection Prevention)
// =============================================================================

/**
 * Regex for safe Cypher identifiers.
 * Allows: alphanumeric, underscore, hyphen, colon (for namespaced IDs)
 * Max length: 256 chars to prevent DoS
 */
const SAFE_ID_REGEX = /^[a-zA-Z0-9_:-]{1,256}$/

/**
 * Validate a string is safe for Cypher interpolation.
 * Throws if validation fails.
 */
function validateCypherId(value: string, fieldName: string): void {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`)
  }
  if (!SAFE_ID_REGEX.test(value)) {
    throw new Error(
      `Invalid ${fieldName}: "${value}" must contain only alphanumeric characters, underscores, hyphens, and colons (max 256 chars)`,
    )
  }
}

/**
 * Validate all IDs in an expression tree.
 */
/**
 * Exhaustive check helper - throws if an unknown expression kind is encountered.
 */
function throwExhaustiveCheck(expr: never): never {
  throw new Error(`Unknown expression kind: ${(expr as { kind: string }).kind}`)
}

/**
 * Validate all IDs in a scope array.
 */
function validateScopes(scopes: Scope[] | undefined): void {
  if (!scopes) return
  for (const scope of scopes) {
    if (scope.nodes) {
      for (const nodeId of scope.nodes) {
        validateCypherId(nodeId, 'scope node ID')
      }
    }
    if (scope.principals) {
      for (const principalId of scope.principals) {
        validateCypherId(principalId, 'scope principal ID')
      }
    }
    if (scope.perms) {
      for (const perm of scope.perms) {
        validateCypherId(perm, 'scope permission')
      }
    }
  }
}

const MAX_EXPRESSION_DEPTH = 100

function validateExpression(expr: IdentityExpr, depth: number = 0): void {
  if (depth > MAX_EXPRESSION_DEPTH) {
    throw new Error(`Expression tree exceeds maximum depth of ${MAX_EXPRESSION_DEPTH}`)
  }

  switch (expr.kind) {
    case 'identity':
      validateCypherId(expr.id, 'identity ID')
      validateScopes(expr.scopes)
      break
    case 'union':
    case 'intersect':
    case 'exclude':
      validateExpression(expr.left, depth + 1)
      validateExpression(expr.right, depth + 1)
      break
    default:
      throwExhaustiveCheck(expr)
  }
}

/**
 * Validate all inputs for an access check.
 */
function validateAccessInputs(
  grant: Grant,
  resourceId: NodeId,
  perm: PermissionT,
  principal: IdentityId,
): void {
  validateCypherId(resourceId, 'resourceId')
  validateCypherId(perm, 'perm')
  validateCypherId(principal, 'principal')
  validateExpression(grant.forType)
  validateExpression(grant.forResource)
}

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
   * Takes grant with expressions + principal for scope filtering.
   */
  async checkAccess(
    grant: Grant,
    resourceId: NodeId,
    perm: PermissionT,
    principal: IdentityId,
  ): Promise<AccessDecision> {
    validateAccessInputs(grant, resourceId, perm, principal)

    const { forType, forResource } = grant

    // Phase 1: Type check (only if target has a type)
    const typeId = await this.getTargetType(resourceId)

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
    const targetCypher = this.toCypher(forResource, 'target', perm, principal)
    if (targetCypher === 'false') {
      return { granted: false, deniedBy: 'resource' }
    }

    const targetGranted = await this.executeCheck(targetCypher, resourceId)
    return targetGranted ? { granted: true } : { granted: false, deniedBy: 'resource' }
  }

  /**
   * Execute a permission check query.
   */
  private async executeCheck(cypherCheck: string, resourceId: NodeId): Promise<boolean> {
    const query = `
      MATCH (target:Node {id: $resourceId})
      WHERE ${cypherCheck}
      RETURN true AS found
      LIMIT 1
    `
    const results = await this.executor.run<{ found: boolean }>(query, { resourceId })
    return results[0]?.found ?? false
  }

  // ===========================================================================
  // COLD PATH: explainAccess
  // ===========================================================================

  /**
   * Cold path: Detailed access explanation for debugging.
   */
  async explainAccess(
    grant: Grant,
    resourceId: NodeId,
    perm: PermissionT,
    principal: IdentityId,
  ): Promise<AccessExplanation> {
    validateAccessInputs(grant, resourceId, perm, principal)

    const { forType, forResource } = grant

    // Get target type
    const typeId = await this.getTargetType(resourceId)

    // Phase 1: Type check (NOT scoped)
    let typeCheck: PhaseExplanation
    let typeGranted = true

    if (typeId) {
      typeCheck = await this.explainPhase(forType, typeId, 'use', undefined)
      // Correctly evaluate expression tree semantics
      typeGranted = this.evaluateGranted(forType, typeCheck.leaves)
    } else {
      typeCheck = { expression: forType, leaves: [], cypher: 'true' }
    }

    // Phase 2: Target check (scoped by principal)
    const resourceCheck = await this.explainPhase(forResource, resourceId, perm, principal)
    // Correctly evaluate expression tree semantics
    const targetGranted = this.evaluateGranted(forResource, resourceCheck.leaves)

    const granted = typeGranted && targetGranted

    return {
      resourceId,
      perm,
      principal,
      granted,
      deniedBy: !granted ? (!typeGranted ? 'type' : 'resource') : undefined,
      typeCheck,
      resourceCheck,
    }
  }

  /**
   * Explain a single phase with full leaf details.
   */
  private async explainPhase(
    expr: IdentityExpr,
    resourceId: NodeId,
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
      await this.queryLeafDetails(activeLeaves, resourceId, perm)
    }

    return {
      expression: expr,
      leaves,
      cypher,
    }
  }

  /**
   * Evaluate whether expression is granted based on leaf statuses.
   * This correctly implements expression semantics:
   * - union: left OR right
   * - intersect: left AND right
   * - exclude: left AND NOT right
   */
  evaluateGranted(expr: IdentityExpr, leaves: LeafEvaluation[], path: number[] = []): boolean {
    switch (expr.kind) {
      case 'identity': {
        const pathKey = path.join(',')
        const leaf = leaves.find((l) => l.path.join(',') === pathKey)
        return leaf?.status === 'granted'
      }
      case 'union':
        return (
          this.evaluateGranted(expr.left, leaves, [...path, 0]) ||
          this.evaluateGranted(expr.right, leaves, [...path, 1])
        )
      case 'intersect':
        return (
          this.evaluateGranted(expr.left, leaves, [...path, 0]) &&
          this.evaluateGranted(expr.right, leaves, [...path, 1])
        )
      case 'exclude':
        return (
          this.evaluateGranted(expr.left, leaves, [...path, 0]) &&
          !this.evaluateGranted(expr.right, leaves, [...path, 1])
        )
      default:
        throwExhaustiveCheck(expr)
    }
  }

  /**
   * Collect all leaves from expression tree with path tracking.
   * Extracts node restrictions from applicable scopes for cold path consistency.
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

        // Extract node restrictions from applicable scopes
        // If ANY applicable scope has no node restriction, permission is valid anywhere
        // Otherwise, permission is valid only if target is in one of the restricted subtrees
        const applicableScopes = filterResult.applicableScopes ?? []
        let nodeRestrictions: NodeId[] | undefined

        if (applicableScopes.length > 0) {
          // Check if any scope has no node restrictions (meaning "anywhere")
          const hasUnrestrictedScope = applicableScopes.some(
            (scope) => !scope.nodes || scope.nodes.length === 0,
          )

          if (!hasUnrestrictedScope) {
            // All scopes have node restrictions - collect all allowed nodes
            nodeRestrictions = [...new Set(applicableScopes.flatMap((scope) => scope.nodes ?? []))]
          }
          // else: nodeRestrictions stays undefined (no restrictions)
        }

        // Will be updated by queryLeafDetails
        return [
          {
            path,
            identityId: expr.id,
            status: 'missing', // Placeholder, updated after query
            nodeRestrictions,
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
      default:
        throwExhaustiveCheck(expr)
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
   * Returns applicable scopes (those that pass principal/perm checks) for node restriction tracking.
   */
  private checkFilter(
    scopes: Scope[] | undefined,
    principal: IdentityId | undefined,
    perm: PermissionT,
  ): { allowed: boolean; details?: FilterDetail[]; applicableScopes?: Scope[] } {
    if (!scopes?.length) {
      return { allowed: true, applicableScopes: [] }
    }

    const details: FilterDetail[] = []
    const applicableScopes: Scope[] = []

    for (let i = 0; i < scopes.length; i++) {
      const result = this.scopePasses(scopes[i]!, principal, perm)
      if (result.passes) {
        applicableScopes.push(scopes[i]!)
      } else {
        details.push({ scopeIndex: i, failedCheck: result.failedCheck! })
      }
    }

    if (applicableScopes.length > 0) {
      return { allowed: true, applicableScopes }
    }

    return { allowed: false, details }
  }

  /**
   * Query grantedAt, inheritancePath, and searchedPath for each leaf.
   * Also verifies node scope restrictions are satisfied.
   */
  private async queryLeafDetails(
    leaves: LeafEvaluation[],
    resourceId: NodeId,
    perm: PermissionT,
  ): Promise<void> {
    const identityIds = [...new Set(leaves.map((l) => l.identityId))]

    // First, check if any leaves have node restrictions
    const hasNodeRestrictions = leaves.some(
      (l) => l.nodeRestrictions && l.nodeRestrictions.length > 0,
    )

    // Query target's ancestor path (needed for node restriction checks)
    let targetAncestors: Set<NodeId> | null = null
    if (hasNodeRestrictions) {
      const ancestorQuery = `
        MATCH (target:Node {id: $resourceId})
        MATCH (target)-[:hasParent*0..${this.maxDepth}]->(ancestor:Node)
        RETURN collect(ancestor.id) AS ancestors
      `
      const ancestorResults = await this.executor.run<{ ancestors: string[] }>(ancestorQuery, {
        resourceId,
      })
      targetAncestors = new Set(ancestorResults[0]?.ancestors ?? [])
    }

    for (const identityId of identityIds) {
      const query = `
        MATCH (target:Node {id: $resourceId})
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
      }>(query, { resourceId, perm, identityId })

      const results = queryResults[0]?.results ?? []
      const grantedResult = results.find((r) => r.hasPermission)
      const searchedPath = results.length > 0 ? (results[results.length - 1]?.pathNodes ?? []) : []

      for (const leaf of leaves) {
        if (leaf.identityId !== identityId) continue

        if (grantedResult) {
          // Check node restrictions if present
          // Node restriction means: target must be in subtree of one of the restricted nodes
          // i.e., one of the restricted nodes must be an ancestor of target
          if (leaf.nodeRestrictions && leaf.nodeRestrictions.length > 0 && targetAncestors) {
            const nodeRestrictionsSatisfied = leaf.nodeRestrictions.some((restrictedNode) =>
              targetAncestors!.has(restrictedNode),
            )

            if (!nodeRestrictionsSatisfied) {
              // Permission exists but node restrictions not satisfied
              leaf.status = 'missing'
              leaf.searchedPath = searchedPath
              continue
            }
          }

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
      default:
        throwExhaustiveCheck(expr)
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
  private async getTargetType(resourceId: NodeId): Promise<NodeId | null> {
    if (this.typeCache.has(resourceId)) {
      return this.typeCache.get(resourceId)!
    }

    const query = `
      MATCH (t:Node {id: $resourceId})
      OPTIONAL MATCH (t)-[:ofType]->(type:Type)
      RETURN type.id AS typeId
      LIMIT 1
    `

    const results = await this.executor.run<{ typeId: NodeId | null }>(query, { resourceId })
    const typeId = results[0]?.typeId ?? null
    this.typeCache.set(resourceId, typeId)
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
