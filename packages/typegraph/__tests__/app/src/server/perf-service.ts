/**
 * Performance Service
 *
 * Server-side handlers for latency profiling API endpoints.
 */

import type { PlaygroundFalkorDBClient } from './falkordb-client'
import type {
  ScenarioResult,
  TestScenario,
  Trace,
  TraceMetrics,
  Stats,
  Phase,
  Span,
} from '../types/profiling'
import { emptyMetrics } from '../types/profiling'
import {
  type Scale,
  type GraphMetadata,
  SCENARIO_TEMPLATES,
  instantiateScenarios,
  AVAILABLE_SCENARIOS,
} from '../performance'

// =============================================================================
// TYPES
// =============================================================================

interface RunScenarioRequest {
  scenario: TestScenario
  iterations: number
}

// =============================================================================
// CACHED METADATA
// =============================================================================

export let cachedMetadata: GraphMetadata | null = null

// =============================================================================
// HANDLERS
// =============================================================================

export async function handleRunScenario(
  body: Record<string, unknown>,
  client: PlaygroundFalkorDBClient,
): Promise<ScenarioResult> {
  const { scenario, iterations } = body as unknown as RunScenarioRequest

  if (!scenario || !iterations) {
    throw new Error('scenario and iterations are required')
  }

  if (!client.connected) {
    throw new Error('Not connected to FalkorDB')
  }

  const traces: Trace[] = []
  let error: string | undefined
  let coldTrace: Trace | null = null

  // Extract app ID for E2E flow (principal is the app)
  const appId = scenario.principal

  // NO warmup - first iteration is "cold", subsequent are "warm"
  for (let i = 0; i < iterations; i++) {
    const traceId = `trace_${i}_${Date.now()}`
    const startMicros = performance.now() * 1000

    try {
      const { result, profile } = await client.checkAccessE2E({
        appId,
        grant: scenario.grant as any,
        nodeId: scenario.nodeId,
        perm: scenario.perm,
      })

      const endMicros = performance.now() * 1000

      // Build spans from profile
      const spans = buildSpansFromProfile(profile, startMicros)

      const trace: Trace = {
        id: traceId,
        name: scenario.name,
        startMicros,
        endMicros,
        totalMicros: endMicros - startMicros,
        spans,
        input: {
          principal: scenario.principal,
          nodeId: scenario.nodeId,
          perm: scenario.perm,
          forType: scenario.grant.forType,
          forResource: scenario.grant.forResource,
        },
        output: {
          granted: result.granted,
          deniedBy: result.deniedBy,
        },
      }
      traces.push(trace)

      // First iteration is cold (no cache)
      if (i === 0) {
        coldTrace = trace

        // Verify correctness on first iteration
        if (result.granted !== scenario.expectedGranted) {
          error = `Expected granted=${scenario.expectedGranted}, got ${result.granted}`
        }
        if (scenario.expectedDeniedBy && result.deniedBy !== scenario.expectedDeniedBy) {
          error = `Expected deniedBy=${scenario.expectedDeniedBy}, got ${result.deniedBy}`
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
      break
    }
  }

  // All traces (cold + warm)
  const metrics = calculateMetrics(traces)

  // Warm traces only (skip first)
  const warmTraces = traces.slice(1)
  const warmMetrics = warmTraces.length > 0 ? calculateMetrics(warmTraces) : emptyMetrics()

  return {
    scenario,
    traces,
    metrics,
    coldTrace,
    warmMetrics,
    passed: !error,
    passedThresholds: true, // Always pass for now
    error,
  }
}

// =============================================================================
// HELPERS
// =============================================================================

interface ProfileCall {
  method: string
  phase: 'trust' | 'resolve' | 'decide' | 'query'
  startMs: number
  endMs: number
  durationMs: number
  cached?: boolean
  query?: {
    cypher: string
    params: Record<string, unknown>
  }
  metadata?: Record<string, unknown>
}

interface Profile {
  totalMs: number
  resolveGrantMs: number
  authCheckMs: number
  calls: ProfileCall[]
}

function buildSpansFromProfile(profile: Profile | undefined, _baseTime: number): Span[] {
  if (!profile || !profile.calls?.length) return []

  const spans: Span[] = []

  // Find the earliest start time to normalize
  const minStartMs = Math.min(...profile.calls.map((c) => c.startMs))

  // Create span for each call using actual timestamps
  for (let i = 0; i < profile.calls.length; i++) {
    const call = profile.calls[i]!
    // Use phase from call if available, otherwise infer from method name
    const phase = call.phase ?? inferPhase(call.method)

    // Convert to microseconds, normalized to trace start
    const startMicros = (call.startMs - minStartMs) * 1000
    const endMicros = (call.endMs - minStartMs) * 1000
    const durationMicros = call.durationMs * 1000

    spans.push({
      id: `span_${i}`,
      parentId: null,
      name: call.method,
      phase,
      startMicros,
      endMicros,
      durationMicros,
      cached: call.cached ?? false,
      metadata: call.query ? { query: call.query } : call.metadata,
    })
  }

  return spans
}

function inferPhase(method: string): Phase {
  // TRUST phase: JWT verification, principal resolution, security validation
  if (
    method.includes('verify') ||
    method.includes('authenticate') ||
    method === 'resolveIdentity' ||
    method === 'validateGrant'
  ) {
    return 'trust'
  }
  // RESOLVE phase: grant resolution, identity expression evaluation
  if (method === 'resolveGrant' || method === 'evalExpr') {
    return 'resolve'
  }
  // QUERY phase: database operations
  if (method.includes('execute') || method.includes('query') || method.includes('getTarget')) {
    return 'query'
  }
  // DECIDE phase: query generation
  if (method.includes('generate')) {
    return 'decide'
  }
  return 'decide'
}

function calculateStats(values: number[]): Stats {
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

  // Use sample standard deviation (n-1) for better statistical accuracy
  const variance =
    count > 1 ? sorted.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (count - 1) : 0
  const stdDev = Math.sqrt(variance)

  // Correct percentile formula: floor((count - 1) * percentile)
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

function calculateMetrics(traces: Trace[]): TraceMetrics {
  if (traces.length === 0) {
    return emptyMetrics()
  }

  const totalTimes = traces.map((t) => t.totalMicros)
  const overall = calculateStats(totalTimes)

  // Phase breakdown
  const phaseValues: Record<Phase, number[]> = {
    trust: [],
    resolve: [],
    decide: [],
    query: [],
  }

  const methodValues: Record<string, number[]> = {}
  let cacheHits = 0
  let cacheMisses = 0

  for (const trace of traces) {
    for (const span of trace.spans) {
      phaseValues[span.phase].push(span.durationMicros)

      if (!methodValues[span.name]) {
        methodValues[span.name] = []
      }
      methodValues[span.name]!.push(span.durationMicros)

      if (span.cached) {
        cacheHits++
      } else {
        cacheMisses++
      }
    }
  }

  const byPhase: Record<Phase, Stats> = {
    trust: calculateStats(phaseValues.trust),
    resolve: calculateStats(phaseValues.resolve),
    decide: calculateStats(phaseValues.decide),
    query: calculateStats(phaseValues.query),
  }

  const byMethod: Record<string, Stats> = {}
  for (const [method, values] of Object.entries(methodValues)) {
    byMethod[method] = calculateStats(values)
  }

  // Phase distribution
  let grandTotal = 0
  const phaseTotals: Record<Phase, number> = { trust: 0, resolve: 0, decide: 0, query: 0 }
  for (const trace of traces) {
    for (const span of trace.spans) {
      phaseTotals[span.phase] += span.durationMicros
      grandTotal += span.durationMicros
    }
  }

  const phaseDistribution: Record<Phase, number> = {
    trust: grandTotal > 0 ? (phaseTotals.trust / grandTotal) * 100 : 0,
    resolve: grandTotal > 0 ? (phaseTotals.resolve / grandTotal) * 100 : 0,
    decide: grandTotal > 0 ? (phaseTotals.decide / grandTotal) * 100 : 0,
    query: grandTotal > 0 ? (phaseTotals.query / grandTotal) * 100 : 0,
  }

  const cacheTotal = cacheHits + cacheMisses
  const hitRate = cacheTotal > 0 ? (cacheHits / cacheTotal) * 100 : 0

  return {
    overall,
    byPhase,
    byMethod,
    cache: { hits: cacheHits, misses: cacheMisses, hitRate },
    phaseDistribution,
  }
}

// =============================================================================
// GRAPH GENERATION HANDLER
// =============================================================================

export async function handleGenerateGraph(
  scale: Scale,
  seed: number | undefined,
  client: PlaygroundFalkorDBClient,
): Promise<GraphMetadata> {
  if (!client.connected) {
    throw new Error('Not connected to FalkorDB')
  }

  // Generate the scaled graph
  const metadata = await client.seedScaled(scale, {
    seed: seed ?? 42,
    onProgress: (progress) => {
      // Could log progress here if needed
      console.log(`[${scale}] ${progress.phase}: ${progress.percent}%`)
    },
  })

  // Cache the metadata for later use
  cachedMetadata = metadata

  return metadata
}

// =============================================================================
// SCENARIOS HANDLER
// =============================================================================

export async function handleGetScenarios(
  scale: Scale | 'base',
  seed?: number,
): Promise<TestScenario[]> {
  if (scale === 'base') {
    // Return the hardcoded base scenarios
    return AVAILABLE_SCENARIOS
  }

  // For scaled graphs, instantiate scenarios from templates
  if (!cachedMetadata || cachedMetadata.scale !== scale) {
    throw new Error(`No metadata cached for scale "${scale}". Generate the graph first.`)
  }

  return instantiateScenarios(SCENARIO_TEMPLATES, cachedMetadata, seed ?? 42)
}
