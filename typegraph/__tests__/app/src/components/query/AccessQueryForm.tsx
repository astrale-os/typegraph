import { useEffect, useRef } from 'react'
import { useQueryStore } from '@/store/query-store'
import { useGraphStore } from '@/store/graph-store'
import { IdentityExprBuilder } from './IdentityExprBuilder'
import { ExpressionPreview } from './ExpressionPreview'

const PERMS = ['read', 'edit', 'use', 'share']

function PrincipalToggle({
  checked,
  onChange,
  principal,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  principal: string
}) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-slate-400 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-600 bg-slate-800 text-blue-500 w-3 h-3"
      />
      Use principal identity
      {checked && principal && (
        <span className="text-slate-500">→ identity(&quot;{principal}&quot;)</span>
      )}
    </label>
  )
}

export function AccessQueryForm() {
  const {
    targetNodeId,
    permission,
    principal,
    forTypeExpr,
    forResourceExpr,
    useTypePrincipal,
    useResourcePrincipal,
    setTarget,
    setPermission,
    setPrincipal,
    setForTypeExpr,
    setForResourceExpr,
    setUseTypePrincipal,
    setUseResourcePrincipal,
  } = useQueryStore()

  const nodes = useGraphStore((s) => s.nodes)
  const identities = nodes.filter((n) => n.type === 'Identity')
  const resources = nodes.filter((n) => n.type !== 'Identity' && n.type !== 'Type')

  // Auto-populate form fields on first load (one-time)
  const didAutoPopulate = useRef(false)
  useEffect(() => {
    if (didAutoPopulate.current) return
    if (identities.length === 0 || resources.length === 0) return
    didAutoPopulate.current = true

    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!

    // Principal: random APP identity
    const apps = identities.filter((n) => n.id.startsWith('APP-'))
    if (!principal && apps.length > 0) {
      setPrincipal(pick(apps).id)
    }

    // Permission: random
    if (!permission || permission === 'read') {
      setPermission(pick(PERMS))
    }

    // Target: random module
    const modules = resources.filter((n) => n.type === 'Module')
    if (!targetNodeId && modules.length > 0) {
      setTarget(pick(modules).id)
    }

    // forResource: first USER identity
    const users = identities.filter((n) => n.id.startsWith('USER-'))
    if (!useResourcePrincipal && !forResourceExpr && users.length > 0) {
      setForResourceExpr({ kind: 'identity', id: users[0]!.id })
    }
  }, [
    identities,
    resources,
    principal,
    permission,
    targetNodeId,
    useResourcePrincipal,
    forResourceExpr,
    setPrincipal,
    setPermission,
    setTarget,
    setForResourceExpr,
  ])

  return (
    <div className="space-y-4">
      {/* Principal */}
      <div>
        <label className="text-xs text-slate-400 block mb-1">Principal</label>
        <select
          value={principal}
          onChange={(e) => setPrincipal(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="">Select principal...</option>
          {identities.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id}
            </option>
          ))}
        </select>
      </div>

      {/* Permission */}
      <div>
        <label className="text-xs text-slate-400 block mb-1">Permission</label>
        <select
          value={permission}
          onChange={(e) => setPermission(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          {PERMS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* Target Resource */}
      <div>
        <label className="text-xs text-slate-400 block mb-1">Target Resource</label>
        <select
          value={targetNodeId}
          onChange={(e) => setTarget(e.target.value)}
          className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
        >
          <option value="">Select node...</option>
          {resources.map((n) => (
            <option key={n.id} value={n.id}>
              {n.id} ({n.type})
            </option>
          ))}
        </select>
      </div>

      {/* Grant section divider */}
      <div className="border-t border-slate-700 pt-3">
        <div className="text-xs text-slate-400 font-medium mb-3">Grant</div>

        {/* Grant: forType (App Identity) */}
        <div className="space-y-1 mb-3">
          <div className="text-xs text-slate-300 font-medium">App Identity (forType)</div>
          <div className="text-[10px] text-slate-500">
            Phase 1: can this app use resources of this type?
          </div>
          <PrincipalToggle
            checked={useTypePrincipal}
            onChange={setUseTypePrincipal}
            principal={principal}
          />
          {!useTypePrincipal && (
            <IdentityExprBuilder label="forType" value={forTypeExpr} onChange={setForTypeExpr} />
          )}
        </div>

        {/* Grant: forResource (User Identity) */}
        <div className="space-y-1">
          <div className="text-xs text-slate-300 font-medium">User Identity (forResource)</div>
          <div className="text-[10px] text-slate-500">
            Phase 2: does this user have access to this resource?
          </div>
          <PrincipalToggle
            checked={useResourcePrincipal}
            onChange={setUseResourcePrincipal}
            principal={principal}
          />
          {!useResourcePrincipal && (
            <IdentityExprBuilder
              label="forResource"
              value={forResourceExpr}
              onChange={setForResourceExpr}
            />
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="space-y-2">
        <ExpressionPreview
          label="forType"
          expr={useTypePrincipal && principal ? { kind: 'identity', id: principal } : forTypeExpr}
        />
        <ExpressionPreview
          label="forResource"
          expr={
            useResourcePrincipal && principal
              ? { kind: 'identity', id: principal }
              : forResourceExpr
          }
        />
      </div>
    </div>
  )
}
