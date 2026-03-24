import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import type { EdgeType } from '@/types/graph'

import { useGraphStore } from '@/store/graph-store'

const EDGE_TYPES: EdgeType[] = [
  'hasParent',
  'ofType',
  'hasPerm',
  'unionWith',
  'intersectWith',
  'excludeWith',
]

const PERMS = ['read', 'edit', 'use', 'share']

export function EdgeCreator() {
  const { nodes, edges, addEdge, removeEdge } = useGraphStore()
  const [type, setType] = useState<EdgeType>('hasParent')
  const [sourceId, setSourceId] = useState('')
  const [targetId, setTargetId] = useState('')
  const [perm, setPerm] = useState('read')

  const handleAdd = async () => {
    if (!sourceId || !targetId) return
    const props = type === 'hasPerm' ? { perms: [perm] } : undefined
    await addEdge(type, sourceId, targetId, props)
    setSourceId('')
    setTargetId('')
  }

  return (
    <div>
      <div className="space-y-2 mb-4">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as EdgeType)}
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          {EDGE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="">Source node...</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id} ({n.type})
            </option>
          ))}
        </select>

        <select
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="">Target node...</option>
          {nodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id} ({n.type})
            </option>
          ))}
        </select>

        {type === 'hasPerm' && (
          <select
            value={perm}
            onChange={(e) => setPerm(e.target.value)}
            className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
          >
            {PERMS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}

        <button
          onClick={handleAdd}
          disabled={!sourceId || !targetId}
          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded w-full justify-center"
        >
          <Plus className="w-3 h-3" />
          Add Edge
        </button>
      </div>

      <div className="text-xs text-slate-400 mb-2">Existing Edges ({edges.length})</div>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {edges.map((edge, i) => (
          <div
            key={`${edge.sourceId}-${edge.type}-${edge.targetId}-${i}`}
            className="flex items-center justify-between bg-slate-800 rounded px-2 py-1.5"
          >
            <div className="text-xs text-slate-300">
              <span className="text-slate-200">{edge.sourceId}</span>
              <span className="text-slate-500 mx-1">
                --[{edge.type}
                {Array.isArray(edge.properties.perms)
                  ? `(${(edge.properties.perms as string[]).join(', ')})`
                  : ''}
                ]--&gt;
              </span>
              <span className="text-slate-200">{edge.targetId}</span>
            </div>
            <button
              onClick={() => removeEdge(edge.sourceId, edge.targetId, edge.type)}
              className="text-slate-500 hover:text-red-400 ml-2"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
