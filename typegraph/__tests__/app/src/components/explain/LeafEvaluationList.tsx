import { StatusBadge } from '@/components/ui/StatusBadge'
import { InheritancePathViz } from './InheritancePathViz'
import type { LeafEvaluation } from '@/types/api'

interface LeafEvaluationListProps {
  leaves: LeafEvaluation[]
}

export function LeafEvaluationList({ leaves }: LeafEvaluationListProps) {
  if (leaves.length === 0) {
    return <div className="text-[10px] text-slate-600">No leaves</div>
  }

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-slate-500 uppercase tracking-wide">
        Leaf Evaluations ({leaves.length})
      </div>
      {leaves.map((leaf, i) => (
        <div key={i} className="bg-slate-800 rounded p-2 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-200">{leaf.identityId}</span>
            <StatusBadge
              variant={
                leaf.status === 'granted'
                  ? 'granted'
                  : leaf.status === 'filtered'
                    ? 'filtered'
                    : 'missing'
              }
            >
              {leaf.status}
            </StatusBadge>
            <span className="text-[10px] text-slate-600">path: [{leaf.path.join(', ')}]</span>
          </div>

          {leaf.status === 'granted' && leaf.grantedAt && (
            <div className="text-[10px] text-slate-400">
              Granted at: <span className="text-green-400 font-mono">{leaf.grantedAt}</span>
            </div>
          )}

          {leaf.status === 'granted' && leaf.inheritancePath && (
            <InheritancePathViz path={leaf.inheritancePath} label="Inheritance path" />
          )}

          {leaf.status === 'filtered' && leaf.filterDetail && (
            <div className="space-y-0.5">
              {leaf.filterDetail.map((detail, j) => (
                <div key={j} className="text-[10px] text-yellow-400">
                  Scope {detail.scopeIndex}: failed {detail.failedCheck} check
                </div>
              ))}
            </div>
          )}

          {leaf.status === 'missing' && leaf.searchedPath && (
            <InheritancePathViz path={leaf.searchedPath} label="Searched path" />
          )}

          {leaf.nodeRestrictions && leaf.nodeRestrictions.length > 0 && (
            <div className="text-[10px] text-slate-500">
              Node restrictions: {leaf.nodeRestrictions.join(', ')}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
