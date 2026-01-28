/**
 * Cypher Generation
 *
 * Standalone functions for generating Cypher WHERE clauses from identity expressions.
 * Extracted from AccessChecker — no class state, pure functions.
 */

import { filterApplicableScopes } from '../expression/scope'
import { throwExhaustiveCheck } from '../expression/validation'
import type { IdentityExpr, PermissionT, IdentityId } from '../types'

/**
 * Generate Cypher WHERE clause for permission check.
 */
export function toCypher(
  expr: IdentityExpr,
  targetVar: string,
  perm: PermissionT,
  principal: IdentityId | undefined,
  maxDepth: number,
): string {
  switch (expr.kind) {
    case 'identity':
      return identityToCypher(expr, targetVar, perm, principal, maxDepth)

    case 'union': {
      const left = toCypher(expr.left, targetVar, perm, principal, maxDepth)
      const right = toCypher(expr.right, targetVar, perm, principal, maxDepth)
      if (left === 'false' && right === 'false') return 'false'
      if (left === 'false') return right
      if (right === 'false') return left
      return `(${left} OR ${right})`
    }

    case 'intersect': {
      const left = toCypher(expr.left, targetVar, perm, principal, maxDepth)
      const right = toCypher(expr.right, targetVar, perm, principal, maxDepth)
      if (left === 'false' || right === 'false') return 'false'
      return `(${left} AND ${right})`
    }

    case 'exclude': {
      const left = toCypher(expr.left, targetVar, perm, principal, maxDepth)
      const right = toCypher(expr.right, targetVar, perm, principal, maxDepth)
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
function identityToCypher(
  expr: Extract<IdentityExpr, { kind: 'identity' }>,
  targetVar: string,
  perm: PermissionT,
  principal: IdentityId | undefined,
  maxDepth: number,
): string {
  const scopes = expr.scopes

  // Check if allowed by scopes
  const { allowed, applicableScopes } = filterApplicableScopes(scopes, principal, perm)
  if (!allowed) return 'false'

  // Base permission pattern
  const permPattern = `(${targetVar})-[:hasParent*0..${maxDepth}]->(:Node)<-[:hasPerm {perm: '${perm}'}]-(:Identity {id: '${expr.id}'})`

  // No scopes or no node restrictions
  if (applicableScopes.length === 0) {
    return permPattern
  }

  // Apply node scope restrictions
  const scopeChecks = applicableScopes.map((scope) => {
    if (!scope.nodes?.length) return permPattern

    const nodePatterns = scope.nodes.map(
      (id) => `(${targetVar})-[:hasParent*0..${maxDepth}]->(:Node {id: '${id}'})`,
    )
    const nodeCheck = nodePatterns.length === 1 ? nodePatterns[0] : `(${nodePatterns.join(' OR ')})`
    return `(${nodeCheck} AND ${permPattern})`
  })

  return scopeChecks.length === 1 ? scopeChecks[0]! : `(${scopeChecks.join(' OR ')})`
}
