import { create } from 'zustand'
import { api } from '@/api/client'
import type {
  AccessDecision,
  AccessExplanation,
  IdentityExpr,
  PerformanceProfile,
} from '@/types/api'

interface QueryStore {
  targetNodeId: string
  permission: string
  principal: string
  forTypeExpr: IdentityExpr | null
  forResourceExpr: IdentityExpr | null
  useTypePrincipal: boolean
  useResourcePrincipal: boolean

  checkResult: AccessDecision | null
  explainResult: AccessExplanation | null
  profile: PerformanceProfile | null
  loading: boolean
  error: string | null

  setTarget: (nodeId: string) => void
  setPermission: (perm: string) => void
  setPrincipal: (principal: string) => void
  setForTypeExpr: (expr: IdentityExpr | null) => void
  setForResourceExpr: (expr: IdentityExpr | null) => void
  setUseTypePrincipal: (use: boolean) => void
  setUseResourcePrincipal: (use: boolean) => void
  runCheck: () => Promise<void>
  runExplain: () => Promise<void>
  clearResults: () => void
}

export const useQueryStore = create<QueryStore>((set, get) => ({
  targetNodeId: '',
  permission: 'read',
  principal: '',
  forTypeExpr: null,
  forResourceExpr: null,
  useTypePrincipal: true,
  useResourcePrincipal: false,
  checkResult: null,
  explainResult: null,
  profile: null,
  loading: false,
  error: null,

  setTarget: (nodeId) => set({ targetNodeId: nodeId }),
  setPermission: (perm) => set({ permission: perm }),
  setPrincipal: (principal) => set({ principal }),
  setForTypeExpr: (expr) => set({ forTypeExpr: expr }),
  setForResourceExpr: (expr) => set({ forResourceExpr: expr }),
  setUseTypePrincipal: (use) => set({ useTypePrincipal: use }),
  setUseResourcePrincipal: (use) => set({ useResourcePrincipal: use }),

  runCheck: async () => {
    const {
      targetNodeId,
      permission,
      principal,
      forTypeExpr,
      forResourceExpr,
      useTypePrincipal,
      useResourcePrincipal,
    } = get()

    if (!targetNodeId || !permission || !principal) {
      set({ error: 'Target resource, permission, and principal are required' })
      return
    }

    const effectiveForType: IdentityExpr = useTypePrincipal
      ? { kind: 'identity', id: principal }
      : (forTypeExpr ?? { kind: 'identity', id: principal })

    const effectiveForResource: IdentityExpr = useResourcePrincipal
      ? { kind: 'identity', id: principal }
      : (forResourceExpr ?? { kind: 'identity', id: principal })

    set({ loading: true, error: null, checkResult: null, profile: null })
    try {
      const { profile, ...result } = await api.checkAccess({
        principal,
        grant: { forType: effectiveForType, forResource: effectiveForResource },
        nodeId: targetNodeId,
        perm: permission,
      })
      set({ checkResult: result, profile, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  runExplain: async () => {
    const {
      targetNodeId,
      permission,
      principal,
      forTypeExpr,
      forResourceExpr,
      useTypePrincipal,
      useResourcePrincipal,
    } = get()

    if (!targetNodeId || !permission || !principal) {
      set({ error: 'Target resource, permission, and principal are required' })
      return
    }

    const effectiveForType: IdentityExpr = useTypePrincipal
      ? { kind: 'identity', id: principal }
      : (forTypeExpr ?? { kind: 'identity', id: principal })

    const effectiveForResource: IdentityExpr = useResourcePrincipal
      ? { kind: 'identity', id: principal }
      : (forResourceExpr ?? { kind: 'identity', id: principal })

    set({ loading: true, error: null, explainResult: null, profile: null })
    try {
      const { profile, ...result } = await api.explainAccess({
        principal,
        grant: { forType: effectiveForType, forResource: effectiveForResource },
        nodeId: targetNodeId,
        perm: permission,
      })
      set({ explainResult: result, profile, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  clearResults: () => set({ checkResult: null, explainResult: null, profile: null, error: null }),
}))
