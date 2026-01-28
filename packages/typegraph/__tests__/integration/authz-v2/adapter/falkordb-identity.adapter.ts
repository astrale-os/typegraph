/**
 * FalkorDB Identity Adapter
 *
 * Top-level adapter composing authorization logic with FalkorDB query adapter.
 * This is the main entry point for access checking.
 */

import { checkAccess } from '../authorization/checker'
import { explainAccess, evaluateGranted } from '../authorization/explainer'
import { FalkorDBAccessQueryAdapter, type FalkorDBQueryConfig } from './queries'
import type {
  RawExecutor,
  AccessDecision,
  AccessExplanation,
  Grant,
  NodeId,
  PermissionT,
  IdentityId,
  IdentityExpr,
  LeafEvaluation,
} from '../types'

export class FalkorDBIdentityAdapter {
  private queryAdapter: FalkorDBAccessQueryAdapter

  constructor(executor: RawExecutor, config?: FalkorDBQueryConfig) {
    this.queryAdapter = new FalkorDBAccessQueryAdapter(executor, config)
  }

  async checkAccess(params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    perm: PermissionT
  }): Promise<AccessDecision> {
    return checkAccess(params, this.queryAdapter)
  }

  async explainAccess(params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    perm: PermissionT
  }): Promise<AccessExplanation> {
    return explainAccess(params, this.queryAdapter)
  }

  evaluateGranted(expr: IdentityExpr, leaves: LeafEvaluation[], path?: number[]): boolean {
    return evaluateGranted(expr, leaves, path)
  }

  clearCache(): void {
    this.queryAdapter.clearCache()
  }
}

export function createFalkorDBIdentityAdapter(
  executor: RawExecutor,
  config?: FalkorDBQueryConfig,
): FalkorDBIdentityAdapter {
  return new FalkorDBIdentityAdapter(executor, config)
}

// Re-export for backward compatibility during migration
export { FalkorDBIdentityAdapter as AccessChecker }
export { createFalkorDBIdentityAdapter as createAccessChecker }
