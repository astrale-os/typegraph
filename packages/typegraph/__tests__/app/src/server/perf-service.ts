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
  serializeMetadata,
  deserializeMetadata,
} from '../performance'

// =============================================================================
// TYPES
// =============================================================================

interface RunScenarioRequest {
  scenario: TestScenario
  iterations: number
  scale: Scale | 'base'
}

// Graph names for each scale
const GRAPH_NAMES: Record<Scale | 'base', string> = {
  base: 'authz',
  small: 'authz-perf-small',
  medium: 'authz-perf-medium',
  large: 'authz-perf-large',
}

// =============================================================================
// CACHED METADATA (with filesystem persistence)
// =============================================================================

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const CACHE_DIR = join(process.cwd(), '.cache')
const getMetadataPath = (scale: Scale) => join(CACHE_DIR, `metadata-${scale}.json`)

// In-memory cache
export let cachedMetadata: GraphMetadata | null = null

// Load cached metadata from disk on startup
function loadCachedMetadata(scale: Scale): GraphMetadata | null {
  try {
    const path = getMetadataPath(scale)
    if (existsSync(path)) {
      const data = readFileSync(path, 'utf-8')
      return deserializeMetadata(JSON.parse(data))
    }
  } catch (e) {
    console.warn(`Failed to load cached metadata for ${scale}:`, e)
  }
  return null
}

// Save metadata to disk
function saveCachedMetadata(metadata: GraphMetadata): void {
  try {
    if (!existsSync(CACHE_DIR)) {
      mkdirSync(CACHE_DIR, { recursive: true })
    }
    const path = getMetadataPath(metadata.scale)
    writeFileSync(path, JSON.stringify(serializeMetadata(metadata), null, 2))
  } catch (e) {
    console.warn(`Failed to save cached metadata for ${metadata.scale}:`, e)
  }
}

// Get metadata for a scale (from memory or disk)
export function getMetadataForScale(scale: Scale): GraphMetadata | null {
  if (cachedMetadata?.scale === scale) {
    return cachedMetadata
  }
  const loaded = loadCachedMetadata(scale)
  if (loaded) {
    cachedMetadata = loaded
  }
  return loaded
}

// =============================================================================
// HANDLERS
// =============================================================================

export async function handleRunScenario(
  body: Record<string, unknown>,
  client: PlaygroundFalkorDBClient,
): Promise<ScenarioResult> {
  const { scenario, iterations, scale = 'base' } = body as unknown as RunScenarioRequest

  if (!scenario || !iterations) {
    throw new Error('scenario and iterations are required')
  }

  if (!client.connected) {
    throw new Error('Not connected to FalkorDB')
  }

  // Select the appropriate graph for this scale
  let targetGraph: string
  if (scale === 'base') {
    targetGraph = GRAPH_NAMES.base
  } else {
    // For scaled graphs, use the metadata's actual graph name (which may include timestamp)
    const metadata = getMetadataForScale(scale)
    if (!metadata) {
      throw new Error(`No metadata cached for scale "${scale}". Generate the graph first.`)
    }
    targetGraph = metadata.graphName
  }
  if (client.graphName !== targetGraph) {
    await client.selectGraph(targetGraph)
  }

  // For base scale, ensure the graph is seeded
  if (scale === 'base') {
    const hasData = await client.hasData()
    if (!hasData) {
      console.log('[perf] Base graph empty, seeding...')
      await client.seed()
    }
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

  // Cache the metadata (memory + disk)
  cachedMetadata = metadata
  saveCachedMetadata(metadata)

  return metadata
}

// =============================================================================
// SCENARIOS HANDLER
// =============================================================================

// =============================================================================
// SCALE STATUS
// =============================================================================

export interface ScaleStatus {
  scale: Scale | 'base'
  exists: boolean
  graphName: string | null
  stats: { nodes: number; edges: number } | null
}

export async function getScaleStatus(
  client: PlaygroundFalkorDBClient,
): Promise<{ scales: ScaleStatus[]; connected: boolean }> {
  if (!client.connected) {
    return {
      connected: false,
      scales: [
        { scale: 'base', exists: false, graphName: null, stats: null },
        { scale: 'small', exists: false, graphName: null, stats: null },
        { scale: 'medium', exists: false, graphName: null, stats: null },
        { scale: 'large', exists: false, graphName: null, stats: null },
      ],
    }
  }

  const scales: ScaleStatus[] = []

  // Check base graph
  try {
    await client.selectGraph('authz')
    const hasData = await client.hasData()
    scales.push({
      scale: 'base',
      exists: hasData,
      graphName: 'authz',
      stats: hasData ? { nodes: 23, edges: 44 } : null,
    })
  } catch {
    scales.push({ scale: 'base', exists: false, graphName: null, stats: null })
  }

  // Check scaled graphs
  for (const scale of ['small', 'medium', 'large'] as Scale[]) {
    const metadata = getMetadataForScale(scale)
    if (metadata) {
      // Verify the graph actually exists in FalkorDB
      try {
        await client.selectGraph(metadata.graphName)
        const result = await client.query('MATCH (n) RETURN count(n) as cnt LIMIT 1')
        const count = result[0]?.cnt ?? 0
        if (count > 0) {
          scales.push({
            scale,
            exists: true,
            graphName: metadata.graphName,
            stats: { nodes: metadata.stats.totalNodes, edges: metadata.stats.totalEdges },
          })
        } else {
          scales.push({ scale, exists: false, graphName: null, stats: null })
        }
      } catch {
        // Graph doesn't exist
        scales.push({ scale, exists: false, graphName: null, stats: null })
      }
    } else {
      scales.push({ scale, exists: false, graphName: null, stats: null })
    }
  }

  return { connected: true, scales }
}

// =============================================================================
// CLEANUP
// =============================================================================

export async function cleanupScaleGraphs(
  client: PlaygroundFalkorDBClient,
  scale?: Scale,
): Promise<{ ok: boolean; cleaned: string[]; errors: string[] }> {
  const cleaned: string[] = []
  const errors: string[] = []

  if (!client.connected) {
    return { ok: false, cleaned, errors: ['Not connected to FalkorDB'] }
  }

  const scalesToClean: Scale[] = scale ? [scale] : ['small', 'medium', 'large']

  for (const s of scalesToClean) {
    // Get metadata to find the actual graph name
    const metadata = getMetadataForScale(s)
    if (metadata) {
      try {
        // Delete the graph using FalkorDB's GRAPH.DELETE
        await client.deleteGraph(metadata.graphName)
        cleaned.push(metadata.graphName)
      } catch (e) {
        errors.push(`${s}: ${e instanceof Error ? e.message : 'failed'}`)
      }
    }

    // Also clean up the metadata file
    try {
      const path = getMetadataPath(s)
      if (existsSync(path)) {
        const { unlinkSync } = await import('node:fs')
        unlinkSync(path)
      }
    } catch {
      // Ignore metadata cleanup errors
    }

    // Clear in-memory cache if it matches
    if (cachedMetadata?.scale === s) {
      cachedMetadata = null
    }
  }

  // Switch back to base graph
  try {
    await client.selectGraph('authz')
  } catch {
    // Ignore
  }

  return { ok: errors.length === 0, cleaned, errors }
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
  const metadata = getMetadataForScale(scale)
  if (!metadata) {
    throw new Error(`No metadata cached for scale "${scale}". Generate the graph first.`)
  }

  return instantiateScenarios(SCENARIO_TEMPLATES, metadata, seed ?? 42)
}
