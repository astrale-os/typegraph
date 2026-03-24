import type { PhaseExplanation } from '@/types/api'

import { ExpressionPreview } from '@/components/query/ExpressionPreview'

import { CypherDisplay } from './CypherDisplay'
import { LeafEvaluationList } from './LeafEvaluationList'

interface PhaseCardProps {
  title: string
  phase: PhaseExplanation
  granted: boolean
}

export function PhaseCard({ title, phase, granted }: PhaseCardProps) {
  return (
    <div className="bg-slate-850 border border-slate-700 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-300">{title}</span>
        <span
          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
            granted ? 'text-green-400 bg-green-900/30' : 'text-red-400 bg-red-900/30'
          }`}
        >
          {granted ? 'PASS' : 'FAIL'}
        </span>
      </div>

      <ExpressionPreview label="Expression" expr={phase.expression} />

      {/* Cypher section - prominent, full width, always visible when present */}
      {phase.query && (
        <div className="bg-slate-900/50 rounded-lg p-2 border border-slate-700/50">
          <CypherDisplay query={phase.query} />
        </div>
      )}

      <LeafEvaluationList leaves={phase.leaves} />
    </div>
  )
}
