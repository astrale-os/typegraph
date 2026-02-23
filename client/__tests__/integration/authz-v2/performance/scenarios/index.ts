/**
 * Scenario Registry
 *
 * Exports all test scenarios and provides a registry for lookup by ID.
 */

import type { TestScenario, ScenarioResult, ScenarioRunnerOptions } from './types'
export type {
  TestScenario,
  ScenarioResult,
  ScenarioRunnerOptions,
  ThresholdViolation,
} from './types'
export {
  DEFAULT_RUNNER_OPTIONS,
  simpleGrant,
  separateGrant,
  union,
  intersect,
  exclude,
  identity,
} from './types'

// Direct permission scenarios
import {
  directPermissionScenario,
  directPermissionM2Scenario,
  directPermissionWrongPermScenario,
} from './direct-permission'

// Hierarchical scenarios
import {
  hierarchicalReadRootScenario,
  hierarchicalReadRoot2Scenario,
  hierarchicalEditWorkspaceScenario,
  hierarchicalEditWrongWorkspaceScenario,
  hierarchicalRoleEditScenario,
} from './hierarchical-deep'

// Composed union scenarios
import {
  composedUnionEditScenario,
  composedUnionEditViaUser,
  composedUnionReadScenario,
  composedUnionABScenario,
  composedUnionABM2Scenario,
} from './composed-union'

// Composed exclude scenarios
import {
  composedExcludeM1Scenario,
  composedExcludeM2Scenario,
  composedExcludeUserRoleReadScenario,
  composedExcludeUserRoleEditScenario,
  composedExcludeRoleUserEditScenario,
} from './composed-exclude'

// Batch scenarios
import {
  batchSamePermDiffNodeScenarios,
  batchDiffPermSameNodeScenarios,
  batchDiffIdentitySamePermScenarios,
  allBatchScenarios,
} from './batch-permissions'

// End-to-end scenarios
import {
  e2eSimpleAppScenario,
  e2eUserInheritedScenario,
  e2eComposedUnionScenario,
  e2eDeniedScenario,
  e2eIntersectionScenario,
  e2eIntersectionDeniedScenario,
  allE2EScenarios,
} from './end-to-end'

// =============================================================================
// SCENARIO GROUPS
// =============================================================================

export const directPermissionScenarios: TestScenario[] = [
  directPermissionScenario,
  directPermissionM2Scenario,
  directPermissionWrongPermScenario,
]

export const hierarchicalScenarios: TestScenario[] = [
  hierarchicalReadRootScenario,
  hierarchicalReadRoot2Scenario,
  hierarchicalEditWorkspaceScenario,
  hierarchicalEditWrongWorkspaceScenario,
  hierarchicalRoleEditScenario,
]

export const composedUnionScenarios: TestScenario[] = [
  composedUnionEditScenario,
  composedUnionEditViaUser,
  composedUnionReadScenario,
  composedUnionABScenario,
  composedUnionABM2Scenario,
]

export const composedExcludeScenarios: TestScenario[] = [
  composedExcludeM1Scenario,
  composedExcludeM2Scenario,
  composedExcludeUserRoleReadScenario,
  composedExcludeUserRoleEditScenario,
  composedExcludeRoleUserEditScenario,
]

export { allBatchScenarios, allE2EScenarios }

// =============================================================================
// ALL SCENARIOS
// =============================================================================

export const allScenarios: TestScenario[] = [
  ...directPermissionScenarios,
  ...hierarchicalScenarios,
  ...composedUnionScenarios,
  ...composedExcludeScenarios,
  ...allE2EScenarios,
]

// =============================================================================
// SCENARIO REGISTRY
// =============================================================================

const scenarioMap = new Map<string, TestScenario>()

// Register all scenarios
for (const scenario of allScenarios) {
  scenarioMap.set(scenario.id, scenario)
}

// Also register batch scenarios (not in allScenarios to avoid duplication)
for (const scenario of allBatchScenarios) {
  if (!scenarioMap.has(scenario.id)) {
    scenarioMap.set(scenario.id, scenario)
  }
}

/**
 * Get a scenario by ID.
 */
export function getScenario(id: string): TestScenario | undefined {
  return scenarioMap.get(id)
}

/**
 * Get all registered scenario IDs.
 */
export function getScenarioIds(): string[] {
  return Array.from(scenarioMap.keys())
}

/**
 * Get scenarios by group name.
 */
export function getScenarioGroup(
  group: 'direct' | 'hierarchical' | 'union' | 'exclude' | 'batch' | 'e2e' | 'all',
): TestScenario[] {
  switch (group) {
    case 'direct':
      return directPermissionScenarios
    case 'hierarchical':
      return hierarchicalScenarios
    case 'union':
      return composedUnionScenarios
    case 'exclude':
      return composedExcludeScenarios
    case 'batch':
      return allBatchScenarios
    case 'e2e':
      return allE2EScenarios
    case 'all':
      return allScenarios
  }
}
