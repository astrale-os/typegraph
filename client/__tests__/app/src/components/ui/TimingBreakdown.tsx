import { Timer, ChevronDown, ChevronRight } from 'lucide-react'
import { useState, useMemo } from 'react'

import type { PerformanceProfile } from '@/types/api'

interface TimingBreakdownProps {
  profile: PerformanceProfile
}

type MethodSummary = {
  method: string
  totalMs: number
  count: number
  cached: number
}

function formatMs(ms: number): string {
  return ms < 0.1 ? '<0.1' : ms.toFixed(1)
}

export function TimingBreakdown({ profile }: TimingBreakdownProps) {
  const [expanded, setExpanded] = useState(false)
  const [showCallLog, setShowCallLog] = useState(false)

  const methodSummaries = useMemo(() => {
    const map = new Map<string, MethodSummary>()
    for (const call of profile.calls) {
      const existing = map.get(call.method)
      if (existing) {
        existing.totalMs += call.durationMs
        existing.count += 1
        if (call.cached) existing.cached += 1
      } else {
        map.set(call.method, {
          method: call.method,
          totalMs: call.durationMs,
          count: 1,
          cached: call.cached ? 1 : 0,
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.totalMs - a.totalMs)
  }, [profile.calls])

  const maxMethodMs = useMemo(
    () => Math.max(...methodSummaries.map((s) => s.totalMs), 1),
    [methodSummaries],
  )

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded text-[10px]">
      {/* Collapsed summary row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-slate-700/30 transition-colors"
      >
        <Timer className="w-3 h-3 text-slate-400" />
        <span className="text-slate-300 tabular-nums font-medium">
          {formatMs(profile.totalMs)}ms
        </span>
        <span className="text-slate-500">|</span>
        <span className="text-slate-400">
          grant{' '}
          <span className="text-slate-300 tabular-nums">{formatMs(profile.resolveGrantMs)}ms</span>
        </span>
        <span className="text-slate-500">|</span>
        <span className="text-slate-400">
          auth{' '}
          <span className="text-slate-300 tabular-nums">{formatMs(profile.authCheckMs)}ms</span>
        </span>
        <span className="ml-auto">
          {expanded ? (
            <ChevronDown className="w-3 h-3 text-slate-500" />
          ) : (
            <ChevronRight className="w-3 h-3 text-slate-500" />
          )}
        </span>
      </button>

      {/* Expanded method breakdown */}
      {expanded && (
        <div className="border-t border-slate-700/50 px-2 py-1.5 space-y-1">
          {methodSummaries.map((summary) => (
            <div key={summary.method} className="flex items-center gap-2">
              <span className="text-slate-400 w-28 truncate" title={summary.method}>
                {summary.method}
              </span>
              <div className="flex-1 h-1.5 bg-slate-700/50 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-500/60 rounded"
                  style={{ width: `${(summary.totalMs / maxMethodMs) * 100}%` }}
                />
              </div>
              <span className="text-slate-300 tabular-nums w-14 text-right">
                {formatMs(summary.totalMs)}ms
              </span>
              {summary.count > 1 && (
                <span className="text-slate-500 tabular-nums w-8">x{summary.count}</span>
              )}
              {summary.count === 1 && <span className="w-8" />}
            </div>
          ))}

          {/* Call log toggle */}
          {profile.calls.length > 0 && (
            <button
              onClick={() => setShowCallLog(!showCallLog)}
              className="flex items-center gap-1 text-slate-500 hover:text-slate-400 mt-1"
            >
              {showCallLog ? (
                <ChevronDown className="w-2.5 h-2.5" />
              ) : (
                <ChevronRight className="w-2.5 h-2.5" />
              )}
              <span>{profile.calls.length} calls</span>
            </button>
          )}

          {/* Deep expand: ordered call log */}
          {showCallLog && (
            <div className="mt-1 space-y-0.5 pl-2 border-l border-slate-700/50">
              {profile.calls.map((call, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-slate-500 tabular-nums w-4">{i + 1}.</span>
                  <span className="text-slate-400 w-28 truncate" title={call.method}>
                    {call.method}
                  </span>
                  <span className="text-slate-300 tabular-nums">{formatMs(call.durationMs)}ms</span>
                  {call.cached && (
                    <span className="text-[9px] px-1 py-0.5 bg-green-500/20 text-green-400 rounded">
                      cached
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
