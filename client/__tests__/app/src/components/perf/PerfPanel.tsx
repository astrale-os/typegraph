import { useState } from 'react'
import { BarChart3, Play, Timer } from 'lucide-react'
import { usePerfStore } from '@/store/perf-store'
import { useQueryStore } from '@/store/query-store'
import { SizeChart } from './SizeChart'
import { ErrorDisplay } from '@/components/ui/ErrorDisplay'
import { LatencyProfiler } from './LatencyProfiler'
import type { IdentityExpr } from '@/types/api'

type PerfTab = 'encoding' | 'latency'

export function PerfPanel() {
  const [activeTab, setActiveTab] = useState<PerfTab>('latency')

  return (
    <div className="flex flex-col h-full">
      {/* Tab buttons */}
      <div className="flex border-b border-slate-700 px-3 pt-2">
        <button
          onClick={() => setActiveTab('encoding')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] rounded-t border-b-2 ${
            activeTab === 'encoding'
              ? 'border-amber-500 text-slate-200 bg-slate-800'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <BarChart3 className="w-3 h-3" />
          Encoding
        </button>
        <button
          onClick={() => setActiveTab('latency')}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] rounded-t border-b-2 ${
            activeTab === 'latency'
              ? 'border-purple-500 text-slate-200 bg-slate-800'
              : 'border-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          <Timer className="w-3 h-3" />
          Latency
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'encoding' && <EncodingBenchmarks />}
        {activeTab === 'latency' && <LatencyProfiler />}
      </div>
    </div>
  )
}

function EncodingBenchmarks() {
  const { result, loading, error, runBenchmark, clear } = usePerfStore()
  const { forTypeExpr, forResourceExpr } = useQueryStore()
  const [jsonInput, setJsonInput] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)

  const handleRunFromStore = (expr: IdentityExpr) => {
    runBenchmark(expr)
  }

  const handleRunFromJson = () => {
    setParseError(null)
    try {
      const expr = JSON.parse(jsonInput) as IdentityExpr
      if (!expr || typeof expr !== 'object' || !('kind' in expr)) {
        throw new Error('Not a valid IdentityExpr (missing "kind" field)')
      }
      runBenchmark(expr)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
        <BarChart3 className="w-3.5 h-3.5" />
        Encoding Benchmarks
      </div>

      {/* Quick buttons to use expressions from Query panel */}
      <div className="space-y-2">
        <div className="text-[10px] text-slate-500">Use expression from Query panel:</div>
        <div className="flex gap-2">
          <button
            onClick={() => forTypeExpr && handleRunFromStore(forTypeExpr)}
            disabled={!forTypeExpr || loading}
            className="text-[10px] bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 px-3 py-1 rounded"
          >
            forType expr
          </button>
          <button
            onClick={() => forResourceExpr && handleRunFromStore(forResourceExpr)}
            disabled={!forResourceExpr || loading}
            className="text-[10px] bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 px-3 py-1 rounded"
          >
            forResource expr
          </button>
        </div>
      </div>

      {/* JSON input */}
      <div className="space-y-1.5">
        <div className="text-[10px] text-slate-500">Or paste JSON expression:</div>
        <textarea
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
          rows={4}
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-[10px] text-slate-200 font-mono resize-y"
          placeholder='{"kind":"union","left":{"kind":"identity","id":"A"},"right":{"kind":"identity","id":"B"}}'
        />
        <button
          onClick={handleRunFromJson}
          disabled={!jsonInput.trim() || loading}
          className="flex items-center gap-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-[10px] px-3 py-1.5 rounded"
        >
          <Play className="w-3 h-3" />
          {loading ? 'Running...' : 'Run Benchmark'}
        </button>
      </div>

      <ErrorDisplay error={parseError} />
      <ErrorDisplay error={error} />

      {result && (
        <div className="space-y-4">
          <SizeChart sizes={result.sizes} />

          {/* Dedup stats */}
          {result.dedupStats && (
            <div className="bg-slate-800 rounded p-2.5 text-[10px] space-y-1">
              <div className="text-slate-400 font-medium">Deduplication Stats</div>
              <div className="grid grid-cols-2 gap-1 text-slate-300">
                <span className="text-slate-500">Total subtrees:</span>
                <span>{result.dedupStats.totalSubtrees}</span>
                <span className="text-slate-500">Unique:</span>
                <span>{result.dedupStats.uniqueSubtrees}</span>
                <span className="text-slate-500">Duplicates:</span>
                <span>{result.dedupStats.duplicateSubtrees}</span>
                <span className="text-slate-500">Savings:</span>
                <span className="text-emerald-400">{result.dedupStats.potentialSavings}%</span>
              </div>
            </div>
          )}

          {/* Encode/Decode timing */}
          <div className="bg-slate-800 rounded p-2.5 text-[10px] space-y-2">
            <div className="text-slate-400 font-medium">Encode Performance (avg over 100 runs)</div>
            {result.encodeTimes.map((t) => (
              <div key={t.label} className="flex justify-between text-slate-300">
                <span>{t.label}</span>
                <span className="text-amber-400">{t.avgMs.toFixed(4)}ms</span>
              </div>
            ))}
          </div>

          <div className="bg-slate-800 rounded p-2.5 text-[10px] space-y-2">
            <div className="text-slate-400 font-medium">Decode Performance (avg over 100 runs)</div>
            {result.decodeTimes.map((t) => (
              <div key={t.label} className="flex justify-between text-slate-300">
                <span>{t.label}</span>
                <span className="text-amber-400">{t.avgMs.toFixed(4)}ms</span>
              </div>
            ))}
          </div>

          <button onClick={clear} className="text-[10px] text-slate-500 hover:text-slate-300">
            Clear results
          </button>
        </div>
      )}
    </div>
  )
}
