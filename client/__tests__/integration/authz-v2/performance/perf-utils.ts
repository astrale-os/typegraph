/**
 * Performance Testing Utilities
 *
 * Provides timing, concurrency, and statistics utilities for performance tests.
 */

// =============================================================================
// TIMING UTILITIES
// =============================================================================

export interface TimingResult<T> {
  result: T
  durationMs: number
}

/**
 * Measure execution time of an async function.
 */
export async function timed<T>(fn: () => Promise<T>): Promise<TimingResult<T>> {
  const start = performance.now()
  const result = await fn()
  const durationMs = performance.now() - start
  return { result, durationMs }
}

/**
 * Run a function multiple times and collect timing statistics.
 */
export async function benchmark<T>(
  fn: () => Promise<T>,
  iterations: number,
): Promise<BenchmarkResult<T>> {
  const timings: number[] = []
  let lastResult: T | undefined

  for (let i = 0; i < iterations; i++) {
    const { result, durationMs } = await timed(fn)
    timings.push(durationMs)
    lastResult = result
  }

  return {
    result: lastResult!,
    stats: calculateStats(timings),
    timings,
  }
}

export interface BenchmarkResult<T> {
  result: T
  stats: TimingStats
  timings: number[]
}

export interface TimingStats {
  count: number
  min: number
  max: number
  mean: number
  median: number
  p95: number
  p99: number
  stdDev: number
  totalMs: number
}

function calculateStats(timings: number[]): TimingStats {
  const sorted = [...timings].sort((a, b) => a - b)
  const count = sorted.length
  const totalMs = sorted.reduce((a, b) => a + b, 0)
  const mean = totalMs / count

  const variance = sorted.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / count
  const stdDev = Math.sqrt(variance)

  return {
    count,
    min: sorted[0],
    max: sorted[count - 1],
    mean,
    median: sorted[Math.floor(count / 2)],
    p95: sorted[Math.floor(count * 0.95)],
    p99: sorted[Math.floor(count * 0.99)],
    stdDev,
    totalMs,
  }
}

// =============================================================================
// CONCURRENCY UTILITIES
// =============================================================================

export interface ConcurrencyResult<T> {
  results: T[]
  errors: Error[]
  stats: ConcurrencyStats
}

export interface ConcurrencyStats {
  totalRequests: number
  successCount: number
  errorCount: number
  totalDurationMs: number
  throughputPerSec: number
  timing: TimingStats
}

/**
 * Run multiple concurrent operations and collect results.
 */
export async function runConcurrent<T>(
  fn: (index: number) => Promise<T>,
  concurrency: number,
): Promise<ConcurrencyResult<T>> {
  const results: T[] = []
  const errors: Error[] = []
  const timings: number[] = []

  const startTime = performance.now()

  const promises = Array.from({ length: concurrency }, async (_, i) => {
    const opStart = performance.now()
    try {
      const result = await fn(i)
      timings.push(performance.now() - opStart)
      results.push(result)
    } catch (err) {
      timings.push(performance.now() - opStart)
      errors.push(err instanceof Error ? err : new Error(String(err)))
    }
  })

  await Promise.all(promises)

  const totalDurationMs = performance.now() - startTime

  return {
    results,
    errors,
    stats: {
      totalRequests: concurrency,
      successCount: results.length,
      errorCount: errors.length,
      totalDurationMs,
      throughputPerSec: (concurrency / totalDurationMs) * 1000,
      timing: calculateStats(timings),
    },
  }
}

/**
 * Run waves of concurrent operations.
 */
export async function runConcurrentWaves<T>(
  fn: (waveIndex: number, opIndex: number) => Promise<T>,
  waves: number,
  concurrencyPerWave: number,
): Promise<WaveResult<T>> {
  const waveResults: ConcurrencyResult<T>[] = []

  const startTime = performance.now()

  for (let wave = 0; wave < waves; wave++) {
    const result = await runConcurrent((i) => fn(wave, i), concurrencyPerWave)
    waveResults.push(result)
  }

  const totalDurationMs = performance.now() - startTime
  const totalRequests = waves * concurrencyPerWave
  const totalSuccess = waveResults.reduce((sum, r) => sum + r.stats.successCount, 0)
  const totalErrors = waveResults.reduce((sum, r) => sum + r.stats.errorCount, 0)
  const allTimings = waveResults.flatMap((r) => r.stats.timing.mean)

  return {
    waveResults,
    aggregate: {
      waves,
      concurrencyPerWave,
      totalRequests,
      successCount: totalSuccess,
      errorCount: totalErrors,
      totalDurationMs,
      throughputPerSec: (totalRequests / totalDurationMs) * 1000,
      avgLatencyMs: allTimings.reduce((a, b) => a + b, 0) / allTimings.length,
    },
  }
}

