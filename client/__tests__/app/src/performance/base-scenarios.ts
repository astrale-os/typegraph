/**
 * Base Scenarios
 *
 * Hardcoded scenarios for the base graph (23 nodes, 44 edges).
 * These are used when no scaled graph is generated.
 */

import type { TestScenario } from '../types/profiling'

export const AVAILABLE_SCENARIOS: TestScenario[] = [
  // Hierarchical read - APP-gateway authenticates, USER-alice has read on platform
  {
    id: 'hierarchical-read-root',
    name: 'Hierarchical Read (Root)',
    description:
      'APP-gateway with USER-alice grant: alice has read on platform, api (Function) inherits',
    principal: 'APP-gateway',
    nodeId: 'api',
    perm: 'read',
    grant: {
      forType: { kind: 'identity', id: 'APP-gateway' },
      forResource: { kind: 'identity', id: 'USER-alice' },
    },
    expectedGranted: true,
  },
  {
    id: 'hierarchical-edit-deep',
    name: 'Hierarchical Edit (4 Levels)',
    description:
      'APP-gateway with USER-alice grant: alice has edit on platform, etl (Function) inherits via data/pipelines',
    principal: 'APP-gateway',
    nodeId: 'etl',
    perm: 'edit',
    grant: {
      forType: { kind: 'identity', id: 'APP-gateway' },
      forResource: { kind: 'identity', id: 'USER-alice' },
    },
    expectedGranted: true,
  },
  // Direct permission - APP-gateway authenticates, USER-bob has read on backend
  {
    id: 'direct-permission',
    name: 'Direct Permission',
    description:
      'APP-gateway with USER-bob grant: bob has read on backend, auth (Function) inherits',
    principal: 'APP-gateway',
    nodeId: 'auth',
    perm: 'read',
    grant: {
      forType: { kind: 'identity', id: 'APP-gateway' },
      forResource: { kind: 'identity', id: 'USER-bob' },
    },
    expectedGranted: true,
  },
  // Composed union - APP-gateway authenticates, bob ∪ carol on api
  // bob has read on backend (parent of api), so union has read on api
  {
    id: 'composed-union-read',
    name: 'Composed Union',
    description:
      'APP-gateway with bob ∪ carol grant: bob has read on backend, api (Function) inherits',
    principal: 'APP-gateway',
    nodeId: 'api',
    perm: 'read',
    grant: {
      forType: { kind: 'identity', id: 'APP-gateway' },
      forResource: {
        kind: 'union',
        left: { kind: 'identity', id: 'USER-bob' },
        right: { kind: 'identity', id: 'USER-carol' },
      },
    },
    expectedGranted: true,
  },
  // Composed exclude - APP-gateway authenticates, bob \ carol on auth
  {
    id: 'composed-exclude',
    name: 'Composed Exclude',
    description: 'APP-gateway with bob \\ carol grant: bob has backend edit, carol does not',
    principal: 'APP-gateway',
    nodeId: 'auth',
    perm: 'edit',
    grant: {
      forType: { kind: 'identity', id: 'APP-gateway' },
      forResource: {
        kind: 'exclude',
        left: { kind: 'identity', id: 'USER-bob' },
        right: { kind: 'identity', id: 'USER-carol' },
      },
    },
    expectedGranted: true,
  },
  // Denied case - APP-gateway authenticates, USER-carol has no edit on auth
  {
    id: 'denied-no-permission',
    name: 'Denied (No Permission)',
    description:
      'APP-gateway with USER-carol grant: carol has no edit permission on auth (Function)',
    principal: 'APP-gateway',
    nodeId: 'auth',
    perm: 'edit',
    grant: {
      forType: { kind: 'identity', id: 'APP-gateway' },
      forResource: { kind: 'identity', id: 'USER-carol' },
    },
    expectedGranted: false,
  },
]
