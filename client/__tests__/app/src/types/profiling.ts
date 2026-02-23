/**
 * Profiling Types for UI
 *
 * Shared types for the latency profiling UI components.
 */

// =============================================================================
// SPAN & TRACE TYPES
// =============================================================================

export type Phase = 'trust' | 'decode' | 'resolve' | 'decide' | 'query'

export interface Span {
  id: string
  parentId: string | null
  name: string
  phase: Phase
  startMicros: number
  endMicros: number
  durationMicros: number
  cached: boolean
  metadata?: SpanMetadata
}

export interface SpanMetadata {
  query?: {
    cypher: string
    params: Record<string, unknown>
  }
  inputSize?: number
  outputSize?: number
  result?: unknown
}

export interface Trace {
  id: string
  name: string
  startMicros: number
  endMicros: number
  totalMicros: number
  spans: Span[]
  input: TraceInput
  output: TraceOutput
}

export interface TraceInput {
  principal: string
  nodeId: string
  perm: string
  forType: unknown
  forResource: unknown
}

export interface TraceOutput {
  granted: boolean
  deniedBy?: 'type' | 'resource'
}

// =============================================================================
// METRICS TYPES
// =============================================================================

export interface Stats {
  count: number
  min: number
  max: number
  mean: number
  median: number
  p95: number
  p99: number
  stdDev: number
  total: number
}

export interface TraceMetrics {
  overall: Stats
  byPhase: Record<Phase, Stats>
  byMethod: Record<string, Stats>
  cache: {
    hits: number
    misses: number
    hitRate: number
  }
  phaseDistribution: Record<Phase, number>
}

// =============================================================================
// SCENARIO TYPES
// =============================================================================

export interface TestScenario {
  id: string
  name: string
  description: string
  principal: string
  nodeId: string
  perm: string
  grant: {
    forType: unknown
    forResource: unknown
  }
  expectedGranted: boolean
  expectedDeniedBy?: 'type' | 'resource'
}

export interface ScenarioResult {
  scenario: TestScenario
  traces: Trace[]
  metrics: TraceMetrics
  /** First iteration (no cache) */
  coldTrace: Trace | null
  /** Iterations 1-N (warmed cache) */
  warmMetrics: TraceMetrics
  passed: boolean
  passedThresholds: boolean
  error?: string
  thresholdViolations?: ThresholdViolation[]
}

export interface ThresholdViolation {
  metric: string
  actual: number
  threshold: number
  unit: string
}

// =============================================================================
// REPORT TYPES
// =============================================================================

export interface LatencyReport {
  metadata: ReportMetadata
  scenarios: ScenarioResult[]
  aggregateMetrics: TraceMetrics
  config: ReportConfig
}

export interface ReportMetadata {
  generatedAt: string
  version: string
  totalScenarios: number
  passedScenarios: number
  failedScenarios: number
  totalTraces: number
  totalDurationMs: number
}

export interface ReportConfig {
  iterations: number
  warmupIterations: number
  thresholds: PerformanceThresholds
  clearCacheBetweenIterations: boolean
}

export interface PerformanceThresholds {
  checkAccess: { mean: number; p95: number; p99: number }
  directPermission: { mean: number; p95: number }
  hierarchicalDeep: { mean: number; p95: number }
  phases: { trust: number; decode: number; resolve: number; decide: number }
  cache: { minHitRate: number }
}

// =============================================================================
// UI STATE TYPES
// =============================================================================

export type ProfilerTab = 'timeline' | 'waterfall' | 'breakdown' | 'comparison' | 'queries'

export interface ProfilerState {
  /** Currently selected scenarios for running. */
  selectedScenarios: string[]

  /** Number of iterations to run. */
  iterations: number

  /** Whether profiling is currently running. */
  running: boolean

  /** Current progress (0-100). */
  progress: number

  /** Current status message. */
  statusMessage: string

  /** Results from the last run. */
  results: ScenarioResult[]

  /** Aggregate metrics from the last run. */
  aggregateMetrics: TraceMetrics | null

  /** Active tab in the results view. */
  activeTab: ProfilerTab

  /** Selected scenario for detailed view. */
  selectedResult: ScenarioResult | null

  /** Selected trace for drill-down. */
  selectedTrace: Trace | null

  /** Error message if any. */
  error: string | null
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Format microseconds as a human-readable string.
 */
export function formatMicros(micros: number): string {
  if (micros < 1000) {
    return `${micros.toFixed(1)}µs`
  }
  if (micros < 1_000_000) {
    return `${(micros / 1000).toFixed(2)}ms`
  }
  return `${(micros / 1_000_000).toFixed(2)}s`
}

/**
 * Get color for a phase.
 */
export function getPhaseColor(phase: Phase): string {
  switch (phase) {
    case 'trust':
      return '#3b82f6' // blue
    case 'decode':
      return '#06b6d4' // cyan
    case 'resolve':
      return '#8b5cf6' // purple
    case 'decide':
      return '#22c55e' // green
    case 'query':
      return '#f59e0b' // amber
  }
}

/**
 * Calculate empty stats.
 */
export function emptyStats(): Stats {
  return {
    count: 0,
    min: 0,
    max: 0,
    mean: 0,
    median: 0,
    p95: 0,
    p99: 0,
    stdDev: 0,
    total: 0,
  }
}

/**
 * Calculate empty metrics.
 */
export function emptyMetrics(): TraceMetrics {
  const stats = emptyStats()
  return {
    overall: stats,
    byPhase: { trust: stats, decode: stats, resolve: stats, decide: stats, query: stats },
    byMethod: {},
    cache: { hits: 0, misses: 0, hitRate: 0 },
    phaseDistribution: { trust: 0, decode: 0, resolve: 0, decide: 0, query: 0 },
  }
}
