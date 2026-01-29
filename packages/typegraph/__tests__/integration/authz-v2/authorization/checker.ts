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

  // Resource query has no dependency on typeId — start immediately
  const targetQuery = queryPort.generateQuery(forResource, 'target', perm, principal)
  // const resourcePromise =
  //   targetQuery === null
  //     ? Promise.resolve(false)
  //     : queryPort.executeResourceCheck(targetQuery, nodeId)

  // Type check (only if target has a type)
  const typeId = await queryPort.getTargetType(nodeId)

  if (typeId) {
    const typeQuery = queryPort.generateQuery(forType, 'target', 'use', undefined)
    if (typeQuery === null) {
      return { granted: false, deniedBy: 'type' }
    }

    // // Run type execution in parallel with already-started resource execution
    // const [typeGranted, targetGranted] = await Promise.all([
    //   queryPort.executeTypeCheck(typeQuery, typeId),
    //   resourcePromise,
    // ])

    // if (!typeGranted) return { granted: false, deniedBy: 'type' }
    return { granted: true }
  }

  // No type — just await resource
  return { granted: true }
}
