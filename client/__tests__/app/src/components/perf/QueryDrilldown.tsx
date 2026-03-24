/**
 * Query Drilldown
 *
 * Shows Cypher query details from spans with expandable query text.
 */

import { useState, useMemo } from 'react'

import type { ScenarioResult } from '@/types/profiling'

import { formatMicros } from '@/types/profiling'

interface QueryDrilldownProps {
  results: ScenarioResult[]
}

interface QueryInfo {
  id: string
  scenario: string
  method: string
  duration: number
  cached: boolean
  cypher: string
  params: Record<string, unknown>
}

export function QueryDrilldown({ results }: QueryDrilldownProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')
  const [showCached, setShowCached] = useState(true)

  // Extract all queries from spans
  const queries = useMemo(() => {
    const queries: QueryInfo[] = []
    let id = 0

    for (const result of results) {
      for (const trace of result.traces.slice(0, 1)) {
        // Only first trace per scenario
        for (const span of trace.spans) {
          if (span.metadata?.query) {
            queries.push({
              id: `q${id++}`,
              scenario: result.scenario.name,
              method: span.name,
              duration: span.durationMicros,
              cached: span.cached,
              cypher: span.metadata.query.cypher,
              params: span.metadata.query.params,
            })
          }
        }
      }
    }

    return queries
  }, [results])

  // Filter queries
  const filteredQueries = useMemo(() => {
    return queries.filter((q) => {
      if (!showCached && q.cached) return false
      if (filter && !q.cypher.toLowerCase().includes(filter.toLowerCase())) return false
      return true
    })
  }, [queries, filter, showCached])

  // Deduplicate by cypher text for summary
  const uniqueQueries = useMemo(() => {
    const seen = new Map<string, QueryInfo>()
    for (const q of filteredQueries) {
      if (!seen.has(q.cypher)) {
        seen.set(q.cypher, q)
      }
    }
    return [...seen.values()]
  }, [filteredQueries])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter queries..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1 text-[10px] text-slate-200 placeholder-slate-500"
        />
        <label className="flex items-center gap-1 text-[9px] text-slate-400">
          <input
            type="checkbox"
            checked={showCached}
            onChange={(e) => setShowCached(e.target.checked)}
          />
          Show cached
        </label>
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-[9px] text-slate-500">
        <span>Total: {queries.length} queries</span>
        <span>Unique: {uniqueQueries.length}</span>
        <span>Cached: {queries.filter((q) => q.cached).length}</span>
      </div>

      {/* Query list */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {filteredQueries.map((query) => (
          <div key={query.id} className="bg-slate-700/50 rounded overflow-hidden">
            {/* Header */}
            <div
              className="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-700"
              onClick={() => toggleExpand(query.id)}
            >
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-300 font-medium">{query.method}</span>
                <span className="text-[9px] text-slate-500">{query.scenario}</span>
                {query.cached && (
                  <span className="text-[8px] px-1 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">
                    CACHED
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-amber-400">{formatMicros(query.duration)}</span>
                <span className="text-slate-500">{expandedIds.has(query.id) ? '▼' : '▶'}</span>
              </div>
            </div>

            {/* Expanded content */}
            {expandedIds.has(query.id) && (
              <div className="border-t border-slate-600 p-2 space-y-2">
                {/* Cypher */}
                <div>
                  <div className="text-[9px] text-slate-500 mb-1">Cypher Condition:</div>
                  <pre className="text-[9px] text-slate-300 bg-slate-800 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
                    {query.cypher}
                  </pre>
                </div>

                {/* Params */}
                {Object.keys(query.params).length > 0 && (
                  <div>
                    <div className="text-[9px] text-slate-500 mb-1">Parameters:</div>
                    <pre className="text-[9px] text-slate-400 bg-slate-800 p-2 rounded overflow-x-auto">
                      {JSON.stringify(query.params, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Copy button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    navigator.clipboard.writeText(query.cypher)
                  }}
                  className="text-[9px] text-slate-500 hover:text-slate-300"
                >
                  Copy query
                </button>
              </div>
            )}
          </div>
        ))}

        {filteredQueries.length === 0 && (
          <div className="text-[10px] text-slate-500 text-center py-4">No queries found</div>
        )}
      </div>

      {/* Unique query summary */}
      {uniqueQueries.length > 0 && (
        <div className="border-t border-slate-700 pt-2">
          <div className="text-[10px] text-slate-400 font-medium mb-2">Unique Query Patterns</div>
          <div className="space-y-1">
            {uniqueQueries.slice(0, 5).map((q, i) => (
              <div key={i} className="text-[9px] text-slate-500 truncate">
                {i + 1}. {q.cypher.substring(0, 80)}...
              </div>
            ))}
            {uniqueQueries.length > 5 && (
              <div className="text-[9px] text-slate-600">
                ... and {uniqueQueries.length - 5} more
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
