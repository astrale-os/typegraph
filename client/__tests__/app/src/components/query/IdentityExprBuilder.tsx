import { X, Undo2 } from 'lucide-react'
import { useState, useCallback, useEffect, useRef } from 'react'

import type { IdentityExpr } from '@/types/api'
import type { Scope } from '@/types/api'

import { useGraphStore } from '@/store/graph-store'

import { ScopeEditor } from './ScopeEditor'

type ExprKind = 'identity' | 'union' | 'intersect' | 'exclude'

interface ExprNode {
  kind: ExprKind
  id?: string
  scopes?: Scope[]
  left?: ExprNode
  right?: ExprNode
}

function emptyIdentity(): ExprNode {
  return { kind: 'identity', id: '' }
}

function isEmptyScope(scope: Scope): boolean {
  return (
    (!scope.nodes || scope.nodes.length === 0) &&
    (!scope.perms || scope.perms.length === 0) &&
    (!scope.principals || scope.principals.length === 0)
  )
}

function exprNodeToIdentityExpr(node: ExprNode): IdentityExpr | null {
  if (node.kind === 'identity') {
    if (!node.id?.trim()) return null
    const identity: IdentityExpr = { kind: 'identity', id: node.id.trim() }
    // Wrap in scope node if non-empty scopes exist
    const nonEmptyScopes = node.scopes?.filter((s) => !isEmptyScope(s)) ?? []
    if (nonEmptyScopes.length > 0) {
      return { kind: 'scope', scopes: nonEmptyScopes, expr: identity }
    }
    return identity
  }
  const left = node.left ? exprNodeToIdentityExpr(node.left) : null
  const right = node.right ? exprNodeToIdentityExpr(node.right) : null
  if (!left || !right) return null

  if (node.kind === 'exclude') {
    return { kind: 'exclude', base: left, excluded: [right] }
  }
  return { kind: node.kind as 'union' | 'intersect', operands: [left, right] }
}

interface ExprEditorProps {
  node: ExprNode
  onChange: (node: ExprNode) => void
  onRemove?: () => void
  /** Collapse this binary node to its left child (undo composition) */
  onCollapse?: () => void
  depth?: number
}

function ExprEditor({ node, onChange, onRemove, onCollapse, depth = 0 }: ExprEditorProps) {
  const [showScopes, setShowScopes] = useState(false)
  const nodes = useGraphStore((s) => s.nodes)
  const identities = nodes.filter((n) => n.type === 'Identity')
  const apps = identities.filter((n) => n.id.startsWith('APP-'))
  const users = identities.filter((n) => n.id.startsWith('USER-'))
  const composed = identities.filter((n) => !n.id.startsWith('APP-') && !n.id.startsWith('USER-'))

  if (node.kind === 'identity') {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1">
          <select
            value={node.id ?? ''}
            onChange={(e) => onChange({ ...node, id: e.target.value })}
            className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 flex-1 min-w-0"
          >
            <option value="">Select identity...</option>
            {apps.length > 0 && (
              <optgroup label="App Identities">
                {apps.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </optgroup>
            )}
            {users.length > 0 && (
              <optgroup label="User Identities">
                {users.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </optgroup>
            )}
            {composed.length > 0 && (
              <optgroup label="Composed Identities">
                {composed.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.id}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <button
            onClick={() => setShowScopes(!showScopes)}
            className={`text-[10px] px-1 ${showScopes ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'}`}
            title="Scopes"
          >
            S
          </button>
          {onRemove && (
            <button onClick={onRemove} className="text-slate-500 hover:text-red-400" title="Remove">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        {showScopes && (
          <ScopeEditor
            scopes={node.scopes ?? []}
            onChange={(scopes) => onChange({ ...node, scopes })}
          />
        )}
        <div className="flex gap-1">
          {(['union', 'intersect', 'exclude'] as const).map((op) => (
            <button
              key={op}
              onClick={() =>
                onChange({
                  kind: op,
                  left: { ...node },
                  right: emptyIdentity(),
                })
              }
              className="text-[10px] text-slate-500 hover:text-blue-400 px-1"
            >
              + {op}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // Binary node (union / intersect / exclude)
  const opColor =
    node.kind === 'union'
      ? 'text-blue-400'
      : node.kind === 'intersect'
        ? 'text-orange-400'
        : 'text-red-400'

  return (
    <div
      className={`border-l-2 pl-2 space-y-1 ${depth > 3 ? 'border-slate-700' : 'border-slate-600'}`}
    >
      <div className="flex items-center gap-1">
        <select
          value={node.kind}
          onChange={(e) => onChange({ ...node, kind: e.target.value as ExprKind })}
          className={`bg-transparent text-xs font-bold border-none ${opColor} cursor-pointer`}
        >
          <option value="union">UNION</option>
          <option value="intersect">INTERSECT</option>
          <option value="exclude">EXCLUDE</option>
        </select>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="text-slate-500 hover:text-amber-400"
            title="Undo: collapse to left child"
          >
            <Undo2 className="w-3 h-3" />
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} className="text-slate-500 hover:text-red-400" title="Remove">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="space-y-2">
        <ExprEditor
          node={node.left ?? emptyIdentity()}
          onChange={(left) => onChange({ ...node, left })}
          onRemove={undefined}
          depth={depth + 1}
        />
        <ExprEditor
          node={node.right ?? emptyIdentity()}
          onChange={(right) => onChange({ ...node, right })}
          onRemove={() => onChange(node.left ?? emptyIdentity())}
          depth={depth + 1}
        />
      </div>
    </div>
  )
}

interface IdentityExprBuilderProps {
  label: string
  value: IdentityExpr | null
  onChange: (expr: IdentityExpr | null) => void
}

export function IdentityExprBuilder({ label, value, onChange }: IdentityExprBuilderProps) {
  const [node, setNode] = useState<ExprNode>(value ? (value as ExprNode) : emptyIdentity())
  const userHasEdited = useRef(false)

  // Sync external value (e.g., auto-populated) — only before user edits
  useEffect(() => {
    if (!userHasEdited.current && value) {
      setNode(value as ExprNode)
    }
  }, [value])

  const handleChange = useCallback(
    (updated: ExprNode) => {
      userHasEdited.current = true
      setNode(updated)
      const expr = exprNodeToIdentityExpr(updated)
      onChange(expr)
    },
    [onChange],
  )

  // Collapse: replace the root binary node with its left child
  const handleCollapse = useCallback(() => {
    const left = node.left ?? emptyIdentity()
    userHasEdited.current = true
    setNode(left)
    onChange(exprNodeToIdentityExpr(left))
  }, [node, onChange])

  return (
    <div className="space-y-1">
      <div className="text-xs text-slate-400 font-medium">{label}</div>
      <ExprEditor
        node={node}
        onChange={handleChange}
        onCollapse={node.kind !== 'identity' ? handleCollapse : undefined}
      />
    </div>
  )
}
