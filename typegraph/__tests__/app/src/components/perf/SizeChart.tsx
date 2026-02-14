import type { SizeResult } from '@/store/perf-store'

interface SizeChartProps {
  sizes: SizeResult[]
}

export function SizeChart({ sizes }: SizeChartProps) {
  const maxBytes = Math.max(...sizes.map((s) => s.bytes))

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-400 font-medium">Encoding Size Comparison</div>
      {sizes.map((size) => {
        const widthPct = maxBytes > 0 ? (size.bytes / maxBytes) * 100 : 0
        return (
          <div key={size.label} className="space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-300">{size.label}</span>
              <span className="text-slate-400">
                {size.bytes}B
                {size.pctReduction > 0 && (
                  <span className="text-emerald-400 ml-1">-{size.pctReduction}%</span>
                )}
              </span>
            </div>
            <div className="h-3 bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded transition-all duration-300"
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
