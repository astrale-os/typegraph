/**
 * Access Explainer — Cold Path
 *
 * Pure functions for detailed access explanation.
 * Delegates all I/O to AccessQueryPort.
 */

import type { AccessQueryPort } from './access-query-port'
import { validateAccessInputs, throwExhaustiveCheck } from '../expression/validation'
import { checkFilter } from '../expression/scope'
import { fragmentToDisplayString } from '../adapter/cypher'
import type {
  Grant,
  NodeId,
  PermissionT,
  IdentityId,
  AccessExplanation,
  PhaseExplanation,
  IdentityExpr,
  LeafEvaluation,
} from '../types'

export async function explainAccess(
  params: { principal: IdentityId; grant: Grant; nodeId: NodeId; perm: PermissionT },
  queryPort: AccessQueryPort,
): Promise<AccessExplanation> {
  const { principal, grant, nodeId, perm } = params
  validateAccessInputs(grant, nodeId, perm, principal)

  const { forType, forResource } = grant

  // Start resource phase immediately (no dependency on typeId)
  const resourcePromise = explainPhase(forResource, nodeId, perm, principal, queryPort)

  const typeId = await queryPort.getTargetType(nodeId)

  if (typeId) {
    // Run type phase in parallel with already-started resource phase
    const [typeCheck, resourceCheck] = await Promise.all([
      explainPhase(forType, typeId, 'use', undefined, queryPort),
      resourcePromise,
    ])
    const typeGranted = evaluateGranted(forType, typeCheck.leaves)
    const targetGranted = evaluateGranted(forResource, resourceCheck.leaves)
    const granted = typeGranted && targetGranted

    return {
      resourceId: nodeId,
      perm,
      principal,
      granted,
      deniedBy: !granted ? (!typeGranted ? 'type' : 'resource') : undefined,
      typeCheck,
      resourceCheck,
    }
  }

  const typeCheck: PhaseExplanation = { expression: forType, leaves: [], query: 'true' }
  const resourceCheck = await resourcePromise
  const targetGranted = evaluateGranted(forResource, resourceCheck.leaves)
  const granted = targetGranted

  return {
    resourceId: nodeId,
    perm,
    principal,
    granted,
    deniedBy: !granted ? 'resource' : undefined,
    typeCheck,
    resourceCheck,
  }
}

/**
 * Evaluate whether expression is granted based on leaf statuses.
 * Correctly implements expression semantics:
 * - union: left OR right
 * - intersect: left AND right
 * - exclude: left AND NOT right
 */
export function evaluateGranted(
  expr: IdentityExpr,
  leaves: LeafEvaluation[],
  path: number[] = [],
): boolean {
  switch (expr.kind) {
    case 'identity': {
      const pathKey = path.join(',')
      const leaf = leaves.find((l) => l.path.join(',') === pathKey)
      return leaf?.status === 'granted'
    }
    case 'union':
      return (
        evaluateGranted(expr.left, leaves, [...path, 0]) ||
        evaluateGranted(expr.right, leaves, [...path, 1])
      )
    case 'intersect':
      return (
        evaluateGranted(expr.left, leaves, [...path, 0]) &&
        evaluateGranted(expr.right, leaves, [...path, 1])
      )
    case 'exclude':
      return (
        evaluateGranted(expr.left, leaves, [...path, 0]) &&
        !evaluateGranted(expr.right, leaves, [...path, 1])
      )
    default:
      throwExhaustiveCheck(expr)
  }
}

/**
 * Explain a single phase with full leaf details.
 */
async function explainPhase(
  expr: IdentityExpr,
  resourceId: NodeId,
  perm: PermissionT,
  principal: IdentityId | undefined,
  queryPort: AccessQueryPort,
): Promise<PhaseExplanation> {
  // Collect leaves from expression tree
  const leaves = collectLeaves(expr, [], principal, perm)

  // Generate query
  const fragment = queryPort.generateQuery(expr, 'target', perm, principal)
  const query = fragmentToDisplayString(fragment)

  // Query details for non-filtered leaves
  const activeLeaves = leaves.filter((l) => l.status !== 'filtered')
  if (activeLeaves.length > 0) {
    await queryPort.queryLeafDetails(activeLeaves, resourceId, perm)
  }

  return {
    expression: expr,
    leaves,
    query,
  }
}

/**
 * Collect all leaves from expression tree with path tracking.
 * Extracts node restrictions from applicable scopes for cold path consistency.
 */
function collectLeaves(
  expr: IdentityExpr,
  path: number[],
  principal: IdentityId | undefined,
  perm: PermissionT,
): LeafEvaluation[] {
  switch (expr.kind) {
    case 'identity': {
      const filterResult = checkFilter(expr.scopes, principal, perm)

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
      const applicableScopes = filterResult.applicableScopes ?? []
      let nodeRestrictions: NodeId[] | undefined

      if (applicableScopes.length > 0) {
        const hasUnrestrictedScope = applicableScopes.some(
          (scope) => !scope.nodes || scope.nodes.length === 0,
        )

        if (!hasUnrestrictedScope) {
          nodeRestrictions = [...new Set(applicableScopes.flatMap((scope) => scope.nodes ?? []))]
        }
      }

      return [
        {
          path,
          identityId: expr.id,
          status: 'missing',
          nodeRestrictions,
        },
      ]
    }

    case 'union':
    case 'intersect':
    case 'exclude': {
      const leftLeaves = collectLeaves(expr.left, [...path, 0], principal, perm)
      const rightLeaves = collectLeaves(expr.right, [...path, 1], principal, perm)
      return [...leftLeaves, ...rightLeaves]
    }
    default:
      throwExhaustiveCheck(expr)
  }
}
