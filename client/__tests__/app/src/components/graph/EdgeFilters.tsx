import { useGraphStore } from '@/store/graph-store'
import { EDGE_COLORS, NODE_COLORS, type EdgeType, type NodeType } from '@/types/graph'

const EDGE_TYPE_LABELS: Record<EdgeType, string> = {
  hasParent: 'Hierarchy',
  ofType: 'Type',
  hasPerm: 'Permissions',
  unionWith: 'Union',
  intersectWith: 'Intersect',
  excludeWith: 'Exclude',
}

export function EdgeFilters() {
  const visibleEdgeTypes = useGraphStore((s) => s.visibleEdgeTypes)
  const toggleEdgeType = useGraphStore((s) => s.toggleEdgeType)

  return (
    <div className="absolute bottom-4 left-4 bg-slate-900/95 border border-slate-700 rounded-lg p-2.5 text-xs z-10 space-y-2">
      {/* Node legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {(['Space', 'Module', 'Type', 'Identity'] as NodeType[]).map((type) => (
          <div key={type} className="flex items-center gap-1">
            <div
              className="w-2.5 h-2.5 rounded-sm"
              style={{ backgroundColor: NODE_COLORS[type].bg }}
            />
            <span className="text-[10px] text-slate-500">{type}</span>
          </div>
        ))}
      </div>

      {/* Edge toggles */}
      <div className="flex flex-wrap gap-x-1 gap-y-1">
        {(Object.keys(EDGE_COLORS) as EdgeType[]).map((type) => {
          const active = visibleEdgeTypes.includes(type)
          return (
            <button
              key={type}
              onClick={() => toggleEdgeType(type)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors ${
                active
                  ? 'border-slate-600 bg-slate-800 text-slate-200'
                  : 'border-slate-700/50 bg-transparent text-slate-600'
              }`}
            >
              <div
                className="w-3 h-0.5 rounded"
                style={{
                  backgroundColor: EDGE_COLORS[type],
                  opacity: active ? 1 : 0.3,
                }}
              />
              {EDGE_TYPE_LABELS[type]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
