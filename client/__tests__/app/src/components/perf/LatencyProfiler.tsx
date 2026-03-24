/**
 * Latency Profiler
 *
 * Main panel for running latency profiling scenarios and viewing results.
 */

import {
  Timer,
  Play,
  Square,
  Download,
  RefreshCw,
  Zap,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react'
import { useState, useEffect } from 'react'

import {
  useLatencyStore,
  selectIsGraphGenerated,
  selectScaleInfo,
  selectAvailableScenarios,
  type SelectedScale,
} from '@/store/latency-store'
import { formatMicros } from '@/types/profiling'

import { PhaseBreakdown } from './PhaseBreakdown'
import { QueryBuilder } from './QueryBuilder'
import { QueryDrilldown } from './QueryDrilldown'
import { ScenarioComparison } from './ScenarioComparison'
import { TimelineChart } from './TimelineChart'
import { WaterfallChart } from './WaterfallChart'

const TABS = [
  { id: 'timeline', label: 'Timeline' },
  { id: 'waterfall', label: 'Waterfall' },
  { id: 'breakdown', label: 'Breakdown' },
  { id: 'comparison', label: 'Comparison' },
  { id: 'queries', label: 'Queries' },
] as const

const SCALE_OPTIONS: { value: SelectedScale; label: string; description: string }[] = [
  { value: 'base', label: 'Base', description: '~23 nodes' },
  { value: 'small', label: 'Small', description: '~10K nodes' },
  { value: 'medium', label: 'Medium', description: '~40K nodes' },
  { value: 'large', label: 'Large', description: '~100K nodes' },
]

export function LatencyProfiler() {
  const {
    selectedScenarios,
    iterations,
    running,
    progress,
    statusMessage,
    results,
    aggregateMetrics,
    activeTab,
    error,
    selectedScale,
    generatingGraph,
    _generationProgress,
    _generationPhase,
    scaleMetadata,
    scaleStatus,
    statusLoading,
    statusError,
    toggleScenario,
    selectAllScenarios,
    clearScenarios,
    setIterations,
    setActiveTab,
    runScenarios,
    reset,
    setSelectedScale,
    generateGraph,
    loadScaleStatus,
    cleanupScale,
  } = useLatencyStore()

  const isGraphGenerated = useLatencyStore(selectIsGraphGenerated)
  const _scaleInfo = useLatencyStore(selectScaleInfo)
  const availableScenarios = useLatencyStore(selectAvailableScenarios)

  const [showScenarios, setShowScenarios] = useState(true)
  const [showCypher, setShowCypher] = useState(false)

  // Load scale status on mount
  useEffect(() => {
    loadScaleStatus()
  }, [])

  const handleExportJson = () => {
    if (!results.length) return
    const report = {
      metadata: {
        generatedAt: new Date().toISOString(),
        totalScenarios: results.length,
        passedScenarios: results.filter((r) => r.passed).length,
        scale: selectedScale,
        graphStats: scaleMetadata?.stats,
      },
      scenarios: results,
      aggregateMetrics,
    }
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `latency-report-${selectedScale}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleScaleChange = (scale: SelectedScale) => {
    setSelectedScale(scale)
  }

  const handleGenerateGraph = async () => {
    if (selectedScale !== 'base') {
      await generateGraph(selectedScale)
    }
  }

  const needsGeneration = selectedScale !== 'base' && !isGraphGenerated

  return (
    <div className="p-3 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
          <Timer className="w-3.5 h-3.5" />
          Latency Profiler
        </div>
        {results.length > 0 && (
          <div className="flex gap-1">
            <button
              onClick={handleExportJson}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded"
              title="Export JSON"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={reset}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded"
              title="Reset"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Scale Status Overview */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[10px] text-slate-500">Graph Status</div>
          <button
            onClick={() => loadScaleStatus()}
            disabled={statusLoading}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-700 rounded"
            title="Refresh status"
          >
            {statusLoading ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <RefreshCw className="w-3 h-3" />
            )}
          </button>
        </div>

        {statusError && (
          <div className="text-[10px] text-red-400 bg-red-900/30 rounded p-1.5">{statusError}</div>
        )}

        <div className="grid grid-cols-4 gap-1">
          {SCALE_OPTIONS.map((opt) => {
            const status = scaleStatus[opt.value]
            const isSelected = selectedScale === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => handleScaleChange(opt.value)}
                disabled={running || generatingGraph}
                className={`flex flex-col items-center p-1.5 rounded text-[10px] border transition-colors ${
                  isSelected
                    ? 'bg-purple-900/50 border-purple-500 text-purple-200'
                    : 'bg-slate-800 border-slate-700 hover:border-slate-500 text-slate-400'
                } ${running || generatingGraph ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <div className="flex items-center gap-1">
                  <span className="font-medium">{opt.label}</span>
                  {status?.exists ? (
                    <CheckCircle className="w-2.5 h-2.5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-2.5 h-2.5 text-slate-600" />
                  )}
                </div>
                <span className="text-[8px] text-slate-500">{opt.description}</span>
              </button>
            )
          })}
        </div>

        {/* Current Scale Info */}
        {scaleStatus[selectedScale]?.exists && (
          <div className="bg-slate-800 rounded p-2 text-[10px]">
            <div className="flex items-center justify-between mb-1">
              <div className="text-slate-400">
                {scaleStatus[selectedScale]?.graphName || 'Graph Ready'}
              </div>
              {selectedScale !== 'base' && (
                <button
                  onClick={() => cleanupScale(selectedScale as Exclude<SelectedScale, 'base'>)}
                  disabled={running || generatingGraph || statusLoading}
                  className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-900/20 rounded"
                  title="Delete this graph"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
            {scaleStatus[selectedScale]?.stats && (
              <div className="grid grid-cols-2 gap-2 text-slate-500">
                <div>
                  <span className="text-slate-300">
                    {scaleStatus[selectedScale].stats!.nodes.toLocaleString()}
                  </span>{' '}
                  nodes
                </div>
                <div>
                  <span className="text-slate-300">
                    {scaleStatus[selectedScale].stats!.edges.toLocaleString()}
                  </span>{' '}
                  edges
                </div>
              </div>
            )}
          </div>
        )}

        {/* Generate Graph Button */}
        {needsGeneration && (
          <button
            onClick={handleGenerateGraph}
            disabled={generatingGraph}
            className="flex items-center justify-center gap-1.5 w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[10px] px-3 py-2 rounded"
          >
            {generatingGraph ? (
              <>
                <Loader2 className="w-3 h-3 animate-spin" />
                Generating {selectedScale} graph...
              </>
            ) : (
              <>
                <Zap className="w-3 h-3" />
                Generate {selectedScale.charAt(0).toUpperCase() + selectedScale.slice(1)} Graph
              </>
            )}
          </button>
        )}

        {/* Generation Info */}
        {generatingGraph && (
          <div className="text-[10px] text-slate-500 text-center">
            This may take a while for larger graphs. Check console for progress.
          </div>
        )}
      </div>

      {/* Scenario Selection */}
      {(selectedScale === 'base' || isGraphGenerated) && (
        <div className="space-y-2">
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setShowScenarios(!showScenarios)}
          >
            <div className="text-[10px] text-slate-500">
              Scenarios ({selectedScenarios.length}/{availableScenarios.length})
            </div>
            <div className="text-[10px] text-slate-600">{showScenarios ? '▼' : '▶'}</div>
          </div>

          {showScenarios && (
            <div className="space-y-1.5">
              <div className="flex gap-2 text-[10px]">
                <button
                  onClick={selectAllScenarios}
                  className="text-slate-400 hover:text-slate-200"
                >
                  Select All
                </button>
                <button onClick={clearScenarios} className="text-slate-400 hover:text-slate-200">
                  Clear
                </button>
              </div>
              <div className="max-h-40 overflow-y-auto space-y-1 bg-slate-800 rounded p-2">
                {availableScenarios.map((s) => (
                  <label
                    key={s.id}
                    className="flex items-start gap-2 text-[10px] cursor-pointer hover:bg-slate-700 p-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedScenarios.includes(s.id)}
                      onChange={() => toggleScenario(s.id)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-slate-200">{s.name}</div>
                      <div className="text-slate-500">{s.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Iterations */}
      {(selectedScale === 'base' || isGraphGenerated) && (
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-slate-500">Iterations:</label>
          <input
            type="number"
            value={iterations}
            onChange={(e) => setIterations(parseInt(e.target.value) || 10)}
            min={1}
            max={100}
            className="w-16 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-[10px] text-slate-200"
          />
        </div>
      )}

      {/* Run Button */}
      {(selectedScale === 'base' || isGraphGenerated) && (
        <button
          onClick={runScenarios}
          disabled={running || selectedScenarios.length === 0}
          className="flex items-center justify-center gap-1.5 w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-[10px] px-3 py-2 rounded"
        >
          {running ? (
            <>
              <Square className="w-3 h-3" />
              Running... {progress}%
            </>
          ) : (
            <>
              <Play className="w-3 h-3" />
              Run Selected ({selectedScenarios.length})
            </>
          )}
        </button>
      )}

      {/* Cypher Query Builder - Always visible when graph exists */}
      {isGraphGenerated && (
        <div className="space-y-2">
          <div
            className="flex items-center justify-between cursor-pointer"
            onClick={() => setShowCypher(!showCypher)}
          >
            <div className="text-[10px] text-slate-500 flex items-center gap-1">
              <span>Cypher Query</span>
            </div>
            <div className="text-[10px] text-slate-600">{showCypher ? '▼' : '▶'}</div>
          </div>

          {showCypher && (
            <div className="bg-slate-800 rounded p-2">
              <QueryBuilder
                scale={selectedScale}
                graphName={scaleStatus[selectedScale]?.graphName || null}
              />
            </div>
          )}
        </div>
      )}

      {/* Progress */}
      {running && (
        <div className="space-y-1">
          <div className="h-1 bg-slate-700 rounded overflow-hidden">
            <div
              className="h-full bg-purple-500 transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-[10px] text-slate-500">{statusMessage}</div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded p-2 text-[10px] text-red-400">
          {error}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && aggregateMetrics && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-800 rounded p-2 text-center">
              <div className="text-[10px] text-slate-500">Mean</div>
              <div className="text-sm font-medium text-slate-200">
                {formatMicros(aggregateMetrics.overall.mean)}
              </div>
            </div>
            <div className="bg-slate-800 rounded p-2 text-center">
              <div className="text-[10px] text-slate-500">P95</div>
              <div className="text-sm font-medium text-amber-400">
                {formatMicros(aggregateMetrics.overall.p95)}
              </div>
            </div>
            <div className="bg-slate-800 rounded p-2 text-center">
              <div className="text-[10px] text-slate-500">Cache Hit</div>
              <div className="text-sm font-medium text-emerald-400">
                {aggregateMetrics.cache.hitRate.toFixed(0)}%
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-700 pb-1">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`text-[10px] px-2 py-1 rounded-t ${
                  activeTab === tab.id
                    ? 'bg-slate-700 text-slate-200'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="bg-slate-800 rounded p-2 min-h-[200px]">
            {activeTab === 'timeline' && <TimelineChart results={results} />}
            {activeTab === 'waterfall' && <WaterfallChart results={results} />}
            {activeTab === 'breakdown' && <PhaseBreakdown metrics={aggregateMetrics} />}
            {activeTab === 'comparison' && <ScenarioComparison results={results} />}
            {activeTab === 'queries' && <QueryDrilldown results={results} />}
          </div>
        </div>
      )}
    </div>
  )
}
