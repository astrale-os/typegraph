import { Plus, Trash2 } from 'lucide-react'
import type { Scope } from '@/types/api'

interface ScopeEditorProps {
  scopes: Scope[]
  onChange: (scopes: Scope[]) => void
}

export function ScopeEditor({ scopes, onChange }: ScopeEditorProps) {
  const addScope = () => {
    onChange([...scopes, {}])
  }

  const removeScope = (index: number) => {
    onChange(scopes.filter((_, i) => i !== index))
  }

  const updateScope = (index: number, field: keyof Scope, value: string) => {
    const updated = [...scopes]
    const scope = { ...updated[index]! }
    const items = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (items.length > 0) {
      scope[field] = items
    } else {
      delete scope[field]
    }
    updated[index] = scope
    onChange(updated)
  }

  return (
    <div className="bg-slate-850 border border-slate-700 rounded p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">Scopes</span>
        <button onClick={addScope} className="text-slate-500 hover:text-blue-400">
          <Plus className="w-3 h-3" />
        </button>
      </div>

      {scopes.map((scope, i) => (
        <div key={i} className="bg-slate-800 rounded p-1.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Scope {i}</span>
            <button onClick={() => removeScope(i)} className="text-slate-500 hover:text-red-400">
              <Trash2 className="w-2.5 h-2.5" />
            </button>
          </div>
          <input
            type="text"
            placeholder="nodes (comma-separated)"
            value={scope.nodes?.join(', ') ?? ''}
            onChange={(e) => updateScope(i, 'nodes', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300"
          />
          <input
            type="text"
            placeholder="perms (comma-separated)"
            value={scope.perms?.join(', ') ?? ''}
            onChange={(e) => updateScope(i, 'perms', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300"
          />
          <input
            type="text"
            placeholder="principals (comma-separated)"
            value={scope.principals?.join(', ') ?? ''}
            onChange={(e) => updateScope(i, 'principals', e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] text-slate-300"
          />
        </div>
      ))}

      {scopes.length === 0 && (
        <div className="text-[10px] text-slate-600 text-center py-1">No scopes (unrestricted)</div>
      )}
    </div>
  )
}
