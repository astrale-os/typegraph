import { Sprout, Trash2, Shuffle } from 'lucide-react'
import { useState } from 'react'

import { api } from '@/api/client'
import { ErrorDisplay } from '@/components/ui/ErrorDisplay'
import { useConnectionStore } from '@/store/connection-store'
import { useGraphStore } from '@/store/graph-store'

function SeedSummary({ data, label }: { data: Record<string, unknown> | null; label: string }) {
  if (!data) return null

  const stats = data.stats as Record<string, number> | undefined
  const types = data.types as string[] | undefined
  const identities = data.identities as
    | { apps?: string[]; users?: string[]; composed?: string[] }
    | undefined
  const permissions = data.permissions as { apps?: string[]; users?: string[] } | undefined
  const compositions = data.compositions as string[] | undefined

  // Fallback: if the data doesn't match the structured format, show raw JSON
  if (!stats && !types && !identities) {
    return (
      <div className="bg-slate-800 rounded p-3 text-xs">
        <div className="text-slate-400 mb-2 font-medium">{label}</div>
        <pre className="text-slate-300 font-mono whitespace-pre-wrap text-[10px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      </div>
    )
  }

  return (
    <div className="bg-slate-800 rounded p-3 text-xs space-y-3">
      <div className="text-slate-400 font-medium">{label}</div>

      {stats && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(stats).map(([k, v]) => (
            <div key={k} className="bg-slate-700/50 rounded px-2 py-1">
              <span className="text-slate-500">{k}: </span>
              <span className="text-slate-200">{v}</span>
            </div>
          ))}
        </div>
      )}

      {types && (
        <div>
          <div className="text-slate-500 mb-1">Types</div>
          <div className="flex flex-wrap gap-1">
            {types.map((t) => (
              <span
                key={t}
                className="bg-amber-900/30 text-amber-300 rounded px-1.5 py-0.5 text-[10px]"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {identities && (
        <div className="space-y-1.5">
          <div className="text-slate-500">Identities</div>
          {identities.apps && (
            <div className="flex flex-wrap gap-1">
              {identities.apps.map((id) => (
                <span
                  key={id}
                  className="bg-cyan-900/30 text-cyan-300 rounded px-1.5 py-0.5 text-[10px]"
                >
                  {id}
                </span>
              ))}
            </div>
          )}
          {identities.users && (
            <div className="flex flex-wrap gap-1">
              {identities.users.map((id) => (
                <span
                  key={id}
                  className="bg-pink-900/30 text-pink-300 rounded px-1.5 py-0.5 text-[10px]"
                >
                  {id}
                </span>
              ))}
            </div>
          )}
          {identities.composed && (
            <div className="flex flex-wrap gap-1">
              {identities.composed.map((id) => (
                <span
                  key={id}
                  className="bg-purple-900/30 text-purple-300 rounded px-1.5 py-0.5 text-[10px]"
                >
                  {id}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {permissions && (
        <div className="border-t border-slate-700 pt-2 space-y-1">
          <div className="text-slate-500 font-medium">Permissions</div>
          {permissions.apps?.map((p) => (
            <div key={p} className="text-[10px] text-cyan-400/80 font-mono">
              {p}
            </div>
          ))}
          {permissions.users?.map((p) => (
            <div key={p} className="text-[10px] text-pink-400/80 font-mono">
              {p}
            </div>
          ))}
        </div>
      )}

      {compositions && (
        <div className="border-t border-slate-700 pt-2 space-y-1">
          <div className="text-slate-500 font-medium">Compositions</div>
          {compositions.map((c) => (
            <div key={c} className="text-[10px] text-purple-400/80 font-mono">
              {c}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function SeedDataPanel() {
  const { seed, clearGraph, seedData, graphName } = useConnectionStore()
  const { loadFromDB, clear: clearLocal } = useGraphStore()
  const [randomSummary, setRandomSummary] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSeed = async () => {
    setRandomSummary(null)
    setError(null)
    await seed()
    await loadFromDB()
  }

  const handleRandomSeed = async () => {
    setLoading(true)
    setError(null)
    setRandomSummary(null)
    try {
      const res = await api.randomSeed()
      setRandomSummary(res.summary)
      await loadFromDB()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const handleClear = async () => {
    await clearGraph()
    clearLocal()
    setRandomSummary(null)
  }

  if (!graphName) {
    return <div className="text-xs text-slate-500 text-center py-8">Select a graph first</div>
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <button
          onClick={handleSeed}
          className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-4 py-2 rounded w-full justify-center"
        >
          <Sprout className="w-4 h-4" />
          Seed Test Data
        </button>
        <button
          onClick={handleRandomSeed}
          disabled={loading}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs px-4 py-2 rounded w-full justify-center"
        >
          <Shuffle className="w-4 h-4" />
          {loading ? 'Generating...' : 'Random Seed'}
        </button>
        <button
          onClick={handleClear}
          className="flex items-center gap-2 bg-red-600/80 hover:bg-red-500 text-white text-xs px-4 py-2 rounded w-full justify-center"
        >
          <Trash2 className="w-4 h-4" />
          Clear All Data
        </button>
      </div>

      <ErrorDisplay error={error} />

      {(seedData || randomSummary) && (
        <SeedSummary
          data={randomSummary ?? seedData}
          label={randomSummary ? 'Random Seed Summary' : 'Seeded Data'}
        />
      )}
    </div>
  )
}
