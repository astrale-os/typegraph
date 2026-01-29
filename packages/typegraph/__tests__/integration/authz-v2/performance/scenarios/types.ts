/**
 * Scenario Types
 *
 * Types for performance test scenarios.
 */

import type { IdentityExpr, Grant } from '../../types'
import type { Trace, TraceMetrics, PerformanceThresholds } from '../profiling'

// =============================================================================
// SCENARIO CONFIGURATION
// =============================================================================

/**
 * Configuration for a single test scenario.
 */
export interface TestScenario {
  /** Unique identifier for the scenario. */
  id: string

  /** Human-readable name. */
  name: string

  /** Description of what this scenario tests. */
  description: string

  /** Input parameters. */
  principal: string
  nodeId: string
  perm: string
  grant: Grant

  /** Expected result. */
  expectedGranted: boolean
  expectedDeniedBy?: 'type' | 'resource'

  /** Optional custom thresholds for this scenario. */
  thresholds?: Partial<PerformanceThresholds>
}

// =============================================================================
// SCENARIO RESULT
// =============================================================================

/**
 * Result of running a scenario.
 */
export interface ScenarioResult {
  /** The scenario that was run. */
  scenario: TestScenario

  /** All traces collected during the run. */
  traces: Trace[]

  /** Aggregated metrics from the traces. */
  metrics: TraceMetrics

  /** Whether the scenario passed correctness checks. */
  passed: boolean

  /** Whether the scenario passed performance thresholds. */
  passedThresholds: boolean

  /** Error message if the scenario failed. */
  error?: string

  /** Detailed threshold violations. */
  thresholdViolations?: ThresholdViolation[]
}

/**
 * A specific threshold violation.
 */
export interface ThresholdViolation {
  metric: string
  actual: number
  threshold: number
  unit: string
}

// =============================================================================
// SCENARIO RUNNER OPTIONS
// =============================================================================

/**
 * Options for running scenarios.
 */
export interface ScenarioRunnerOptions {
  /** Number of iterations per scenario. */
  iterations: number

  /** Whether to warm up before measuring. */
  warmup: boolean

  /** Number of warmup iterations. */
  warmupIterations: number

  /** Whether to clear cache between iterations. */
  clearCacheBetweenIterations: boolean

  /** Default thresholds (can be overridden per scenario). */
  thresholds: PerformanceThresholds
}

/**
 * Default runner options.
 */
export const DEFAULT_RUNNER_OPTIONS: ScenarioRunnerOptions = {
  iterations: 50,
  warmup: true,
  warmupIterations: 5,
  clearCacheBetweenIterations: false,
  thresholds: {
    checkAccess: { mean: 5000, p95: 10000, p99: 20000 },
    directPermission: { mean: 2000, p95: 5000 },
    hierarchicalDeep: { mean: 8000, p95: 15000 },
    phases: { trust: 10, decode: 5, resolve: 20, decide: 70 },
    cache: { minHitRate: 80 },
  },
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create a simple grant with a single identity for both type and resource.
 */
export function simpleGrant(id: string): Grant {
  const expr: IdentityExpr = { kind: 'identity', id }
  return { forType: expr, forResource: expr }
}

/**
 * Create a grant with separate type and resource identities.
 */
export function separateGrant(typeId: string, resourceId: string): Grant {
  return {
    forType: { kind: 'identity', id: typeId },
    forResource: { kind: 'identity', id: resourceId },
  }
}

/**
 * Create a union expression.
 */
export function union(left: IdentityExpr, right: IdentityExpr): IdentityExpr {
  return { kind: 'union', left, right }
}

/**
 * Create an intersect expression.
 */
export function intersect(left: IdentityExpr, right: IdentityExpr): IdentityExpr {
  return { kind: 'intersect', left, right }
}

/**
 * Create an exclude expression.
 */
export function exclude(left: IdentityExpr, right: IdentityExpr): IdentityExpr {
  return { kind: 'exclude', left, right }
}

/**
 * Create an identity expression.
 */
export function identity(id: string, scopes?: unknown[]): IdentityExpr {
  return scopes ? { kind: 'identity', id, scopes: scopes as any } : { kind: 'identity', id }
}
