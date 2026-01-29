/**
 * Direct Permission Scenario
 *
 * Tests simple permission checks using the seed data from setup.ts.
 *
 * IMPORTANT: The authorization model requires BOTH:
 * 1. Type check: forType expression must have 'use' on target's type
 * 2. Resource check: forResource expression must have the requested perm on target or ancestors
 *
 * APP1 only has TYPE permissions (use on T1), not RESOURCE permissions.
 * So APP1 alone cannot access modules - it needs a user grant for resources.
 *
 * USER1 has: read on root (inherited everywhere), edit on workspace-1
 * This means USER1+APP1 combo can access modules with the right permissions.
 */

import type { TestScenario } from './types'
import { separateGrant, simpleGrant } from './types'

/**
 * APP1 (type) + USER1 (resource) → M1 (read)
 *
 * Type check: APP1 has 'use' on T1, M1 is type T1 → passes
 * Resource check: USER1 has 'read' on root, M1 inherits → passes
 * Expected: granted
 */
export const directPermissionScenario: TestScenario = {
  id: 'direct-permission',
  name: 'Direct Permission',
  description: 'APP1 type + USER1 resource grant for read on M1',
  principal: 'USER1',
  nodeId: 'M1',
  perm: 'read',
  grant: separateGrant('APP1', 'USER1'),
  expectedGranted: true,
  thresholds: {
    checkAccess: { mean: 2000, p95: 5000, p99: 10000 },
    directPermission: { mean: 2000, p95: 5000 },
    hierarchicalDeep: { mean: 8000, p95: 15000 },
    phases: { trust: 10, decode: 5, resolve: 20, decide: 70 },
    cache: { minHitRate: 80 },
  },
}

/**
 * APP1 (type) + USER1 (resource) → M2 (read)
 *
 * Same as above but different module (still type T1, same workspace).
 */
export const directPermissionM2Scenario: TestScenario = {
  id: 'direct-permission-m2',
  name: 'Direct Permission M2',
  description: 'APP1 type + USER1 resource grant for read on M2',
  principal: 'USER1',
  nodeId: 'M2',
  perm: 'read',
  grant: separateGrant('APP1', 'USER1'),
  expectedGranted: true,
}

/**
 * APP1 alone → M1 (use) - Should fail
 *
 * APP1 has type permission (use on T1) but no resource permission.
 * Using simpleGrant(APP1) means forResource=APP1, which has no resource perms.
 * Expected: denied by resource check
 */
export const directPermissionWrongPermScenario: TestScenario = {
  id: 'direct-permission-wrong-perm',
  name: 'Direct Permission (No Resource Perm)',
  description: 'APP1 alone has type perm but no resource perm',
  principal: 'APP1',
  nodeId: 'M1',
  perm: 'use',
  grant: simpleGrant('APP1'),
  expectedGranted: false,
  expectedDeniedBy: 'resource',
}
