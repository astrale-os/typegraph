/**
 * Access Explainer — Cold Path
 *
 * Pure functions for detailed access explanation.
 * Works with the original IdentityExpr (before pruning) to provide
 * full explanation of which scopes filtered which leaves.
 * Delegates all I/O to AccessQueryPort.
 */

import type { AccessQueryPort } from './access-query-port'
import { validateAccessInputs, throwExhaustiveCheck } from '../expression/validation'
import { checkFilter, intersectScopes } from '../expression/scope'
import { pruneExpression } from '../expression/prune'
import { fragmentToDisplayString } from '../adapter/cypher'
import type {
  Grant,
  NodeId,
  Permission,
  IdentityId,
  Scope,
  AccessExplanation,
  PhaseExplanation,
  IdentityExpr,
  LeafEvaluation,
} from '../types'

export async function explainAccess(
  params: { principal: IdentityId; grant: Grant; nodeId: NodeId; perm: Permission },
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
    const resourceGranted = evaluateGranted(forResource, resourceCheck.leaves)
    const granted = typeGranted && resourceGranted

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
  const resourceGranted = evaluateGranted(forResource, resourceCheck.leaves)
  const granted = resourceGranted

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
 * - scope: transparent wrapper, delegates to inner
 * - union: any operand granted → granted
 * - intersect: all operands granted → granted
 * - exclude: base granted AND no excluded granted
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
    case 'scope':
      // Scope is transparent for grant evaluation — delegates to inner
      return evaluateGranted(expr.expr, leaves, path)
    case 'union':
      return expr.operands.some((op, i) => evaluateGranted(op, leaves, [...path, i]))
    case 'intersect':
      return expr.operands.every((op, i) => evaluateGranted(op, leaves, [...path, i]))
    case 'exclude':
      return (
        evaluateGranted(expr.base, leaves, [...path, 0]) &&
        !expr.excluded.some((ex, i) => evaluateGranted(ex, leaves, [...path, 1 + i]))
      )
    default:
      throwExhaustiveCheck(expr)
  }
}

/**
 * Explain a single phase with full leaf details.
 * Uses original IdentityExpr for leaf collection/explanation,
 * but prunes for Cypher query generation.
 */
async function explainPhase(
  expr: IdentityExpr,
  resourceId: NodeId,
  perm: Permission,
  principal: IdentityId | undefined,
  queryPort: AccessQueryPort,
): Promise<PhaseExplanation> {
  // Collect leaves from expression tree (uses original expr with scope info)
  const leaves = collectLeaves(expr, [], principal, perm)

  // Prune for Cypher generation
  const pruned = pruneExpression(expr, principal, perm)
  const fragment = pruned ? queryPort.generateQuery(pruned, perm) : null
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
 * Accumulates scopes from ancestor scope nodes and applies them at identity leaves.
 */
function collectLeaves(
  expr: IdentityExpr,
  path: number[],
  principal: IdentityId | undefined,
  perm: Permission,
  accumulatedScopes?: Scope[],
): LeafEvaluation[] {
  switch (expr.kind) {
    case 'identity': {
      const filterResult = checkFilter(accumulatedScopes, principal, perm)

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
      let nodeRestriction: NodeId[] | undefined

      if (applicableScopes.length > 0) {
        const hasUnrestrictedScope = applicableScopes.some(
          (scope) => scope.nodes === undefined,
        )

        if (!hasUnrestrictedScope) {
          nodeRestriction = [...new Set(applicableScopes.flatMap((scope) => scope.nodes ?? []))]
        }
      }

      return [
        {
          path,
          identityId: expr.id,
          status: 'missing',
          nodeRestriction,
        },
      ]
    }

    case 'scope': {
      // Accumulate scopes from this node with any inherited scopes
      // Scope nesting uses intersection semantics (more restrictive)
      const newScopes = accumulatedScopes
        ? intersectScopes(accumulatedScopes, expr.scopes)
        : expr.scopes
      // Scope is transparent in path — no path index increment
      return collectLeaves(expr.expr, path, principal, perm, newScopes)
    }

    case 'union':
    case 'intersect':
      return expr.operands.flatMap((op, i) =>
        collectLeaves(op, [...path, i], principal, perm, accumulatedScopes),
      )

    case 'exclude':
      return [
        ...collectLeaves(expr.base, [...path, 0], principal, perm, accumulatedScopes),
        ...expr.excluded.flatMap((ex, i) =>
          collectLeaves(ex, [...path, 1 + i], principal, perm, accumulatedScopes),
        ),
      ]

    default:
      throwExhaustiveCheck(expr)
  }
}
