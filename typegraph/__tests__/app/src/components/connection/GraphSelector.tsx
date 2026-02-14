import { useState } from 'react'
import { Database, Plus, Trash2, Sprout } from 'lucide-react'
import { useConnectionStore } from '@/store/connection-store'
import { useGraphStore } from '@/store/graph-store'

export function GraphSelector() {
  const { status, graphName, selectGraph, seed, clearGraph } = useConnectionStore()
  const { loadFromDB, clear: clearLocal } = useGraphStore()
  const [newGraphName, setNewGraphName] = useState('playground')

  if (status !== 'connected') return null

  const handleSelect = async () => {
    if (!newGraphName.trim()) return
    await selectGraph(newGraphName.trim())
    await loadFromDB()
  }

  const handleSeed = async () => {
    await seed()
    await loadFromDB()
  }

  const handleClear = async () => {
    await clearGraph()
    clearLocal()
  }

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-slate-850 border-b border-slate-700">
      <Database className="w-3.5 h-3.5 text-slate-400" />

      {!graphName ? (
        <>
          <input
            type="text"
            value={newGraphName}
            onChange={(e) => setNewGraphName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSelect()}
            className="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs w-40 text-slate-200"
            placeholder="graph name"
          />
          <button
            onClick={handleSelect}
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1 rounded"
          >
            <Plus className="w-3 h-3" />
            Open
          </button>
        </>
      ) : (
        <>
          <span className="text-xs text-slate-300">{graphName}</span>
          <button
            onClick={handleSeed}
            className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-2.5 py-1 rounded"
          >
            <Sprout className="w-3 h-3" />
            Seed
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-1 bg-red-600/80 hover:bg-red-500 text-white text-xs px-2.5 py-1 rounded"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
          <button
            onClick={() => loadFromDB()}
            className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 px-2.5 py-1 rounded"
          >
            Refresh
          </button>
        </>
      )}
    </div>
  )
}
