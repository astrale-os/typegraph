/**
 * Waterfall Chart
 *
 * Shows parallel operations visualization - useful for seeing
 * which operations overlap and where parallelism is being used.
 */

import { useMemo, useState } from 'react'

import type { ScenarioResult, Span, Phase } from '@/types/profiling'

import { formatMicros, getPhaseColor } from '@/types/profiling'

interface WaterfallChartProps {
  results: ScenarioResult[]
}

interface Lane {
  spans: Span[]
}

export function WaterfallChart({ results }: WaterfallChartProps) {
  const [selectedScenario, setSelectedScenario] = useState<string>(results[0]?.scenario.id ?? '')

  const selectedResult = results.find((r) => r.scenario.id === selectedScenario)
  const trace = selectedResult?.traces[0]

  // Organize spans into lanes based on overlap
  const { lanes, minStart, totalDuration } = useMemo(() => {
    if (!trace?.spans.length) {
      return { lanes: [], minStart: 0, totalDuration: 1 }
    }

    const spans = [...trace.spans].sort((a, b) => a.startMicros - b.startMicros)
    const minStart = Math.min(...spans.map((s) => s.startMicros))
    const maxEnd = Math.max(...spans.map((s) => s.endMicros))
    const totalDuration = maxEnd - minStart || 1

    // Greedy lane assignment
    const lanes: Lane[] = []

    for (const span of spans) {
      // Find first lane where span doesn't overlap
      let placed = false
      for (const lane of lanes) {
        const lastSpan = lane.spans[lane.spans.length - 1]
        if (lastSpan && span.startMicros >= lastSpan.endMicros) {
          lane.spans.push(span)
          placed = true
          break
        }
      }
      if (!placed) {
        lanes.push({ spans: [span] })
      }
    }

    return { lanes, minStart, totalDuration }
  }, [trace])

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
              {r.scenario.name}
            </option>
          ))}
        </select>
      </div>

      {/* Stats */}
      {trace && (
        <div className="flex gap-4 text-[9px] text-slate-400">
          <span>Total: {formatMicros(trace.totalMicros)}</span>
          <span>Parallel lanes: {lanes.length}</span>
          <span>Spans: {trace.spans.length}</span>
        </div>
      )}

      {/* Waterfall */}
      {lanes.length > 0 && (
        <div className="relative">
          {/* Time axis */}
          <div className="flex justify-between text-[8px] text-slate-500 mb-1">
            <span>0</span>
            <span>{formatMicros(totalDuration / 4)}</span>
            <span>{formatMicros(totalDuration / 2)}</span>
            <span>{formatMicros((totalDuration * 3) / 4)}</span>
            <span>{formatMicros(totalDuration)}</span>
          </div>

          {/* Lanes */}
          <div className="space-y-1">
            {lanes.map((lane, laneIdx) => (
              <div key={laneIdx} className="h-5 bg-slate-700 rounded relative overflow-hidden">
                {lane.spans.map((span) => {
                  const left = ((span.startMicros - minStart) / totalDuration) * 100
                  const width = Math.max((span.durationMicros / totalDuration) * 100, 1)

                  return (
                    <div
                      key={span.id}
                      className="absolute h-full rounded group cursor-pointer"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: getPhaseColor(span.phase),
                      }}
                      title={`${span.name}: ${formatMicros(span.durationMicros)}`}
                    >
                      {/* Show name if wide enough */}
                      {width > 10 && (
                        <div className="absolute inset-0 flex items-center px-1 text-[8px] text-white truncate opacity-80">
                          {span.name}
                        </div>
                      )}

                      {/* Hover tooltip */}
                      <div className="hidden group-hover:block absolute left-0 top-full z-10 bg-slate-900 border border-slate-600 rounded p-1.5 text-[9px] shadow-lg whitespace-nowrap">
                        <div className="text-slate-200">{span.name}</div>
                        <div className="text-slate-400">
                          {formatMicros(span.durationMicros)}
                          {span.cached && ' (cached)'}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Grid lines */}
          <div className="absolute inset-0 pointer-events-none">
            {[25, 50, 75].map((pct) => (
              <div
                key={pct}
                className="absolute h-full w-px bg-slate-600 opacity-30"
                style={{ left: `${pct}%` }}
              />
            ))}
          </div>
        </div>
      )}

      {!trace && (
        <div className="text-[10px] text-slate-500 text-center py-4">No trace data available</div>
      )}

      {/* Legend */}
      <div className="flex gap-3 text-[9px] border-t border-slate-700 pt-2">
        {(['trust', 'decode', 'resolve', 'decide', 'query'] as Phase[]).map((phase) => (
          <div key={phase} className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: getPhaseColor(phase) }} />
            <span className="text-slate-400 capitalize">{phase}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
