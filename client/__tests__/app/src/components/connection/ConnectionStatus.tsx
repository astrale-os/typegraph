import { Circle, Plug, Unplug } from 'lucide-react'
import { useEffect } from 'react'

import { useConnectionStore } from '@/store/connection-store'

export function ConnectionStatus() {
  const {
    status,
    host,
    port,
    graphName,
    error,
    setHost,
    setPort,
    connect,
    disconnect,
    checkStatus,
  } = useConnectionStore()

  useEffect(() => {
    checkStatus()
  }, [checkStatus])

  const statusColor =
    status === 'connected'
      ? 'text-green-400'
      : status === 'connecting'
        ? 'text-yellow-400'
        : status === 'error'
          ? 'text-red-400'
          : 'text-slate-500'

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700">
      <Circle className={`w-3 h-3 fill-current ${statusColor}`} />
      <span className="text-xs text-slate-400 uppercase tracking-wide">{status}</span>

      {status === 'disconnected' || status === 'error' ? (
        <>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs w-28 text-slate-200"
            placeholder="host"
          />
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(parseInt(e.target.value, 10) || 6379)}
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs w-16 text-slate-200"
          />
          <button
            onClick={connect}
            className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 text-white text-xs px-3 py-1 rounded"
          >
            <Plug className="w-3 h-3" />
            Connect
          </button>
        </>
      ) : (
        <>
          <span className="text-xs text-slate-300">
            {host}:{port}
          </span>
          {graphName && (
            <span className="text-xs bg-slate-700 px-2 py-0.5 rounded text-slate-300">
              {graphName}
            </span>
          )}
          <button
            onClick={disconnect}
            className="flex items-center gap-1 bg-slate-600 hover:bg-slate-500 text-white text-xs px-3 py-1 rounded ml-auto"
          >
            <Unplug className="w-3 h-3" />
            Disconnect
          </button>
        </>
      )}

      {error && <span className="text-xs text-red-400 ml-2 truncate max-w-60">{error}</span>}
    </div>
  )
}
