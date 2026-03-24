/**
 * Access Checker — Hot Path
 *
 * Pure function: expression → decision.
 * Prunes the expression tree (scope evaluation) before generating Cypher.
 * Delegates all I/O to AccessQueryPort.
 */

import type { Grant, NodeId, Permission, IdentityId, AccessDecision } from '../types'
import type { AccessQueryPort } from './access-query-port'

import { pruneExpression } from '../expression/prune'
import { validateAccessInputs } from '../expression/validation'

export async function checkAccess(
  params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    nodePerm: Permission
    typePerm: Permission
  },
  queryPort: AccessQueryPort,
): Promise<AccessDecision> {
  const { principal, grant, nodeId, nodePerm, typePerm } = params
  validateAccessInputs(grant, nodeId, nodePerm, principal)

  const { forType, forResource } = grant

  // Prune resource expression (evaluate scopes for principal + perm)
  const prunedResource = pruneExpression(forResource, principal, nodePerm)
  const resourceQuery = prunedResource ? queryPort.generateQuery(prunedResource, nodePerm) : null
  const resourcePromise =
    resourceQuery === null
      ? Promise.resolve(false)
      : queryPort.executeResourceCheck(resourceQuery, nodeId)

  // Type check (only if target has a type)
  const typeId = await queryPort.getTargetType(nodeId)

  if (typeId) {
    // Prune type expression (no principal for type checks)
    const prunedType = pruneExpression(forType, undefined, typePerm)
    const typeQuery = prunedType ? queryPort.generateQuery(prunedType, typePerm) : null

    if (typeQuery === null) {
      return { granted: false, deniedBy: 'type' }
    }

    // Run type execution in parallel with already-started resource execution
    const [typeGranted, resourceGranted] = await Promise.all([
      queryPort.executeTypeCheck(typeQuery, typeId),
      resourcePromise,
    ])

    if (!typeGranted) return { granted: false, deniedBy: 'type' }
    return resourceGranted ? { granted: true } : { granted: false, deniedBy: 'resource' }
  }

  // No type — just await resource
  const resourceGranted = await resourcePromise
  return resourceGranted ? { granted: true } : { granted: false, deniedBy: 'resource' }
}
