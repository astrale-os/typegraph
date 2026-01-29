import { Zap, Trash2 } from 'lucide-react'
import { useProfilingStore, type RequestProfile } from '@/store/profiling-store'
import { formatBytes } from '@/api/instrumented-client'

function RequestRow({ req }: { req: RequestProfile }) {
  return (
    <div className="flex items-center gap-3 text-[10px] py-1 border-b border-slate-700/50 last:border-0">
      <span className="text-slate-500 w-10 shrink-0">{req.method}</span>
      <span className="text-slate-300 truncate flex-1">{req.endpoint}</span>
      <span className={`w-12 text-right ${req.error ? 'text-red-400' : 'text-emerald-400'}`}>
        {req.latencyMs}ms
      </span>
      <span className="text-slate-500 w-12 text-right">{formatBytes(req.requestSize)}</span>
      <span className="text-slate-500 w-12 text-right">{formatBytes(req.responseSize)}</span>
    </div>
  )
}

export function ProfilingBar() {
  const { requests, expanded, toggleExpanded, clear } = useProfilingStore()

  const last = requests[0]
  const avgLatency =
    requests.length > 0
      ? Math.round(requests.reduce((sum, r) => sum + r.latencyMs, 0) / requests.length)
      : 0

  return (
    <div className="border-t border-slate-700 bg-slate-900">
      {/* Collapsed bar */}
      <button
        onClick={toggleExpanded}
        className="flex items-center gap-3 w-full px-4 py-1.5 text-[10px] hover:bg-slate-800/50 transition-colors"
      >
        <Zap className="w-3 h-3 text-amber-400" />
        {last ? (
          <>
            <span className="text-slate-500">{last.method}</span>
            <span className="text-slate-300 truncate">{last.endpoint}</span>
            <span className={`${last.error ? 'text-red-400' : 'text-emerald-400'}`}>
              {last.latencyMs}ms
            </span>
            <span className="text-slate-500">req: {formatBytes(last.requestSize)}</span>
            <span className="text-slate-500">res: {formatBytes(last.responseSize)}</span>
            <span className="text-slate-600 ml-auto">
              avg: {avgLatency}ms | {requests.length} requests
            </span>
          </>
        ) : (
          <span className="text-slate-500">No requests yet</span>
        )}
      </button>

      {/* Expanded history */}
      {expanded && (
        <div className="border-t border-slate-700 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-1 bg-slate-800/50">
            <span className="text-[10px] text-slate-400">Request History</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                clear()
              }}
              className="text-[10px] text-slate-500 hover:text-slate-300 flex items-center gap-1"
            >
              <Trash2 className="w-2.5 h-2.5" />
              Clear
            </button>
          </div>
          <div className="px-4 py-1">
            {/* Header */}
            <div className="flex items-center gap-3 text-[9px] text-slate-600 uppercase tracking-wider py-1">
              <span className="w-10 shrink-0">Method</span>
              <span className="flex-1">Endpoint</span>
              <span className="w-12 text-right">Latency</span>
              <span className="w-12 text-right">Req</span>
              <span className="w-12 text-right">Res</span>
            </div>
            {requests.map((req) => (
              <RequestRow key={req.id} req={req} />
            ))}
            {requests.length === 0 && (
              <div className="text-[10px] text-slate-600 py-2 text-center">
                No requests recorded
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
