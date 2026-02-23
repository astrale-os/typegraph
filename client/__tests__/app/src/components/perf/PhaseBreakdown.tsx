/**
 * Phase Breakdown
 *
 * Pie chart showing phase distribution and bar chart for method breakdown.
 */

import type { TraceMetrics, Phase } from '@/types/profiling'
import { formatMicros, getPhaseColor } from '@/types/profiling'

interface PhaseBreakdownProps {
  metrics: TraceMetrics
}

export function PhaseBreakdown({ metrics }: PhaseBreakdownProps) {
  const phases: Phase[] = ['trust', 'decode', 'resolve', 'decide', 'query']
  const phaseData = phases.map((phase) => ({
    phase,
    percentage: metrics.phaseDistribution[phase],
    mean: metrics.byPhase[phase]?.mean ?? 0,
    count: metrics.byPhase[phase]?.count ?? 0,
  }))

  // Method breakdown sorted by mean time
  const methodData = Object.entries(metrics.byMethod)
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.mean - a.mean)
    .slice(0, 8)

  const maxMethodMean = Math.max(...methodData.map((m) => m.mean), 1)

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Phase Distribution */}
      <div className="space-y-3">
        <div className="text-[10px] text-slate-400 font-medium">Phase Distribution</div>

        {/* Simple pie chart using conic-gradient */}
        <div className="flex items-center justify-center">
          <PieChart data={phaseData} />
        </div>

        {/* Legend with values */}
        <div className="space-y-1.5">
          {phaseData.map(({ phase, percentage, mean }) => (
            <div key={phase} className="flex items-center justify-between text-[9px]">
              <div className="flex items-center gap-1.5">
                <div
                  className="w-2 h-2 rounded-sm"
                  style={{ backgroundColor: getPhaseColor(phase) }}
                />
                <span className="text-slate-300 capitalize">{phase}</span>
              </div>
              <div className="text-slate-500">
                {percentage.toFixed(1)}% ({formatMicros(mean)})
              </div>
            </div>
          ))}
        </div>

        {/* Cache stats */}
        <div className="border-t border-slate-700 pt-2 space-y-1">
          <div className="text-[10px] text-slate-400 font-medium">Cache Performance</div>
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-slate-700 rounded overflow-hidden">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${metrics.cache.hitRate}%` }}
              />
            </div>
            <span className="text-[9px] text-slate-400">{metrics.cache.hitRate.toFixed(0)}%</span>
          </div>
          <div className="flex justify-between text-[9px] text-slate-500">
            <span>Hits: {metrics.cache.hits}</span>
            <span>Misses: {metrics.cache.misses}</span>
          </div>
        </div>
      </div>

      {/* Method Breakdown */}
      <div className="space-y-3">
        <div className="text-[10px] text-slate-400 font-medium">Method Breakdown</div>

        <div className="space-y-2">
          {methodData.map(({ name, mean, count, p95 }) => (
            <div key={name} className="space-y-0.5">
              <div className="flex items-center justify-between text-[9px]">
                <span className="text-slate-300 truncate max-w-[120px]" title={name}>
                  {name}
                </span>
                <span className="text-slate-500">{formatMicros(mean)}</span>
              </div>
              <div className="h-2 bg-slate-700 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-500"
                  style={{ width: `${(mean / maxMethodMean) * 100}%` }}
                />
              </div>
              <div className="flex justify-between text-[8px] text-slate-600">
                <span>n={count}</span>
                <span>p95={formatMicros(p95)}</span>
              </div>
            </div>
          ))}
        </div>

        {methodData.length === 0 && (
          <div className="text-[10px] text-slate-500 text-center py-4">No method data</div>
        )}
      </div>
    </div>
  )
}

interface PieChartProps {
  data: Array<{ phase: Phase; percentage: number }>
}

function PieChart({ data }: PieChartProps) {
  // Build conic gradient
  let angle = 0
  const gradientStops: string[] = []

  for (const { phase, percentage } of data) {
    const start = angle
    const end = angle + (percentage / 100) * 360
    gradientStops.push(`${getPhaseColor(phase)} ${start}deg ${end}deg`)
    angle = end
  }

  // Fill remainder if not 100%
  if (angle < 360) {
    gradientStops.push(`#334155 ${angle}deg 360deg`)
  }

  const gradient = `conic-gradient(${gradientStops.join(', ')})`

  return (
    <div className="w-32 h-32 rounded-full" style={{ background: gradient }}>
      {/* Inner circle for donut effect */}
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-20 h-20 rounded-full bg-slate-800 flex items-center justify-center">
          <div className="text-center">
            <div className="text-[8px] text-slate-500">Total</div>
            <div className="text-[11px] text-slate-200">
              {formatMicros(data.reduce((sum, d) => sum + (d.percentage > 0 ? 1 : 0), 0))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
