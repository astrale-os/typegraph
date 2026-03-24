/**
 * Composed Exclude Scenario
 *
 * Tests exclusion (A \ B) composition.
 *
 * From seed data:
 * - A has read on M1, M2
 * - B has read on M1
 *
 * Exclusion semantics (A \ B):
 * - If both A and B have permission, it's DENIED (B excludes it)
 * - If only A has permission, it's GRANTED
 *
 * So (A \ B):
 * - M1: denied (both have it, B excludes)
 * - M2: granted (only A has it)
 */

import type { TestScenario } from './types'

import { READ, EDIT } from '../../testing/helpers'
import { exclude, identity } from './types'

/**
 * (A \ B) → M1 (read) - Should fail
 *
 * A has read on M1
 * B has read on M1
 * Exclusion denies because B has permission
 */
export const composedExcludeM1Scenario: TestScenario = {
  id: 'composed-exclude-m1',
  name: 'Composed Exclude A \\ B on M1',
  description: 'A \\ B denied on M1 because B has it',
  principal: 'A',
  nodeId: 'M1',
  nodePerm: READ,
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: exclude(identity('A'), identity('B')),
  },
  expectedGranted: false,
  expectedDeniedBy: 'resource',
}

/**
 * (A \ B) → M2 (read) - Should pass
 *
 * A has read on M2
 * B does NOT have read on M2
 * Exclusion grants because B doesn't have permission
 */
export const composedExcludeM2Scenario: TestScenario = {
  id: 'composed-exclude-m2',
  name: 'Composed Exclude A \\ B on M2',
  description: 'A \\ B granted on M2 because B lacks it',
  principal: 'A',
  nodeId: 'M2',
  nodePerm: READ,
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: exclude(identity('A'), identity('B')),
  },
  expectedGranted: true,
}

/**
 * (USER1 \ ROLE1) → M1 (read) - Should pass
 *
 * USER1 has read on root (inherited by M1)
 * ROLE1 does NOT have read on M1
 * Exclusion grants because ROLE1 doesn't have permission
 */
export const composedExcludeUserRoleReadScenario: TestScenario = {
  id: 'composed-exclude-user-role-read',
  name: 'Composed Exclude USER1 \\ ROLE1 read',
  description: 'USER1 \\ ROLE1 granted read on M1',
  principal: 'USER1',
  nodeId: 'M1',
  nodePerm: READ,
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: exclude(identity('USER1'), identity('ROLE1')),
  },
  expectedGranted: true,
}

/**
 * (USER1 \ ROLE1) → M1 (edit) - Should pass
 *
 * USER1 has edit on workspace-1 (M1 is in workspace-1)
 * ROLE1 does NOT have edit on workspace-1
 * Exclusion grants
 */
export const composedExcludeUserRoleEditScenario: TestScenario = {
  id: 'composed-exclude-user-role-edit',
  name: 'Composed Exclude USER1 \\ ROLE1 edit',
  description: 'USER1 \\ ROLE1 granted edit on M1',
  principal: 'USER1',
  nodeId: 'M1',
  nodePerm: EDIT,
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: exclude(identity('USER1'), identity('ROLE1')),
  },
  expectedGranted: true,
}

/**
 * (ROLE1 \ USER1) → M3 (edit) - Should fail
 *
 * ROLE1 has edit on workspace-2 (M3 is in workspace-2)
 * USER1 does NOT have edit on workspace-2
 * BUT we check as principal 'ROLE1', not 'USER1'
 * Wait - we need to think about this...
 *
 * Actually, USER1 doesn't have edit on M3 (wrong workspace).
 * So (ROLE1 \ USER1) on M3 for edit:
 * - ROLE1 has edit (grants)
 * - USER1 doesn't have edit (no exclusion)
 * = granted
 */
export const composedExcludeRoleUserEditScenario: TestScenario = {
  id: 'composed-exclude-role-user-edit',
  name: 'Composed Exclude ROLE1 \\ USER1 edit',
  description: 'ROLE1 \\ USER1 granted edit on M3',
  principal: 'ROLE1',
  nodeId: 'M3',
  nodePerm: EDIT,
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: exclude(identity('ROLE1'), identity('USER1')),
  },
  expectedGranted: true,
}
