import { Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import type { NodeType } from '@/types/graph'

import { useGraphStore } from '@/store/graph-store'

const NODE_TYPES: NodeType[] = ['Root', 'Space', 'Module', 'Type', 'Identity']

export function NodeCreator() {
  const { nodes, addNode, removeNode } = useGraphStore()
  const [type, setType] = useState<NodeType>('Module')
  const [id, setId] = useState('')
  const [name, setName] = useState('')

  const handleAdd = async () => {
    if (!id.trim()) return
    await addNode(type, id.trim(), name.trim() || undefined)
    setId('')
    setName('')
  }

  return (
    <div>
      <div className="space-y-2 mb-4">
        <div className="flex gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as NodeType)}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 flex-1"
          >
            {NODE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <input
          type="text"
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="Node ID (required)"
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name (optional)"
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        />
        <button
          onClick={handleAdd}
          disabled={!id.trim()}
          className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded w-full justify-center"
        >
          <Plus className="w-3 h-3" />
          Add Node
        </button>
      </div>

      <div className="text-xs text-slate-400 mb-2">Existing Nodes ({nodes.length})</div>
      <div className="space-y-1 max-h-[300px] overflow-y-auto">
        {nodes.map((node) => (
          <div
            key={node.id}
            className="flex items-center justify-between bg-slate-800 rounded px-2 py-1.5"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 uppercase">{node.type}</span>
              <span className="text-xs text-slate-200">{node.id}</span>
              {node.name && <span className="text-[10px] text-slate-500">({node.name})</span>}
            </div>
            <button
              onClick={() => removeNode(node.id)}
              className="text-slate-500 hover:text-red-400"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
