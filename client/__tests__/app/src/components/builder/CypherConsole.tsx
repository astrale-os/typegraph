import { Play } from 'lucide-react'
import { useState } from 'react'

import { api } from '@/api/client'
import { ErrorDisplay } from '@/components/ui/ErrorDisplay'
import { useGraphStore } from '@/store/graph-store'

export function CypherConsole() {
  const [query, setQuery] = useState('MATCH (n) RETURN n.id, labels(n)')
  const [results, setResults] = useState<unknown[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { loadFromDB } = useGraphStore()

  const handleRun = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.query(query)
      setResults(res.results)
      // Refresh graph in case the query modified data
      await loadFromDB()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setResults(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-3">
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        rows={4}
        className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-xs text-slate-200 font-mono resize-y"
        placeholder="Enter Cypher query..."
      />
      <button
        onClick={handleRun}
        disabled={loading || !query.trim()}
        className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded"
      >
        <Play className="w-3 h-3" />
        {loading ? 'Running...' : 'Run'}
      </button>

      <ErrorDisplay error={error} />

      {results !== null && (
        <div className="bg-slate-800 rounded p-3 text-xs overflow-auto max-h-[400px]">
          <div className="text-slate-400 mb-2">
            {results.length} result{results.length !== 1 ? 's' : ''}
          </div>
          <pre className="text-slate-200 font-mono whitespace-pre-wrap">
            {JSON.stringify(results, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
