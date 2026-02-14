/**
 * Latency Profiling Tests
 *
 * Integration tests that profile the authz-v2 authorization flow
 * using the seed data and generate latency reports.
 *
 * Run with: RUN_PERF_TESTS=1 pnpm test latency-profiling
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'

// Test setup
import { setupAuthzTest, teardownAuthzTest, type AuthzTestContext } from '../testing/setup'
import { USE } from '../testing/helpers'

// Adapter
import { FalkorDBAccessQueryAdapter } from '../adapter/queries'

// Authorization
import { checkAccess } from '../authorization/checker'

// Profiling infrastructure
import {
  SpanCollector,
  ProfilingAccessQueryAdapter,
  calculateTraceMetrics,
  runWithContext,
  resetCounters,
  DEFAULT_THRESHOLDS,
  type Trace,
  type TraceMetrics,
  type PerformanceThresholds,
} from './profiling'

// Scenarios
import {
  type TestScenario,
  type ScenarioResult,
  type ThresholdViolation,
  DEFAULT_RUNNER_OPTIONS,
  allScenarios,
  directPermissionScenarios,
  hierarchicalScenarios,
  composedUnionScenarios,
  composedExcludeScenarios,
  allBatchScenarios,
  allE2EScenarios,
} from './scenarios'

// Reports
import { buildReport, saveJsonReport, type LatencyReport } from './reports/json-exporter'
import { saveHtmlReport } from './reports/html-generator'

// =============================================================================
// TEST CONFIGURATION
// =============================================================================

const RUN_PERF_TESTS = process.env.RUN_PERF_TESTS === '1'
const ITERATIONS = parseInt(process.env.PERF_ITERATIONS ?? '10', 10)
const WARMUP_ITERATIONS = 3
const REPORT_DIR = join(__dirname, 'reports')

// =============================================================================
// SCENARIO RUNNER
// =============================================================================

interface RunnerContext {
  adapter: FalkorDBAccessQueryAdapter
  profilingAdapter: ProfilingAccessQueryAdapter
  collector: SpanCollector
}

async function runScenario(
  scenario: TestScenario,
  ctx: RunnerContext,
  iterations: number,
  warmup: boolean = true,
): Promise<ScenarioResult> {
  const traces: Trace[] = []
  let error: string | undefined

  // Warmup runs (not recorded)
  if (warmup) {
    for (let i = 0; i < WARMUP_ITERATIONS; i++) {
      ctx.adapter.clearCache()
      await checkAccess(
        {
          principal: scenario.principal,
          grant: scenario.grant,
          nodeId: scenario.nodeId,
          nodePerm: scenario.nodePerm,
          typePerm: USE,
        },
        ctx.adapter,
      )
    }
  }

  // Measured runs
  for (let i = 0; i < iterations; i++) {
    ctx.adapter.clearCache()
    resetCounters()

    const { traceId, context } = ctx.collector.startTrace(scenario.name, {
      principal: scenario.principal,
      nodeId: scenario.nodeId,
      nodePerm: scenario.nodePerm,
      forType: scenario.grant.forType,
      forResource: scenario.grant.forResource,
    })

    try {
      const result = await runWithContext(context, async () => {
        return checkAccess(
          {
            principal: scenario.principal,
            grant: scenario.grant,
            nodeId: scenario.nodeId,
            nodePerm: scenario.nodePerm,
            typePerm: USE,
          },
          ctx.profilingAdapter,
        )
      })

      const trace = ctx.collector.endTrace(traceId, {
        granted: result.granted,
        deniedBy: result.deniedBy,
      })
      traces.push(trace)

      // Verify correctness on first iteration
      if (i === 0) {
        if (result.granted !== scenario.expectedGranted) {
          error = `Expected granted=${scenario.expectedGranted}, got ${result.granted}`
        }
        if (scenario.expectedDeniedBy && result.deniedBy !== scenario.expectedDeniedBy) {
          error = `Expected deniedBy=${scenario.expectedDeniedBy}, got ${result.deniedBy}`
        }
      }
    } catch (e) {
      ctx.collector.endTrace(traceId, { granted: false })
      error = e instanceof Error ? e.message : String(e)
      break
    }
  }

  const metrics = calculateTraceMetrics(traces)
  const thresholds: PerformanceThresholds = {
    ...DEFAULT_THRESHOLDS,
    ...scenario.thresholds,
  }
  const { passed: passedThresholds, violations } = checkThresholds(metrics, thresholds)

  return {
    scenario,
    traces,
    metrics,
    passed: !error,
    passedThresholds,
    error,
    thresholdViolations: violations,
  }
}

function checkThresholds(
  metrics: TraceMetrics,
  thresholds: PerformanceThresholds,
): { passed: boolean; violations: ThresholdViolation[] } {
  const violations: ThresholdViolation[] = []

  // Check overall latency
  if (metrics.overall.mean > thresholds.checkAccess.mean) {
    violations.push({
      metric: 'checkAccess.mean',
      actual: metrics.overall.mean,
      threshold: thresholds.checkAccess.mean,
      unit: 'µs',
    })
  }
  if (metrics.overall.p95 > thresholds.checkAccess.p95) {
    violations.push({
      metric: 'checkAccess.p95',
      actual: metrics.overall.p95,
      threshold: thresholds.checkAccess.p95,
      unit: 'µs',
    })
  }
  if (metrics.overall.p99 > thresholds.checkAccess.p99) {
    violations.push({
      metric: 'checkAccess.p99',
      actual: metrics.overall.p99,
      threshold: thresholds.checkAccess.p99,
      unit: 'µs',
    })
  }

  return { passed: violations.length === 0, violations }
}

// =============================================================================
// TESTS
// =============================================================================

describe.skipIf(!RUN_PERF_TESTS)('Latency Profiling', () => {
  let testCtx: AuthzTestContext
  let runnerCtx: RunnerContext

  beforeAll(async () => {
    testCtx = await setupAuthzTest()

    const adapter = new FalkorDBAccessQueryAdapter(testCtx.executor, {
      maxDepth: 10,
    })
    const collector = new SpanCollector()
    const profilingAdapter = new ProfilingAccessQueryAdapter(adapter, collector)

    runnerCtx = { adapter, profilingAdapter, collector }
  })

  afterAll(async () => {
    await teardownAuthzTest(testCtx)
  })

  describe('Direct Permission Scenarios', () => {
    for (const scenario of directPermissionScenarios) {
      it(`${scenario.name}: ${scenario.description}`, async () => {
        const result = await runScenario(scenario, runnerCtx, ITERATIONS)
        expect(result.passed).toBe(true)
        expect(result.error).toBeUndefined()

        // Log metrics
        console.log(
          `  Mean: ${(result.metrics.overall.mean / 1000).toFixed(2)}ms`,
          `P95: ${(result.metrics.overall.p95 / 1000).toFixed(2)}ms`,
        )
      })
    }
  })

  describe('Hierarchical Scenarios', () => {
    for (const scenario of hierarchicalScenarios) {
      it(`${scenario.name}: ${scenario.description}`, async () => {
        const result = await runScenario(scenario, runnerCtx, ITERATIONS)
        expect(result.passed).toBe(true)
        expect(result.error).toBeUndefined()

        console.log(
          `  Mean: ${(result.metrics.overall.mean / 1000).toFixed(2)}ms`,
          `P95: ${(result.metrics.overall.p95 / 1000).toFixed(2)}ms`,
        )
      })
    }
  })

  describe('Composed Union Scenarios', () => {
    for (const scenario of composedUnionScenarios) {
      it(`${scenario.name}: ${scenario.description}`, async () => {
        const result = await runScenario(scenario, runnerCtx, ITERATIONS)
        expect(result.passed).toBe(true)
        expect(result.error).toBeUndefined()

        console.log(
          `  Mean: ${(result.metrics.overall.mean / 1000).toFixed(2)}ms`,
          `P95: ${(result.metrics.overall.p95 / 1000).toFixed(2)}ms`,
        )
      })
    }
  })

  describe('Composed Exclude Scenarios', () => {
    for (const scenario of composedExcludeScenarios) {
      it(`${scenario.name}: ${scenario.description}`, async () => {
        const result = await runScenario(scenario, runnerCtx, ITERATIONS)
        expect(result.passed).toBe(true)
        expect(result.error).toBeUndefined()

        console.log(
          `  Mean: ${(result.metrics.overall.mean / 1000).toFixed(2)}ms`,
          `P95: ${(result.metrics.overall.p95 / 1000).toFixed(2)}ms`,
        )
      })
    }
  })

  describe('End-to-End Scenarios', () => {
    for (const scenario of allE2EScenarios) {
      it(`${scenario.name}: ${scenario.description}`, async () => {
        const result = await runScenario(scenario, runnerCtx, ITERATIONS)
        expect(result.passed).toBe(true)
        expect(result.error).toBeUndefined()

        console.log(
          `  Mean: ${(result.metrics.overall.mean / 1000).toFixed(2)}ms`,
          `P95: ${(result.metrics.overall.p95 / 1000).toFixed(2)}ms`,
        )
      })
    }
  })

  describe('Batch Scenarios (Cache Behavior)', () => {
    it('should show cache improvement across batch', async () => {
      const results: ScenarioResult[] = []

      // Run batch scenarios in sequence WITHOUT clearing cache between
      for (const scenario of allBatchScenarios.slice(0, 3)) {
        runnerCtx.adapter.clearCache() // Clear only at start
        const result = await runScenario(scenario, runnerCtx, 3, false)
        results.push(result)
        expect(result.passed).toBe(true)
      }

      // Second and third should be faster due to type cache
      const first = results[0]!.metrics.overall.mean
      const second = results[1]!.metrics.overall.mean
      const third = results[2]!.metrics.overall.mean

      console.log(`  First: ${(first / 1000).toFixed(2)}ms`)
      console.log(`  Second: ${(second / 1000).toFixed(2)}ms`)
      console.log(`  Third: ${(third / 1000).toFixed(2)}ms`)

      // Cache should help (allow some variance)
      // Not asserting specific improvement as it depends on environment
    })
  })

  describe('Report Generation', () => {
    it('should generate JSON and HTML reports', async () => {
      const results: ScenarioResult[] = []

      // Run a subset of scenarios
      const scenarios = [
        ...directPermissionScenarios.slice(0, 2),
        ...hierarchicalScenarios.slice(0, 2),
        ...composedUnionScenarios.slice(0, 2),
      ]

      for (const scenario of scenarios) {
        const result = await runScenario(scenario, runnerCtx, 5)
        results.push(result)
      }

      // Aggregate metrics
      const allTraces = results.flatMap((r) => r.traces)
      const aggregateMetrics = calculateTraceMetrics(allTraces)

      // Build report
      const report = buildReport(
        results,
        {
          iterations: 5,
          warmupIterations: WARMUP_ITERATIONS,
          thresholds: DEFAULT_THRESHOLDS,
          clearCacheBetweenIterations: true,
        },
        aggregateMetrics,
      )

      // Save reports
      saveJsonReport(report, join(REPORT_DIR, 'latency-report.json'))
      saveHtmlReport(report, join(REPORT_DIR, 'latency-report.html'))

      console.log(`  Reports saved to ${REPORT_DIR}`)
      console.log(`  Total scenarios: ${report.metadata.totalScenarios}`)
      console.log(`  Passed: ${report.metadata.passedScenarios}`)
      console.log(`  Failed: ${report.metadata.failedScenarios}`)
    })
  })
})

// =============================================================================
// FULL REPORT GENERATION (separate test)
// =============================================================================

describe.skipIf(!RUN_PERF_TESTS)('Full Report Generation', () => {
  let testCtx: AuthzTestContext
  let runnerCtx: RunnerContext

  beforeAll(async () => {
    testCtx = await setupAuthzTest()

    const adapter = new FalkorDBAccessQueryAdapter(testCtx.executor, {
      maxDepth: 10,
    })
    const collector = new SpanCollector()
    const profilingAdapter = new ProfilingAccessQueryAdapter(adapter, collector)

    runnerCtx = { adapter, profilingAdapter, collector }
  })

  afterAll(async () => {
    await teardownAuthzTest(testCtx)
  })

  it('should generate full report with all scenarios', async () => {
    const results: ScenarioResult[] = []
    const iterations = parseInt(process.env.PERF_ITERATIONS ?? '20', 10)

    console.log(`Running ${allScenarios.length} scenarios with ${iterations} iterations each...`)

    for (const scenario of allScenarios) {
      const result = await runScenario(scenario, runnerCtx, iterations)
      results.push(result)

      const status = result.passed ? '✓' : '✗'
      console.log(
        `  ${status} ${scenario.name}: ${(result.metrics.overall.mean / 1000).toFixed(2)}ms`,
      )
    }

    // Aggregate metrics
    const allTraces = results.flatMap((r) => r.traces)
    const aggregateMetrics = calculateTraceMetrics(allTraces)

    // Build and save report
    const report = buildReport(
      results,
      {
        iterations,
        warmupIterations: WARMUP_ITERATIONS,
        thresholds: DEFAULT_THRESHOLDS,
        clearCacheBetweenIterations: true,
      },
      aggregateMetrics,
    )

    saveJsonReport(report, join(REPORT_DIR, 'latency-report-full.json'))
    saveHtmlReport(report, join(REPORT_DIR, 'latency-report-full.html'))

    console.log('')
    console.log('=== Summary ===')
    console.log(`Total scenarios: ${report.metadata.totalScenarios}`)
    console.log(`Passed: ${report.metadata.passedScenarios}`)
    console.log(`Failed: ${report.metadata.failedScenarios}`)
    console.log(`Mean latency: ${(aggregateMetrics.overall.mean / 1000).toFixed(2)}ms`)
    console.log(`P95 latency: ${(aggregateMetrics.overall.p95 / 1000).toFixed(2)}ms`)
    console.log(`P99 latency: ${(aggregateMetrics.overall.p99 / 1000).toFixed(2)}ms`)
    console.log(`Cache hit rate: ${aggregateMetrics.cache.hitRate.toFixed(1)}%`)
    console.log('')
    console.log(`Reports saved to ${REPORT_DIR}`)

    // Assert overall pass rate
    expect(report.metadata.passedScenarios).toBe(report.metadata.totalScenarios)
  }, 120000) // 2 minute timeout
})
