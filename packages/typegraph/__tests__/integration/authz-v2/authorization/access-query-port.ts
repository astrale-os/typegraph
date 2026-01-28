/**
 * Access Query Port
 *
 * Boundary between authorization logic (WHAT) and adapter implementation (HOW).
 * Authorization functions depend on this interface, not on concrete implementations.
 */

import type { IdentityExpr, NodeId, PermissionT, IdentityId, LeafEvaluation } from '../types'

export interface AccessQueryPort {
  generateCypher(
    expr: IdentityExpr,
    targetVar: string,
    perm: PermissionT,
    principal: IdentityId | undefined,
  ): string
  executeCheck(cypherCheck: string, resourceId: NodeId): Promise<boolean>
  executeTypeCheck(cypherCheck: string, typeId: NodeId): Promise<boolean>
  getTargetType(resourceId: NodeId): Promise<NodeId | null>
  queryLeafDetails(leaves: LeafEvaluation[], resourceId: NodeId, perm: PermissionT): Promise<void>
  clearCache(): void
}
