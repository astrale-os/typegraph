/**
 * Metrics Calculator
 *
 * Computes statistics from traces: mean, p95, p99, stdDev, etc.
 * Provides phase breakdown and cache performance metrics.
 */

import type { Trace, Stats, TraceMetrics, Phase } from './types'

// =============================================================================
// STATISTICS CALCULATION
// =============================================================================

/**
 * Calculate statistics for an array of numeric values.
 */
export function calculateStats(values: number[]): Stats {
  if (values.length === 0) {
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

  const sorted = [...values].sort((a, b) => a - b)
  const count = sorted.length
  const total = sorted.reduce((sum, v) => sum + v, 0)
  const mean = total / count

  // Variance and standard deviation
  // Use sample standard deviation (n-1) for better statistical accuracy
  const variance =
    count > 1 ? sorted.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (count - 1) : 0
  const stdDev = Math.sqrt(variance)

  // Percentiles using correct formula: floor((count - 1) * percentile)
  // This ensures p95 returns a value where 95% of values are at or below
  const p95Index = Math.floor((count - 1) * 0.95)
  const p99Index = Math.floor((count - 1) * 0.99)
  const medianIndex = Math.floor((count - 1) * 0.5)

  return {
    count,
    min: sorted[0]!,
    max: sorted[count - 1]!,
    mean,
    median: sorted[medianIndex]!,
    p95: sorted[p95Index]!,
    p99: sorted[p99Index]!,
    stdDev,
    total,
  }
}

// =============================================================================
// TRACE METRICS
// =============================================================================

/**
 * Calculate metrics from a collection of traces.
 */
export function calculateTraceMetrics(traces: Trace[]): TraceMetrics {
  if (traces.length === 0) {
    return emptyMetrics()
  }

  // Overall timing
  const totalTimes = traces.map((t) => t.totalMicros)
  const overall = calculateStats(totalTimes)

  // Phase breakdown
  const byPhase = calculatePhaseStats(traces)

  // Method breakdown
  const byMethod = calculateMethodStats(traces)

  // Cache performance
  const cache = calculateCacheStats(traces)

  // Phase distribution (percentage of total time)
  const phaseDistribution = calculatePhaseDistribution(traces)

  return {
    overall,
    byPhase,
    byMethod,
    cache,
    phaseDistribution,
  }
}

/**
 * Calculate statistics grouped by phase.
 */
function calculatePhaseStats(traces: Trace[]): Record<Phase, Stats> {
  const phases: Phase[] = ['trust', 'resolve', 'decide', 'query']
  const phaseValues: Record<Phase, number[]> = {
    trust: [],
    resolve: [],
    decide: [],
    query: [],
  }

  for (const trace of traces) {
    // Aggregate span durations by phase for this trace
    const tracePhaseTotals: Record<Phase, number> = {
      trust: 0,
      resolve: 0,
      decide: 0,
      query: 0,
    }

    for (const span of trace.spans) {
      tracePhaseTotals[span.phase] += span.durationMicros
    }

    // Add to per-phase arrays
    for (const phase of phases) {
      if (tracePhaseTotals[phase] > 0) {
        phaseValues[phase].push(tracePhaseTotals[phase])
      }
    }
  }

  const result: Record<Phase, Stats> = {} as Record<Phase, Stats>
  for (const phase of phases) {
    result[phase] = calculateStats(phaseValues[phase])
  }

  return result
}

/**
 * Calculate statistics grouped by method name.
 */
function calculateMethodStats(traces: Trace[]): Record<string, Stats> {
  const methodValues: Record<string, number[]> = {}

  for (const trace of traces) {
    for (const span of trace.spans) {
      if (!methodValues[span.name]) {
        methodValues[span.name] = []
      }
      methodValues[span.name].push(span.durationMicros)
    }
  }

  const result: Record<string, Stats> = {}
  for (const [method, values] of Object.entries(methodValues)) {
    result[method] = calculateStats(values)
  }

  return result
}

/**
 * Calculate cache hit/miss statistics.
 */
function calculateCacheStats(traces: Trace[]): { hits: number; misses: number; hitRate: number } {
  let hits = 0
  let misses = 0

  for (const trace of traces) {
    for (const span of trace.spans) {
      if (span.cached) {
        hits++
      } else {
        misses++
      }
    }
  }

  const total = hits + misses
  const hitRate = total > 0 ? (hits / total) * 100 : 0

  return { hits, misses, hitRate }
}

/**
 * Calculate phase distribution as percentage of total time.
 */
function calculatePhaseDistribution(traces: Trace[]): Record<Phase, number> {
  const phases: Phase[] = ['trust', 'resolve', 'decide', 'query']
  const phaseTotals: Record<Phase, number> = {
    trust: 0,
    resolve: 0,
    decide: 0,
    query: 0,
  }

  let grandTotal = 0

  for (const trace of traces) {
    for (const span of trace.spans) {
      phaseTotals[span.phase] += span.durationMicros
      grandTotal += span.durationMicros
    }
  }

  const result: Record<Phase, number> = {} as Record<Phase, number>
  for (const phase of phases) {
    result[phase] = grandTotal > 0 ? (phaseTotals[phase] / grandTotal) * 100 : 0
  }

  return result
}

/**
 * Create empty metrics (for when there are no traces).
 */
function emptyMetrics(): TraceMetrics {
  const emptyStats: Stats = {
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

  return {
    overall: emptyStats,
    byPhase: {
      trust: emptyStats,
      resolve: emptyStats,
      decide: emptyStats,
      query: emptyStats,
    },
    byMethod: {},
    cache: { hits: 0, misses: 0, hitRate: 0 },
    phaseDistribution: { trust: 0, resolve: 0, decide: 0, query: 0 },
  }
}

// =============================================================================
// FORMATTING UTILITIES
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
 * Format stats as a summary string.
 */
export function formatStats(stats: Stats): string {
  return [
    `count=${stats.count}`,
    `mean=${formatMicros(stats.mean)}`,
    `p95=${formatMicros(stats.p95)}`,
    `p99=${formatMicros(stats.p99)}`,
    `stdDev=${formatMicros(stats.stdDev)}`,
  ].join(' ')
}

/**
 * Format trace metrics as a multi-line report.
 */
export function formatMetricsReport(metrics: TraceMetrics): string {
  const lines: string[] = []

  lines.push('=== Overall ===')
  lines.push(formatStats(metrics.overall))
  lines.push('')

  lines.push('=== By Phase ===')
  for (const [phase, stats] of Object.entries(metrics.byPhase)) {
    if (stats.count > 0) {
      lines.push(`${phase}: ${formatStats(stats)}`)
    }
  }
  lines.push('')

  lines.push('=== Phase Distribution ===')
  for (const [phase, pct] of Object.entries(metrics.phaseDistribution)) {
    lines.push(`${phase}: ${pct.toFixed(1)}%`)
  }
  lines.push('')

  lines.push('=== By Method ===')
  for (const [method, stats] of Object.entries(metrics.byMethod)) {
    lines.push(`${method}: ${formatStats(stats)}`)
  }
  lines.push('')

  lines.push('=== Cache ===')
  lines.push(
    `hits=${metrics.cache.hits} misses=${metrics.cache.misses} rate=${metrics.cache.hitRate.toFixed(1)}%`,
  )

  return lines.join('\n')
}
