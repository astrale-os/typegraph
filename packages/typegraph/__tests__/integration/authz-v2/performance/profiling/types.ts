/**
 * Profiling Types
 *
 * Core types for the latency profiling system.
 * Spans track individual operations, traces aggregate spans into call trees.
 */

// =============================================================================
// SPAN TYPES
// =============================================================================

/**
 * Execution phase within the authorization flow.
 */
export type Phase = 'trust' | 'decode' | 'resolve' | 'decide' | 'query'

/**
 * Individual timed operation.
 *
 * Spans form a tree via parentId relationships, enabling
 * call chain reconstruction and waterfall visualization.
 */
export interface Span {
  id: string
  parentId: string | null
  name: string
  phase: Phase
  startMicros: number
  endMicros: number
  durationMicros: number

  /** Whether this operation hit a cache. */
  cached: boolean

  /** Additional metadata for drill-down. */
  metadata?: SpanMetadata
}

/**
 * Optional span metadata for detailed analysis.
 */
export interface SpanMetadata {
  /** Cypher query details (for query spans). */
  query?: {
    cypher: string
    params: Record<string, unknown>
  }

  /** Input/output sizes in bytes. */
  inputSize?: number
  outputSize?: number

  /** Result of the operation. */
  result?: unknown
}

// =============================================================================
// TRACE TYPES
// =============================================================================

/**
 * Complete execution trace for a single access check.
 *
 * Contains all spans from a single checkAccess or explainAccess call,
 * enabling timeline visualization and phase breakdown analysis.
 */
export interface Trace {
  id: string
  name: string
  startMicros: number
  endMicros: number
  totalMicros: number
  spans: Span[]

  /** Input parameters for reproducibility. */
  input: TraceInput

  /** Output result. */
  output: TraceOutput
}

/**
 * Input parameters that produced this trace.
 */
export interface TraceInput {
  principal: string
  nodeId: string
  nodePerm: number
  forType: unknown
  forResource: unknown
}

/**
 * Output result of the traced operation.
 */
export interface TraceOutput {
  granted: boolean
  deniedBy?: 'type' | 'resource'
}

// =============================================================================
// METRICS TYPES
// =============================================================================

/**
 * Aggregated statistics for a collection of values.
 */
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

/**
 * Metrics computed from a collection of traces.
 */
export interface TraceMetrics {
  /** Overall timing statistics (in microseconds). */
  overall: Stats

  /** Breakdown by phase. */
  byPhase: Record<Phase, Stats>

  /** Breakdown by method name. */
  byMethod: Record<string, Stats>

  /** Cache performance. */
  cache: {
    hits: number
    misses: number
    hitRate: number
  }

  /** Phase distribution as percentages. */
  phaseDistribution: Record<Phase, number>
}

// =============================================================================
// SCENARIO TYPES (RE-EXPORTED FROM SCENARIOS)
// =============================================================================

export interface ScenarioConfig {
  name: string
  description: string
  principal: string
  nodeId: string
  nodePerm: number
  forType: unknown
  forResource: unknown
  expectedGranted: boolean
}

export interface ScenarioResult {
  scenario: ScenarioConfig
  traces: Trace[]
  metrics: TraceMetrics
  passed: boolean
  error?: string
}

// =============================================================================
// THRESHOLDS
// =============================================================================

/**
 * Performance thresholds for assertions.
 * All timing values are in microseconds.
 */
export interface PerformanceThresholds {
  checkAccess: {
    mean: number
    p95: number
    p99: number
  }
  directPermission: {
    mean: number
    p95: number
  }
  hierarchicalDeep: {
    mean: number
    p95: number
  }
  phases: {
    trust: number
    decode: number
    resolve: number
    decide: number
  }
  cache: {
    minHitRate: number
  }
}

export const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  checkAccess: { mean: 5000, p95: 10000, p99: 20000 },
  directPermission: { mean: 2000, p95: 5000 },
  hierarchicalDeep: { mean: 8000, p95: 15000 },
  phases: { trust: 10, decode: 5, resolve: 20, decide: 70 },
  cache: { minHitRate: 80 },
}