export interface WaveResult<T> {
  waveResults: ConcurrencyResult<T>[]
  aggregate: {
    waves: number
    concurrencyPerWave: number
    totalRequests: number
    successCount: number
    errorCount: number
    totalDurationMs: number
    throughputPerSec: number
    avgLatencyMs: number
  }
}

// =============================================================================
// LOAD PATTERNS
// =============================================================================

/**
 * Sustained load test - run operations at a target rate for a duration.
 */
export async function sustainedLoad<T>(
  fn: () => Promise<T>,
  config: {
    targetRps: number
    durationMs: number
    maxConcurrent?: number
  },
): Promise<SustainedLoadResult<T>> {
  const { targetRps, durationMs, maxConcurrent = 100 } = config

  const intervalMs = 1000 / targetRps
  const results: Array<{ result?: T; error?: Error; latencyMs: number; startedAt: number }> = []

  const startTime = performance.now()
  const endTime = startTime + durationMs

  let inFlight = 0
  let operationIndex = 0

  return new Promise((resolve) => {
    const tryLaunch = () => {
      const now = performance.now()

      if (now >= endTime) {
        // Wait for in-flight operations to complete
        const checkComplete = setInterval(() => {
          if (inFlight === 0) {
            clearInterval(checkComplete)

            const successResults = results.filter((r) => r.result !== undefined)
            const errorResults = results.filter((r) => r.error !== undefined)

            resolve({
              results: successResults.map((r) => r.result!),
              errors: errorResults.map((r) => r.error!),
              stats: {
                totalRequests: results.length,
                successCount: successResults.length,
                errorCount: errorResults.length,
                totalDurationMs: performance.now() - startTime,
                actualRps: (results.length / durationMs) * 1000,
                targetRps,
                timing: calculateStats(results.map((r) => r.latencyMs)),
              },
            })
          }
        }, 10)
        return
      }

      if (inFlight < maxConcurrent) {
        inFlight++
        operationIndex++
        const opStart = performance.now()

        fn()
          .then((result) => {
            results.push({
              result,
              latencyMs: performance.now() - opStart,
              startedAt: opStart - startTime,
            })
          })
          .catch((error) => {
            results.push({
              error: error instanceof Error ? error : new Error(String(error)),
              latencyMs: performance.now() - opStart,
              startedAt: opStart - startTime,
            })
          })
          .finally(() => {
            inFlight--
          })
      }

      setTimeout(tryLaunch, intervalMs)
    }

    tryLaunch()
  })
}

export interface SustainedLoadResult<T> {
  results: T[]
  errors: Error[]
  stats: {
    totalRequests: number
    successCount: number
    errorCount: number
    totalDurationMs: number
    actualRps: number
    targetRps: number
    timing: TimingStats
  }
}

// =============================================================================
// REPORTING
// =============================================================================

export function formatStats(stats: TimingStats): string {
  return [
    `  Count: ${stats.count}`,
    `  Min: ${stats.min.toFixed(2)}ms`,
    `  Max: ${stats.max.toFixed(2)}ms`,
    `  Mean: ${stats.mean.toFixed(2)}ms`,
    `  Median: ${stats.median.toFixed(2)}ms`,
    `  P95: ${stats.p95.toFixed(2)}ms`,
    `  P99: ${stats.p99.toFixed(2)}ms`,
    `  StdDev: ${stats.stdDev.toFixed(2)}ms`,
  ].join('\n')
}

export function formatConcurrencyStats(stats: ConcurrencyStats): string {
  return [
    `  Total Requests: ${stats.totalRequests}`,
    `  Success: ${stats.successCount}`,
    `  Errors: ${stats.errorCount}`,
    `  Total Duration: ${stats.totalDurationMs.toFixed(2)}ms`,
    `  Throughput: ${stats.throughputPerSec.toFixed(2)} req/sec`,
    `  Latency:`,
    formatStats(stats.timing)
      .split('\n')
      .map((l) => '  ' + l)
      .join('\n'),
  ].join('\n')
}
