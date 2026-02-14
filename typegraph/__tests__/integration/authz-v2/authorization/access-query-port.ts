/**
 * Access Query Port
 *
 * Boundary between authorization logic (WHAT) and adapter implementation (HOW).
 * Authorization functions depend on this interface, not on concrete implementations.
 *
 * The adapter receives PrunedIdentityExpr (scopes already evaluated, each leaf
 * carries its own nodeRestriction). No principal/scope awareness needed.
 */

import type { QueryFragment } from '../adapter/cypher'
import type { PrunedIdentityExpr, NodeId, Permission, LeafEvaluation } from '../types'

export interface AccessQueryPort {
  generateQuery(expr: PrunedIdentityExpr, perm: Permission): QueryFragment | null
  executeResourceCheck(fragment: QueryFragment, resourceId: NodeId): Promise<boolean>
  executeTypeCheck(fragment: QueryFragment, typeId: NodeId): Promise<boolean>
  getTargetType(resourceId: NodeId): Promise<NodeId | null>
  queryLeafDetails(leaves: LeafEvaluation[], resourceId: NodeId, perm: Permission): Promise<void>
  clearCache(): void
}
