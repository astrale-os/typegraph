/**
 * JSON Exporter
 *
 * Exports trace data and metrics to JSON for analysis and storage.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Trace, TraceMetrics, PerformanceThresholds } from '../profiling'
import type { TestScenario, ScenarioResult } from '../scenarios'

// =============================================================================
// EXPORT TYPES
// =============================================================================

export interface LatencyReport {
  /** Report metadata. */
  metadata: ReportMetadata

  /** All scenario results. */
  scenarios: ScenarioResult[]

  /** Aggregate metrics across all scenarios. */
  aggregateMetrics: TraceMetrics

  /** Configuration used. */
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

// =============================================================================
// JSON EXPORT
// =============================================================================

/**
 * Export a latency report to JSON.
 */
export function exportToJson(report: LatencyReport): string {
  return JSON.stringify(report, null, 2)
}

/**
 * Save a latency report to a JSON file.
 */
export function saveJsonReport(report: LatencyReport, filePath: string): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(filePath, exportToJson(report), 'utf-8')
}

// =============================================================================
// REPORT BUILDER
// =============================================================================

/**
 * Build a latency report from scenario results.
 */
export function buildReport(
  results: ScenarioResult[],
  config: ReportConfig,
  aggregateMetrics: TraceMetrics,
): LatencyReport {
  const passedScenarios = results.filter((r) => r.passed && r.passedThresholds).length
  const failedScenarios = results.length - passedScenarios
  const totalTraces = results.reduce((sum, r) => sum + r.traces.length, 0)
  const totalDurationMs =
    results.reduce((sum, r) => sum + r.traces.reduce((tSum, t) => tSum + t.totalMicros, 0), 0) /
    1000

  return {
    metadata: {
      generatedAt: new Date().toISOString(),
      version: '1.0.0',
      totalScenarios: results.length,
      passedScenarios,
      failedScenarios,
      totalTraces,
      totalDurationMs,
    },
    scenarios: results,
    aggregateMetrics,
    config,
  }
}

// =============================================================================
// TRACE SUMMARY
// =============================================================================

/**
 * Create a summary of traces (for smaller exports).
 */
export interface TraceSummary {
  id: string
  name: string
  totalMicros: number
  spanCount: number
  granted: boolean
}

export function summarizeTraces(traces: Trace[]): TraceSummary[] {
  return traces.map((t) => ({
    id: t.id,
    name: t.name,
    totalMicros: t.totalMicros,
    spanCount: t.spans.length,
    granted: t.output.granted,
  }))
}

/**
 * Export a compact summary report (without full span details).
 */
export interface CompactReport {
  metadata: ReportMetadata
  scenarios: Array<{
    scenario: { id: string; name: string; description: string }
    metrics: TraceMetrics
    passed: boolean
    passedThresholds: boolean
    error?: string
    traceSummaries: TraceSummary[]
  }>
  aggregateMetrics: TraceMetrics
  config: ReportConfig
}

export function buildCompactReport(
  results: ScenarioResult[],
  config: ReportConfig,
  aggregateMetrics: TraceMetrics,
): CompactReport {
  const fullReport = buildReport(results, config, aggregateMetrics)

  return {
    metadata: fullReport.metadata,
    scenarios: results.map((r) => ({
      scenario: {
        id: r.scenario.id,
        name: r.scenario.name,
        description: r.scenario.description,
      },
      metrics: r.metrics,
      passed: r.passed,
      passedThresholds: r.passedThresholds,
      error: r.error,
      traceSummaries: summarizeTraces(r.traces),
    })),
    aggregateMetrics,
    config,
  }
}

export function exportCompactJson(report: CompactReport): string {
  return JSON.stringify(report, null, 2)
}
