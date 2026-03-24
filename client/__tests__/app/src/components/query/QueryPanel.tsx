import { Shield, Zap } from 'lucide-react'

import { useQueryStore } from '@/store/query-store'

import { AccessQueryForm } from './AccessQueryForm'
import { ResultDisplay } from './ResultDisplay'

export function QueryPanel() {
  const { checkResult, loading, error, runCheck, clearResults } = useQueryStore()

  return (
    <div className="p-3 space-y-4">
      <div className="flex items-center gap-2 text-xs text-slate-300 font-medium">
        <Shield className="w-3.5 h-3.5" />
        checkAccess
      </div>

      <AccessQueryForm />

      <div className="flex gap-2">
        <button
          onClick={runCheck}
          disabled={loading}
          className="flex items-center gap-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs px-4 py-2 rounded flex-1 justify-center"
        >
          <Zap className="w-3 h-3" />
          {loading ? 'Checking...' : 'Check Access'}
        </button>
        <button onClick={clearResults} className="text-xs text-slate-500 hover:text-slate-300 px-2">
          Clear
        </button>
      </div>

      <ResultDisplay result={checkResult} loading={loading} error={error} />
    </div>
  )
}
