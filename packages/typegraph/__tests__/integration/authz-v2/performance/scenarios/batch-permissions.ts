/**
 * Batch Permissions Scenario
 *
 * Tests multiple permission checks in sequence to measure cache behavior.
 * Runs the same and different permission checks to see cache hit rates.
 */

import type { TestScenario } from './types'
import { separateGrant, simpleGrant, identity } from './types'

/**
 * Batch scenarios are designed to be run in sequence.
 * Later scenarios should benefit from cache hits from earlier ones.
 */

// First batch: Same identity, same permission, different nodes
export const batchSamePermDiffNodeScenarios: TestScenario[] = [
  {
    id: 'batch-user1-read-m1',
    name: 'Batch: USER1 read M1',
    description: 'First of batch - no cache',
    principal: 'USER1',
    nodeId: 'M1',
    perm: 'read',
    grant: separateGrant('APP1', 'USER1'),
    expectedGranted: true,
  },
  {
    id: 'batch-user1-read-m2',
    name: 'Batch: USER1 read M2',
    description: 'Same identity/perm - type cache hit expected',
    principal: 'USER1',
    nodeId: 'M2',
    perm: 'read',
    grant: separateGrant('APP1', 'USER1'),
    expectedGranted: true,
  },
  {
    id: 'batch-user1-read-m3',
    name: 'Batch: USER1 read M3',
    description: 'Same identity/perm - type cache hit expected',
    principal: 'USER1',
    nodeId: 'M3',
    perm: 'read',
    grant: separateGrant('APP1', 'USER1'),
    expectedGranted: true,
  },
]

// Second batch: Same identity, different permissions, same node
export const batchDiffPermSameNodeScenarios: TestScenario[] = [
  {
    id: 'batch-user1-read-m1-2',
    name: 'Batch: USER1 read M1 (2)',
    description: 'Read permission on M1',
    principal: 'USER1',
    nodeId: 'M1',
    perm: 'read',
    grant: separateGrant('APP1', 'USER1'),
    expectedGranted: true,
  },
  {
    id: 'batch-user1-edit-m1',
    name: 'Batch: USER1 edit M1',
    description: 'Edit permission on M1 - different perm',
    principal: 'USER1',
    nodeId: 'M1',
    perm: 'edit',
    grant: separateGrant('APP1', 'USER1'),
    expectedGranted: true,
  },
  {
    id: 'batch-user1-use-m1',
    name: 'Batch: USER1 use M1',
    description: 'Use permission on M1 - should fail (no use perm)',
    principal: 'USER1',
    nodeId: 'M1',
    perm: 'use',
    grant: separateGrant('APP1', 'USER1'),
    expectedGranted: false,
    expectedDeniedBy: 'resource',
  },
]

// Third batch: Different identities, same permission, same node
export const batchDiffIdentitySamePermScenarios: TestScenario[] = [
  {
    id: 'batch-app1-use-m1',
    name: 'Batch: APP1 use M1',
    description: 'APP1 has use on T1 (type permission)',
    principal: 'APP1',
    nodeId: 'M1',
    perm: 'use',
    grant: simpleGrant('APP1'),
    expectedGranted: true,
  },
  {
    id: 'batch-user1-use-m1-2',
    name: 'Batch: USER1 use M1',
    description: 'USER1 lacks use permission',
    principal: 'USER1',
    nodeId: 'M1',
    perm: 'use',
    grant: simpleGrant('USER1'),
    expectedGranted: false,
    expectedDeniedBy: 'type',
  },
  {
    id: 'batch-role1-use-m1',
    name: 'Batch: ROLE1 use M1',
    description: 'ROLE1 lacks use permission',
    principal: 'ROLE1',
    nodeId: 'M1',
    perm: 'use',
    grant: simpleGrant('ROLE1'),
    expectedGranted: false,
    expectedDeniedBy: 'type',
  },
]

// Combined: All batch scenarios
export const allBatchScenarios: TestScenario[] = [
  ...batchSamePermDiffNodeScenarios,
  ...batchDiffPermSameNodeScenarios,
  ...batchDiffIdentitySamePermScenarios,
]
