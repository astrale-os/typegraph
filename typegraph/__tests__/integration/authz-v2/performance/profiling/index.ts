/**
 * Profiling Module
 *
 * Re-exports all profiling infrastructure for latency profiling tests.
 */

// Types
export type {
  Phase,
  Span,
  SpanMetadata,
  Trace,
  TraceInput,
  TraceOutput,
  Stats,
  TraceMetrics,
  ScenarioConfig,
  ScenarioResult,
  PerformanceThresholds,
} from './types'

export { DEFAULT_THRESHOLDS } from './types'

// Execution context
export {
  type ExecutionContext,
  runWithContext,
  getContext,
  getTraceId,
  getParentSpanId,
  getCurrentPhase,
  withParentSpan,
  withPhase,
  runWithParentSpan,
  runWithPhase,
  generateSpanId,
  generateTraceId,
  resetCounters,
} from './execution-context'

// Span collector
export { SpanCollector, type SpanNode, buildSpanTree, flattenSpanTree } from './span-collector'

// Metrics calculator
export {
  calculateStats,
  calculateTraceMetrics,
  formatMicros,
  formatStats,
  formatMetricsReport,
} from './metrics-calculator'

// Profiling proxy
export { ProfilingAccessQueryAdapter, createProfilingAdapter } from './profiling-proxy'
