/**
 * Timeline Chart
 *
 * Horizontal bar visualization showing span timing, color-coded by phase.
 */

import { useMemo, useState } from 'react'
import type { ScenarioResult, Span, Phase } from '@/types/profiling'
import { formatMicros, getPhaseColor } from '@/types/profiling'

interface TimelineChartProps {
  results: ScenarioResult[]
}

export function TimelineChart({ results }: TimelineChartProps) {
  const [selectedScenario, setSelectedScenario] = useState<string>(results[0]?.scenario.id ?? '')

  const selectedResult = results.find((r) => r.scenario.id === selectedScenario)
  const trace = selectedResult?.traces[0]

  const spans = useMemo(() => {
    if (!trace) return []
    return trace.spans.sort((a, b) => a.startMicros - b.startMicros)
  }, [trace])

  const { minStart, totalDuration } = useMemo(() => {
    if (!spans.length) return { minStart: 0, totalDuration: 1 }
    const minStart = Math.min(...spans.map((s) => s.startMicros))
    const maxEnd = Math.max(...spans.map((s) => s.endMicros))
    return { minStart, totalDuration: maxEnd - minStart || 1 }
  }, [spans])

  return (
    <div className="space-y-3">
      {/* Scenario selector */}
      <div className="flex items-center gap-2">
        <label className="text-[10px] text-slate-500">Scenario:</label>
        <select
          value={selectedScenario}
          onChange={(e) => setSelectedScenario(e.target.value)}
          className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-[10px] text-slate-200"
        >
          {results.map((r) => (
            <option key={r.scenario.id} value={r.scenario.id}>
              {r.scenario.name} ({formatMicros(r.metrics.overall.mean)})
            </option>
          ))}
        </select>
      </div>

      {/* Legend */}
      <div className="flex gap-3 text-[9px]">
        <LegendItem phase="trust" label="Trust" />
        <LegendItem phase="resolve" label="Resolve" />
        <LegendItem phase="decide" label="Decide" />
        <LegendItem phase="query" label="Query" />
      </div>

      {/* Timeline */}
      {trace && (
        <div className="space-y-2">
          <div className="text-[10px] text-slate-400">
            Total: {formatMicros(trace.totalMicros)} • {spans.length} spans
          </div>

          <div className="space-y-1">
            {spans.map((span) => (
              <TimelineBar
                key={span.id}
                span={span}
                minStart={minStart}
                totalDuration={totalDuration}
              />
            ))}
          </div>
        </div>
      )}

      {!trace && (
        <div className="text-[10px] text-slate-500 text-center py-4">No trace data available</div>
      )}
    </div>
  )
}

function LegendItem({ phase, label }: { phase: Phase; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: getPhaseColor(phase) }} />
      <span className="text-slate-400">{label}</span>
    </div>
  )
}

interface TimelineBarProps {
  span: Span
  minStart: number
  totalDuration: number
}

function TimelineBar({ span, minStart, totalDuration }: TimelineBarProps) {
  const left = ((span.startMicros - minStart) / totalDuration) * 100
  // Minimum 2% width so small spans are visible
  const width = Math.max((span.durationMicros / totalDuration) * 100, 2)

  return (
    <div className="group relative">
      <div className="flex items-center gap-2">
        {/* Label */}
        <div className="w-24 text-[9px] text-slate-400 truncate" title={span.name}>
          {span.name}
        </div>

        {/* Bar container */}
        <div className="flex-1 h-4 bg-slate-700 rounded relative overflow-hidden">
          {/* Bar */}
          <div
            className="absolute h-full rounded transition-opacity group-hover:opacity-80"
            style={{
              left: `${left}%`,
              width: `${width}%`,
              backgroundColor: getPhaseColor(span.phase),
            }}
          />
        </div>

        {/* Duration */}
        <div className="w-16 text-[9px] text-slate-500 text-right">
          {formatMicros(span.durationMicros)}
          {span.cached && <span className="ml-1 text-emerald-500">⚡</span>}
        </div>
      </div>

      {/* Tooltip on hover */}
      <div className="hidden group-hover:block absolute left-28 top-full z-10 bg-slate-900 border border-slate-600 rounded p-2 text-[9px] shadow-lg min-w-[200px]">
        <div className="text-slate-200 font-medium">{span.name}</div>
        <div className="text-slate-400 mt-1 space-y-0.5">
          <div>Phase: {span.phase}</div>
          <div>Duration: {formatMicros(span.durationMicros)}</div>
          <div>Start: {formatMicros(span.startMicros - minStart)}</div>
          {span.cached && <div className="text-emerald-400">Cache hit</div>}
          {span.metadata?.query && (
            <div className="mt-1 text-slate-500 truncate max-w-[300px]">
              Query: {span.metadata.query.cypher.substring(0, 50)}...
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
