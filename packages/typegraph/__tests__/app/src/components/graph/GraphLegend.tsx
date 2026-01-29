import { NODE_COLORS, EDGE_COLORS, type NodeType, type EdgeType } from '@/types/graph'

export function GraphLegend() {
  return (
    <div className="absolute bottom-4 left-4 bg-slate-900/90 border border-slate-700 rounded-lg p-3 text-xs z-10">
      <div className="font-medium text-slate-300 mb-2">Nodes</div>
      <div className="flex flex-wrap gap-2 mb-3">
        {(Object.keys(NODE_COLORS) as NodeType[]).map((type) => (
          <div key={type} className="flex items-center gap-1">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: NODE_COLORS[type].bg }} />
            <span className="text-slate-400">{type}</span>
          </div>
        ))}
      </div>
      <div className="font-medium text-slate-300 mb-2">Edges</div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(EDGE_COLORS) as EdgeType[]).map((type) => (
          <div key={type} className="flex items-center gap-1">
            <div className="w-4 h-0.5 rounded" style={{ backgroundColor: EDGE_COLORS[type] }} />
            <span className="text-slate-400">{type}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
