/**
 * Latency Profiling Store
 *
 * Zustand store for managing latency profiling state in the UI.
 */

import { create } from 'zustand'
import type {
  ProfilerState,
  ProfilerTab,
  ScenarioResult,
  TraceMetrics,
  Trace,
  TestScenario,
  Stats,
} from '@/types/profiling'
import { emptyMetrics } from '@/types/profiling'
import type { Scale, GraphMetadata } from '@/performance'
import {
  getScaleInfo,
  deserializeMetadata,
  BASE_SCALE_INFO,
  AVAILABLE_SCENARIOS,
} from '@/performance'

// =============================================================================
// SCALE TYPES
// =============================================================================

export type SelectedScale = Scale | 'base'

export interface ScaleStatusInfo {
  scale: SelectedScale
  exists: boolean
  graphName: string | null
  stats: { nodes: number; edges: number } | null
}

// =============================================================================
// STORE INTERFACE
// =============================================================================

interface LatencyStore extends ProfilerState {
  // Scale management
  selectedScale: SelectedScale
  scaleMetadata: GraphMetadata | null
  scaledScenarios: TestScenario[]
  generatingGraph: boolean
  generationProgress: number
  generationPhase: string

  // Scale status (which graphs exist in FalkorDB)
  scaleStatus: Record<SelectedScale, ScaleStatusInfo>
  statusLoading: boolean
  statusError: string | null

  // Actions
  setSelectedScenarios: (ids: string[]) => void
  toggleScenario: (id: string) => void
  selectAllScenarios: () => void
  clearScenarios: () => void
  setIterations: (n: number) => void
  setActiveTab: (tab: ProfilerTab) => void
  setSelectedResult: (result: ScenarioResult | null) => void
  setSelectedTrace: (trace: Trace | null) => void

  // Scale actions
  setSelectedScale: (scale: SelectedScale) => void
  generateGraph: (scale: Scale) => Promise<void>
  loadScaleStatus: () => Promise<void>
  cleanupScale: (scale?: Scale) => Promise<void>

  // Running
  startRun: () => void
  updateProgress: (progress: number, message: string) => void
  completeRun: (results: ScenarioResult[], metrics: TraceMetrics) => void
  failRun: (error: string) => void
  reset: () => void

  // Run scenarios (mock implementation for UI)
  runScenarios: () => Promise<void>
}

// =============================================================================
// INITIAL STATE
// =============================================================================

interface InitialState extends ProfilerState {
  selectedScale: SelectedScale
  scaleMetadata: GraphMetadata | null
  scaledScenarios: TestScenario[]
  generatingGraph: boolean
  generationProgress: number
  generationPhase: string
  scaleStatus: Record<SelectedScale, ScaleStatusInfo>
  statusLoading: boolean
  statusError: string | null
}

const defaultScaleStatus: Record<SelectedScale, ScaleStatusInfo> = {
  base: { scale: 'base', exists: false, graphName: null, stats: null },
  small: { scale: 'small', exists: false, graphName: null, stats: null },
  medium: { scale: 'medium', exists: false, graphName: null, stats: null },
  large: { scale: 'large', exists: false, graphName: null, stats: null },
}

const initialState: InitialState = {
  selectedScenarios: ['hierarchical-read-root', 'direct-permission'],
  iterations: 10,
  running: false,
  progress: 0,
  statusMessage: '',
  results: [],
  aggregateMetrics: null,
  activeTab: 'timeline',
  selectedResult: null,
  selectedTrace: null,
  error: null,
  // Scale state
  selectedScale: 'base',
  scaleMetadata: null,
  scaledScenarios: [],
  generatingGraph: false,
  generationProgress: 0,
  generationPhase: '',
  scaleStatus: { ...defaultScaleStatus },
  statusLoading: false,
  statusError: null,
}

// =============================================================================
// STORE IMPLEMENTATION
// =============================================================================

