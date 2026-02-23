import { useEffect } from 'react'
import { Search, Zap } from 'lucide-react'
import { useQueryStore } from '@/store/query-store'
import { useGraphStore } from '@/store/graph-store'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ErrorDisplay } from '@/components/ui/ErrorDisplay'
import { AccessQueryForm } from '@/components/query/AccessQueryForm'
import { PhaseCard } from './PhaseCard'

export function ExplainPanel() {
  const { explainResult, loading, error, runExplain, clearResults } = useQueryStore()

  const setHighlightedPaths = useGraphStore((s) => s.setHighlightedPaths)
  const clearHighlights = useGraphStore((s) => s.clearHighlights)

  // Highlight access paths when explain result changes
  useEffect(() => {
    if (!explainResult) {
      clearHighlights()
      return
    }

    const paths: string[][] = []
    for (const phase of [explainResult.typeCheck, explainResult.resourceCheck]) {
      for (const leaf of phase.leaves) {
        if (leaf.inheritancePath) {
          paths.push(leaf.inheritancePath)
        }
        if (leaf.searchedPath) {
          paths.push(leaf.searchedPath)
        }
      }
    }
    setHighlightedPaths(paths)
  }, [explainResult, setHighlightedPaths, clearHighlights])

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
        <Search className="w-3.5 h-3.5" />
        explainAccess
      </div>

      <AccessQueryForm />

      <div className="flex gap-2">
        <button
          onClick={runExplain}
          disabled={loading}
          className="flex items-center gap-1 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white text-xs px-4 py-2 rounded flex-1 justify-center"
        >
          <Zap className="w-3 h-3" />
          {loading ? 'Explaining...' : 'Explain Access'}
        </button>
        <button
          onClick={() => {
            clearResults()
            clearHighlights()
          }}
          className="text-xs text-slate-500 hover:text-slate-300 px-2"
        >
          Clear
        </button>
      </div>

      <ErrorDisplay error={error} />

      {/* Explain Result */}
      {explainResult && (
        <div className="space-y-3">
          {/* Summary */}
          <div className="bg-slate-800 rounded p-3 flex items-center gap-3">
            <StatusBadge variant={explainResult.granted ? 'granted' : 'denied'}>
              {explainResult.granted ? 'GRANTED' : 'DENIED'}
            </StatusBadge>
            {explainResult.deniedBy && (
              <StatusBadge variant={explainResult.deniedBy}>
                Denied by: {explainResult.deniedBy === 'type' ? 'Type Check' : 'Resource Check'}
              </StatusBadge>
            )}
            <span className="text-[10px] text-slate-500 ml-auto">
              {explainResult.resourceId} / {explainResult.perm}
            </span>
          </div>

          {/* Phase Cards */}
          <PhaseCard
            title="Phase 1: Type Check"
            phase={explainResult.typeCheck}
            granted={explainResult.granted || explainResult.deniedBy !== 'type'}
          />
          <PhaseCard
            title="Phase 2: Resource Check"
            phase={explainResult.resourceCheck}
            granted={explainResult.granted}
          />
        </div>
      )}
    </div>
  )
}
