/**
 * End-to-End Scenario
 *
 * Tests the complete authorization flow from token minting through access decision.
 * Useful for measuring total latency across all phases.
 */

import type { TestScenario } from './types'
import { separateGrant, simpleGrant, union, identity } from './types'

/**
 * Complete flow for a simple app + user combo.
 * Represents the minimal end-to-end path with both type and resource grants.
 */
export const e2eSimpleAppScenario: TestScenario = {
  id: 'e2e-simple-app',
  name: 'E2E Simple App + User',
  description: 'Complete flow: APP1 type + USER1 resource for read on M1',
  principal: 'USER1',
  nodeId: 'M1',
  perm: 'read',
  grant: separateGrant('APP1', 'USER1'),
  expectedGranted: true,
}

/**
 * Complete flow for a user with inherited permission.
 */
export const e2eUserInheritedScenario: TestScenario = {
  id: 'e2e-user-inherited',
  name: 'E2E User Inherited',
  description: 'Complete flow: USER1 read on M1 via root inheritance',
  principal: 'USER1',
  nodeId: 'M1',
  perm: 'read',
  grant: separateGrant('APP1', 'USER1'),
  expectedGranted: true,
}

/**
 * Complete flow for a composed identity (union).
 */
export const e2eComposedUnionScenario: TestScenario = {
  id: 'e2e-composed-union',
  name: 'E2E Composed Union',
  description: 'Complete flow: USER1 ∪ ROLE1 edit on M3',
  principal: 'USER1',
  nodeId: 'M3',
  perm: 'edit',
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: union(identity('USER1'), identity('ROLE1')),
  },
  expectedGranted: true,
}

/**
 * Complete flow that should be denied.
 */
export const e2eDeniedScenario: TestScenario = {
  id: 'e2e-denied',
  name: 'E2E Denied',
  description: 'Complete flow: USER1 edit on M3 (no permission)',
  principal: 'USER1',
  nodeId: 'M3',
  perm: 'edit',
  grant: separateGrant('APP1', 'USER1'),
  expectedGranted: false,
  expectedDeniedBy: 'resource',
}

/**
 * Complete flow with intersection test identity.
 * X = A ∩ B
 */
export const e2eIntersectionScenario: TestScenario = {
  id: 'e2e-intersection',
  name: 'E2E Intersection',
  description: 'Complete flow: X (A ∩ B) read on M1',
  principal: 'X',
  nodeId: 'M1',
  perm: 'read',
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    // X is defined in the graph as A ∩ B
    // But we test with explicit intersection here
    forResource: { kind: 'intersect', left: identity('A'), right: identity('B') },
  },
  expectedGranted: true,
}

/**
 * Complete flow with intersection - denied case.
 * X = A ∩ B on M2 should fail because B doesn't have M2.
 */
export const e2eIntersectionDeniedScenario: TestScenario = {
  id: 'e2e-intersection-denied',
  name: 'E2E Intersection Denied',
  description: 'Complete flow: X (A ∩ B) read on M2 - B lacks it',
  principal: 'X',
  nodeId: 'M2',
  perm: 'read',
  grant: {
    forType: { kind: 'identity', id: 'APP1' },
    forResource: { kind: 'intersect', left: identity('A'), right: identity('B') },
  },
  expectedGranted: false,
  expectedDeniedBy: 'resource',
}

/**
 * All end-to-end scenarios.
 */
export const allE2EScenarios: TestScenario[] = [
  e2eSimpleAppScenario,
  e2eUserInheritedScenario,
  e2eComposedUnionScenario,
  e2eDeniedScenario,
  e2eIntersectionScenario,
  e2eIntersectionDeniedScenario,
]
