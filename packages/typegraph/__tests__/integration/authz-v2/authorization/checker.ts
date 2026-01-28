/**
 * Access Checker — Hot Path
 *
 * Pure function: expression → decision.
 * Delegates all I/O to AccessQueryPort.
 */

import type { AccessQueryPort } from './access-query-port'
import { validateAccessInputs } from '../expression/validation'
import type { Grant, NodeId, PermissionT, IdentityId, AccessDecision } from '../types'

export async function checkAccess(
  params: { principal: IdentityId; grant: Grant; nodeId: NodeId; perm: PermissionT },
  queryPort: AccessQueryPort,
): Promise<AccessDecision> {
  const { principal, grant, nodeId, perm } = params
  validateAccessInputs(grant, nodeId, perm, principal)

  const { forType, forResource } = grant

  // Phase 1: Type check (only if target has a type)
  const typeId = await queryPort.getTargetType(nodeId)

  if (typeId) {
    // Type check is NOT scoped by principal - always unrestricted
    const typeCypher = queryPort.generateCypher(forType, 'target', 'use', undefined)
    if (typeCypher === 'false') {
      return { granted: false, deniedBy: 'type' }
    }

    const typeGranted = await queryPort.executeTypeCheck(typeCypher, typeId)
    if (!typeGranted) {
      return { granted: false, deniedBy: 'type' }
    }
  }

  // Phase 2: Target check (scoped by principal)
  const targetCypher = queryPort.generateCypher(forResource, 'target', perm, principal)
  if (targetCypher === 'false') {
    return { granted: false, deniedBy: 'resource' }
  }

  const targetGranted = await queryPort.executeCheck(targetCypher, nodeId)
  return targetGranted ? { granted: true } : { granted: false, deniedBy: 'resource' }
}