export const useLatencyStore = create<LatencyStore>((set, get) => ({
  ...initialState,

  setSelectedScenarios: (ids) => set({ selectedScenarios: ids }),

  toggleScenario: (id) =>
    set((state) => ({
      selectedScenarios: state.selectedScenarios.includes(id)
        ? state.selectedScenarios.filter((s) => s !== id)
        : [...state.selectedScenarios, id],
    })),

  selectAllScenarios: () => {
    const state = get()
    const scenarios = state.selectedScale === 'base' ? AVAILABLE_SCENARIOS : state.scaledScenarios
    set({ selectedScenarios: scenarios.map((s) => s.id) })
  },

  clearScenarios: () => set({ selectedScenarios: [] }),

  setIterations: (n) => set({ iterations: Math.max(1, Math.min(100, n)) }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setSelectedResult: (result) => set({ selectedResult: result }),

  setSelectedTrace: (trace) => set({ selectedTrace: trace }),

  // Scale management
  setSelectedScale: (scale) => {
    const currentScale = get().selectedScale
    if (scale === currentScale) return

    // Clear scenarios when changing scale
    set({
      selectedScale: scale,
      selectedScenarios: [],
      results: [],
      aggregateMetrics: null,
      error: null,
    })

    // If switching to base, clear scaled state
    if (scale === 'base') {
      set({
        scaleMetadata: null,
        scaledScenarios: [],
      })
    }
  },

  loadScaleStatus: async () => {
    set({ statusLoading: true, statusError: null })
    try {
      const response = await fetch('/api/perf/scale-status')
      if (!response.ok) {
        throw new Error('Failed to fetch scale status')
      }
      const { scales, connected } = await response.json()
      if (!connected) {
        set({ statusLoading: false, statusError: 'Not connected to FalkorDB' })
        return
      }

      const newStatus: Record<SelectedScale, ScaleStatusInfo> = { ...defaultScaleStatus }
      for (const s of scales) {
        newStatus[s.scale as SelectedScale] = {
          scale: s.scale,
          exists: s.exists,
          graphName: s.graphName,
          stats: s.stats,
        }
      }
      set({ scaleStatus: newStatus, statusLoading: false })

      // If current scale has a graph, load its scenarios
      const state = get()
      if (state.selectedScale !== 'base' && newStatus[state.selectedScale]?.exists) {
        const scenariosResponse = await fetch('/api/perf/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scale: state.selectedScale }),
        })
        if (scenariosResponse.ok) {
          const { scenarios } = await scenariosResponse.json()
          set({ scaledScenarios: scenarios })
        }
      }
    } catch (err) {
      set({
        statusLoading: false,
        statusError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  cleanupScale: async (scale) => {
    set({ statusLoading: true, statusError: null })
    try {
      const response = await fetch('/api/perf/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale }),
      })
      if (!response.ok) {
        throw new Error('Failed to cleanup scale')
      }

      // Reload status after cleanup
      await get().loadScaleStatus()
    } catch (err) {
      set({
        statusLoading: false,
        statusError: err instanceof Error ? err.message : String(err),
      })
    }
  },

  generateGraph: async (scale) => {
    if (get().generatingGraph) return

    set({
      generatingGraph: true,
      generationProgress: 0,
      generationPhase: 'Starting...',
      error: null,
    })

    // Create abort controller for timeout
    const controller = new AbortController()
    const timeoutMs = scale === 'large' ? 600000 : scale === 'medium' ? 300000 : 60000
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

    try {
      // Call API to generate graph
      const response = await fetch('/api/perf/generate-graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale }),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || `Failed to generate graph: ${response.statusText}`)
      }

      const { metadata } = await response.json()
      const parsedMetadata = deserializeMetadata(metadata)

      // Fetch scenarios for this scale
      const scenariosResponse = await fetch('/api/perf/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scale }),
      })

      if (!scenariosResponse.ok) {
        throw new Error('Failed to fetch scenarios for scale')
      }

      const { scenarios } = await scenariosResponse.json()

      set({
        generatingGraph: false,
        generationProgress: 100,
        generationPhase: 'Complete',
        scaleMetadata: parsedMetadata,
        scaledScenarios: scenarios,
        selectedScale: scale,
        // Select first two scenarios by default
        selectedScenarios: scenarios.slice(0, 2).map((s: TestScenario) => s.id),
      })

      // Reload status to reflect the new graph
      await get().loadScaleStatus()
    } catch (err) {
      clearTimeout(timeoutId)
      const message =
        err instanceof Error
          ? err.name === 'AbortError'
            ? `Generation timed out after ${timeoutMs / 1000}s. Try a smaller scale or check server logs.`
            : err.message
          : String(err)
      set({
        generatingGraph: false,
        generationProgress: 0,
        generationPhase: 'Failed',
        error: message,
      })
    }
  },

  startRun: () =>
    set({
      running: true,
      progress: 0,
      statusMessage: 'Starting...',
      error: null,
      results: [],
      aggregateMetrics: null,
    }),

  updateProgress: (progress, message) => set({ progress, statusMessage: message }),

  completeRun: (results, metrics) =>
    set({
      running: false,
      progress: 100,
      statusMessage: 'Complete',
      results,
      aggregateMetrics: metrics,
      selectedResult: results[0] ?? null,
    }),

  failRun: (error) =>
    set({
      running: false,
      progress: 0,
      statusMessage: 'Failed',
      error,
    }),

  reset: () => set(initialState),

  runScenarios: async () => {
    const state = get()
    if (state.running || state.selectedScenarios.length === 0) return

    get().startRun()

    try {
      const availableScenarios =
        state.selectedScale === 'base' ? AVAILABLE_SCENARIOS : state.scaledScenarios
      const scenarios = availableScenarios.filter((s) => state.selectedScenarios.includes(s.id))

      const results: ScenarioResult[] = []

      for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i]!
        get().updateProgress(
          Math.round(((i + 0.5) / scenarios.length) * 100),
          `Running ${scenario.name}...`,
        )

        // Call API to run scenario (include scale for graph selection)
        const response = await fetch('/api/perf/run-scenario', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scenario,
            iterations: state.iterations,
            scale: state.selectedScale,
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to run ${scenario.name}: ${response.statusText}`)
        }

        const result = (await response.json()) as ScenarioResult
        results.push(result)
      }

      // Calculate aggregate metrics
      const allTraces = results.flatMap((r) => r.traces)
      const aggregateMetrics = calculateMetrics(allTraces)

      get().completeRun(results, aggregateMetrics)
    } catch (err) {
      get().failRun(err instanceof Error ? err.message : String(err))
    }
  },
}))

// =============================================================================
// METRICS CALCULATION (simplified for UI)
// =============================================================================

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
  const phaseValues: Record<string, number[]> = {
    trust: [],
    decode: [],
    resolve: [],
    decide: [],
    query: [],
  }

  const methodValues: Record<string, number[]> = {}
  let cacheHits = 0
  let cacheMisses = 0

  for (const trace of traces) {
    for (const span of trace.spans) {
      phaseValues[span.phase]?.push(span.durationMicros)

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

  const byPhase: Record<string, Stats> = {}
  for (const [phase, values] of Object.entries(phaseValues)) {
    byPhase[phase] = calculateStats(values)
  }

  const byMethod: Record<string, Stats> = {}
  for (const [method, values] of Object.entries(methodValues)) {
    byMethod[method] = calculateStats(values)
  }

  // Phase distribution
  let grandTotal = 0
  const phaseTotals: Record<string, number> = {
    trust: 0,
    decode: 0,
    resolve: 0,
    decide: 0,
    query: 0,
  }
  for (const trace of traces) {
    for (const span of trace.spans) {
      phaseTotals[span.phase] = (phaseTotals[span.phase] ?? 0) + span.durationMicros
      grandTotal += span.durationMicros
    }
  }

  const phaseDistribution: Record<string, number> = {}
  for (const [phase, total] of Object.entries(phaseTotals)) {
    phaseDistribution[phase] = grandTotal > 0 ? (total / grandTotal) * 100 : 0
  }

  const cacheTotal = cacheHits + cacheMisses
  const hitRate = cacheTotal > 0 ? (cacheHits / cacheTotal) * 100 : 0

  return {
    overall,
    byPhase: byPhase as TraceMetrics['byPhase'],
    byMethod,
    cache: { hits: cacheHits, misses: cacheMisses, hitRate },
    phaseDistribution: phaseDistribution as TraceMetrics['phaseDistribution'],
  }
}

// =============================================================================
// SELECTORS
// =============================================================================

export const selectAvailableScenarios = (state: LatencyStore): TestScenario[] =>
  state.selectedScale === 'base' ? AVAILABLE_SCENARIOS : state.scaledScenarios

export const selectSelectedScenarioObjects = (state: LatencyStore): TestScenario[] => {
  const available = state.selectedScale === 'base' ? AVAILABLE_SCENARIOS : state.scaledScenarios
  return available.filter((s) => state.selectedScenarios.includes(s.id))
}

export const selectIsGraphGenerated = (state: LatencyStore): boolean => {
  if (state.selectedScale === 'base') return state.scaleStatus.base.exists
  return state.scaleStatus[state.selectedScale]?.exists ?? false
}

export const selectScaleInfo = (state: LatencyStore): { nodes: string; edges: string } | null => {
  if (state.selectedScale === 'base') {
    return BASE_SCALE_INFO
  }
  return getScaleInfo(state.selectedScale)
}

export { getScaleInfo, AVAILABLE_SCENARIOS }
