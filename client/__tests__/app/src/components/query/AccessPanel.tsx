import { useState, useEffect, useMemo } from 'react'
import { Shield, Zap } from 'lucide-react'
import { useQueryStore } from '@/store/query-store'
import { useGraphStore } from '@/store/graph-store'
import { AccessQueryForm } from './AccessQueryForm'
import { ResultDisplay } from './ResultDisplay'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { ErrorDisplay } from '@/components/ui/ErrorDisplay'
import { TimingBreakdown } from '@/components/ui/TimingBreakdown'
import { PhaseCard } from '@/components/explain/PhaseCard'
import { evaluateGranted } from '@authz/authorization/explainer'

type Mode = 'check' | 'explain'

export function AccessPanel() {
  const [mode, setMode] = useState<Mode>('explain')

  const {
    checkResult,
    explainResult,
    profile,
    loading,
    error,
    runCheck,
    runExplain,
    clearResults,
  } = useQueryStore()

  const setHighlightedPaths = useGraphStore((s) => s.setHighlightedPaths)
  const clearHighlights = useGraphStore((s) => s.clearHighlights)

  // Compute per-phase granted status from expression + leaves
  const typeCheckGranted = useMemo(() => {
    if (!explainResult) return false
    return evaluateGranted(explainResult.typeCheck.expression, explainResult.typeCheck.leaves)
  }, [explainResult])

  const resourceCheckGranted = useMemo(() => {
    if (!explainResult) return false
    return evaluateGranted(
      explainResult.resourceCheck.expression,
      explainResult.resourceCheck.leaves,
    )
  }, [explainResult])

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

  const handleRun = () => {
    if (mode === 'check') {
      runCheck()
    } else {
      runExplain()
    }
  }

  const handleClear = () => {
    clearResults()
    clearHighlights()
  }

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
        <Shield className="w-3.5 h-3.5" />
        Access Query
      </div>

      {/* Mode toggle */}
      <div className="flex rounded bg-slate-800 p-0.5">
        <button
          onClick={() => setMode('check')}
          className={`flex-1 text-[10px] py-1 rounded transition-colors ${
            mode === 'check' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          checkAccess
        </button>
        <button
          onClick={() => setMode('explain')}
          className={`flex-1 text-[10px] py-1 rounded transition-colors ${
            mode === 'explain' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-slate-300'
          }`}
        >
          explainAccess
        </button>
      </div>

      <AccessQueryForm />

      {/* Run */}
      <div className="flex gap-2">
        <button
          onClick={handleRun}
          disabled={loading}
          className={`flex items-center gap-1 disabled:opacity-50 text-white text-xs px-4 py-2 rounded flex-1 justify-center ${
            mode === 'check' ? 'bg-blue-600 hover:bg-blue-500' : 'bg-purple-600 hover:bg-purple-500'
          }`}
        >
          <Zap className="w-3 h-3" />
          {loading
            ? mode === 'check'
              ? 'Checking...'
              : 'Explaining...'
            : mode === 'check'
              ? 'Check Access'
              : 'Explain Access'}
        </button>
        <button onClick={handleClear} className="text-xs text-slate-500 hover:text-slate-300 px-2">
          Clear
        </button>
      </div>

      {/* Check result */}
      {mode === 'check' && (
        <>
          <ResultDisplay result={checkResult} loading={loading} error={error} />
          {profile && <TimingBreakdown profile={profile} />}
        </>
      )}

      {/* Explain result */}
      {mode === 'explain' && (
        <>
          <ErrorDisplay error={error} />

          {explainResult && (
            <div className="space-y-3">
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

              {profile && <TimingBreakdown profile={profile} />}

              <PhaseCard
                title="Phase 1: Type Check"
                phase={explainResult.typeCheck}
                granted={typeCheckGranted}
              />
              <PhaseCard
                title="Phase 2: Resource Check"
                phase={explainResult.resourceCheck}
                granted={resourceCheckGranted}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
