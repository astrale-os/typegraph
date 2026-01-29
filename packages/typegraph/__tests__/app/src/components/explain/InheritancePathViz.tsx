import { ChevronRight } from 'lucide-react'

interface InheritancePathVizProps {
  path: string[]
  label: string
}

export function InheritancePathViz({ path, label }: InheritancePathVizProps) {
  if (path.length === 0) return null

  return (
    <div>
      <div className="text-[10px] text-slate-500 mb-1">{label}</div>
      <div className="flex items-center flex-wrap gap-0.5">
        {path.map((nodeId, i) => (
          <div key={`${nodeId}-${i}`} className="flex items-center">
            <span className="text-[10px] bg-slate-700 text-slate-200 px-1.5 py-0.5 rounded font-mono">
              {nodeId}
            </span>
            {i < path.length - 1 && <ChevronRight className="w-3 h-3 text-slate-600 mx-0.5" />}
          </div>
        ))}
      </div>
    </div>
  )
}
