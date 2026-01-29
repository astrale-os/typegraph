/**
 * Hierarchical Deep Scenario
 *
 * Tests permission inheritance through the hierarchy.
 * USER1 has 'read' on root, which should inherit to all modules.
 *
 * Hierarchy: Module → Space → Root
 * - M1 → workspace-1 → root
 * - M2 → workspace-1 → root
 * - M3 → workspace-2 → root
 */

import type { TestScenario } from './types'
import { separateGrant, identity } from './types'

/**
 * USER1 → M1 (read)
 *
 * USER1 has 'read' on root
 * M1 inherits from workspace-1 → root
 * Expected: granted via inheritance
 */
export const hierarchicalReadRootScenario: TestScenario = {
  id: 'hierarchical-read-root',
  name: 'Hierarchical Read (Root)',
  description: 'USER1 has read on root, M1 inherits via workspace-1',
  principal: 'USER1',
  nodeId: 'M1',
  perm: 'read',
  grant: separateGrant('APP1', 'USER1'),
  expectedGranted: true,
  thresholds: {
    checkAccess: { mean: 8000, p95: 15000, p99: 25000 },
    directPermission: { mean: 2000, p95: 5000 },
    hierarchicalDeep: { mean: 8000, p95: 15000 },
    phases: { trust: 10, resolve: 20, decide: 70 },
    cache: { minHitRate: 80 },
  },
}

/**
 * USER1 → M3 (read)
 *
 * Same as above but different workspace (workspace-2).
 * Still inherits from root.
 */
export const hierarchicalReadRoot2Scenario: TestScenario = {
  id: 'hierarchical-read-root-ws2',
  name: 'Hierarchical Read (Root via WS2)',
  description: 'USER1 has read on root, M3 inherits via workspace-2',
  principal: 'USER1',
  nodeId: 'M3',
  perm: 'read',
  grant: separateGrant('APP1', 'USER1'),
  expectedGranted: true,
}

/**
 * USER1 → M1 (edit)
 *
 * USER1 has 'edit' on workspace-1
 * M1 inherits from workspace-1
 * Expected: granted via inheritance from workspace
 */
export const hierarchicalEditWorkspaceScenario: TestScenario = {
  id: 'hierarchical-edit-workspace',
  name: 'Hierarchical Edit (Workspace)',
  description: 'USER1 has edit on workspace-1, M1 inherits',
  principal: 'USER1',
  nodeId: 'M1',
  perm: 'edit',
  grant: separateGrant('APP1', 'USER1'),
  expectedGranted: true,
}

/**
 * USER1 → M3 (edit) - Should fail
 *
 * USER1 has 'edit' on workspace-1, not workspace-2.
 * M3 is in workspace-2.
 * Expected: denied (no inheritance path)
 */
export const hierarchicalEditWrongWorkspaceScenario: TestScenario = {
  id: 'hierarchical-edit-wrong-workspace',
  name: 'Hierarchical Edit (Wrong Workspace)',
  description: 'USER1 has edit on workspace-1, M3 is in workspace-2',
  principal: 'USER1',
  nodeId: 'M3',
  perm: 'edit',
  grant: separateGrant('APP1', 'USER1'),
  expectedGranted: false,
  expectedDeniedBy: 'resource',
}

/**
 * ROLE1 → M3 (edit)
 *
 * ROLE1 has 'edit' on workspace-2
 * M3 is in workspace-2
 * Expected: granted
 */
export const hierarchicalRoleEditScenario: TestScenario = {
  id: 'hierarchical-role-edit',
  name: 'Hierarchical Role Edit',
  description: 'ROLE1 has edit on workspace-2, M3 inherits',
  principal: 'ROLE1',
  nodeId: 'M3',
  perm: 'edit',
  grant: separateGrant('APP1', 'ROLE1'),
  expectedGranted: true,
}
