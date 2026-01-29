/**
 * Access Query Port
 *
 * Boundary between authorization logic (WHAT) and adapter implementation (HOW).
 * Authorization functions depend on this interface, not on concrete implementations.
 */

import type { CypherFragment } from '../adapter/cypher'
import type { IdentityExpr, NodeId, PermissionT, IdentityId, LeafEvaluation } from '../types'

export interface AccessQueryPort {
  generateQuery(
    expr: IdentityExpr,
    targetVar: string,
    perm: PermissionT,
    principal: IdentityId | undefined,
  ): CypherFragment | null
  executeResourceCheck(fragment: CypherFragment, resourceId: NodeId): Promise<boolean>
  executeTypeCheck(fragment: CypherFragment, typeId: NodeId): Promise<boolean>
  getTargetType(resourceId: NodeId): Promise<NodeId | null>
  queryLeafDetails(leaves: LeafEvaluation[], resourceId: NodeId, perm: PermissionT): Promise<void>
  clearCache(): void
}
