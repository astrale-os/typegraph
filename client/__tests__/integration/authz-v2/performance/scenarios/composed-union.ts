/**
 * Composed Union Scenario
 *
 * Tests union (A ∪ B) composition.
 * USER1 is composed with ROLE1 via unionWith.
 *
 * From seed data:
 * - USER1 unionWith ROLE1
 * - USER1 has: read on root, edit on workspace-1
 * - ROLE1 has: edit on workspace-2
 *
 * Combined (USER1 ∪ ROLE1):
 * - read on root (inherited everywhere)
 * - edit on workspace-1 (via USER1)
 * - edit on workspace-2 (via ROLE1)
 */

import type { TestScenario } from './types'

import { READ, EDIT } from '../../testing/helpers'
import { union, identity } from './types'

/**
 * (USER1 ∪ ROLE1) → M3 (edit)
 *
 * USER1 doesn't have edit on M3 (wrong workspace)
 * ROLE1 has edit on workspace-2 where M3 is
 * Union grants via ROLE1's permission
 */
export const composedUnionEditScenario: TestScenario = {
  id: 'composed-union-edit',
  name: 'Composed Union Edit',
  description: 'USER1 ∪ ROLE1 gets edit on M3 via ROLE1',
  principal: 'USER1',
  nodeId: 'M3',
  nodePerm: EDIT,
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: union(identity('USER1'), identity('ROLE1')),
  },
  expectedGranted: true,
}

/**
 * (USER1 ∪ ROLE1) → M1 (edit)
 *
 * USER1 has edit on workspace-1 where M1 is
 * ROLE1 doesn't have edit on workspace-1
 * Union grants via USER1's permission
 */
export const composedUnionEditViaUser: TestScenario = {
  id: 'composed-union-edit-via-user',
  name: 'Composed Union Edit (via USER1)',
  description: 'USER1 ∪ ROLE1 gets edit on M1 via USER1',
  principal: 'USER1',
  nodeId: 'M1',
  nodePerm: EDIT,
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: union(identity('USER1'), identity('ROLE1')),
  },
  expectedGranted: true,
}

/**
 * (USER1 ∪ ROLE1) → M1 (read)
 *
 * USER1 has read on root (inherited by M1)
 * Union grants via USER1's inherited permission
 */
export const composedUnionReadScenario: TestScenario = {
  id: 'composed-union-read',
  name: 'Composed Union Read',
  description: 'USER1 ∪ ROLE1 gets read on M1 via USER1 root permission',
  principal: 'USER1',
  nodeId: 'M1',
  nodePerm: READ,
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: union(identity('USER1'), identity('ROLE1')),
  },
  expectedGranted: true,
}

/**
 * (A ∪ B) → M1 (read)
 *
 * A has read on M1 and M2
 * B has read on M1 only
 * Union grants via either
 */
export const composedUnionABScenario: TestScenario = {
  id: 'composed-union-ab',
  name: 'Composed Union A ∪ B',
  description: 'A ∪ B gets read on M1 (both have it)',
  principal: 'A',
  nodeId: 'M1',
  nodePerm: READ,
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: union(identity('A'), identity('B')),
  },
  expectedGranted: true,
}

/**
 * (A ∪ B) → M2 (read)
 *
 * A has read on M2
 * B does NOT have read on M2
 * Union grants via A
 */
export const composedUnionABM2Scenario: TestScenario = {
  id: 'composed-union-ab-m2',
  name: 'Composed Union A ∪ B on M2',
  description: 'A ∪ B gets read on M2 via A only',
  principal: 'A',
  nodeId: 'M2',
  nodePerm: READ,
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: union(identity('A'), identity('B')),
  },
  expectedGranted: true,
}
