import { create } from 'zustand'
import { api } from '@/api/client'

export interface FlowStep {
  id: number
  action: string
  token?: string
  decodedPayload?: unknown
  result?: unknown
  latencyMs: number
  tokenSize?: number
  error?: string
}

interface RelayStore {
  steps: FlowStep[]
  setupDone: boolean
  loading: boolean
  error: string | null
  nextId: number

  setup: (identityIds?: string[]) => Promise<void>
  issueToken: (type: 'app' | 'user', id: string, issuer?: string) => Promise<void>
  relayToken: (expression: unknown, scopes?: unknown, ttl?: number) => Promise<void>
  authenticate: (token: string) => Promise<void>
  decodeToken: (token: string) => Promise<void>
  kernelCheckAccess: (
    token: string,
    nodeId: string,
    perm: string,
    mode?: 'check' | 'explain',
  ) => Promise<void>
  clearSteps: () => void
}

export const useRelayStore = create<RelayStore>((set, get) => ({
  steps: [],
  setupDone: false,
  loading: false,
  error: null,
  nextId: 1,

  setup: async (identityIds) => {
    set({ loading: true, error: null })
    const start = performance.now()
    try {
      await api.relaySetup(identityIds)
      const latencyMs = Math.round(performance.now() - start)
      const { nextId, steps } = get()
      set({
        steps: [
          ...steps,
          {
            id: nextId,
            action: 'Setup KernelService',
            latencyMs,
            result: { identityIds },
          },
        ],
        nextId: nextId + 1,
        setupDone: true,
        loading: false,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  issueToken: async (type, id, issuer) => {
    set({ loading: true, error: null })
    const start = performance.now()
    try {
      const res = await api.relayIssueToken({ type, id, issuer })
      const latencyMs = Math.round(performance.now() - start)
      const { nextId, steps } = get()
      set({
        steps: [
          ...steps,
          {
            id: nextId,
            action: `Issue ${type} JWT: ${id}`,
            token: res.token,
            decodedPayload: res.decoded.payload,
            latencyMs,
            tokenSize: new TextEncoder().encode(res.token).length,
          },
        ],
        nextId: nextId + 1,
        loading: false,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  relayToken: async (expression, scopes, ttl) => {
    set({ loading: true, error: null })
    const start = performance.now()
    try {
      const res = await api.relayRelayToken({ expression, scopes, ttl })
      const latencyMs = Math.round(performance.now() - start)
      const { nextId, steps } = get()
      set({
        steps: [
          ...steps,
          {
            id: nextId,
            action: 'Relay Token (kernel-signed)',
            token: res.token,
            decodedPayload: res.decoded.payload,
            latencyMs,
            tokenSize: new TextEncoder().encode(res.token).length,
            result: { expires_at: res.expires_at },
          },
        ],
        nextId: nextId + 1,
        loading: false,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  authenticate: async (token) => {
    set({ loading: true, error: null })
    const start = performance.now()
    try {
      const res = await api.relayAuthenticate({ token })
      const latencyMs = Math.round(performance.now() - start)
      const { nextId, steps } = get()
      set({
        steps: [
          ...steps,
          {
            id: nextId,
            action: 'Authenticate Token',
            latencyMs,
            result: res.authContext,
          },
        ],
        nextId: nextId + 1,
        loading: false,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  decodeToken: async (token) => {
    set({ loading: true, error: null })
    const start = performance.now()
    try {
      const res = await api.relayDecodeToken({ token })
      const latencyMs = Math.round(performance.now() - start)
      const { nextId, steps } = get()
      set({
        steps: [
          ...steps,
          {
            id: nextId,
            action: 'Decode Token',
            decodedPayload: res.payload,
            latencyMs,
          },
        ],
        nextId: nextId + 1,
        loading: false,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  kernelCheckAccess: async (token, nodeId, perm, mode = 'check') => {
    set({ loading: true, error: null })
    const start = performance.now()
    try {
      const res = await api.relayKernelCheckAccess({ token, nodeId, perm, mode })
      const latencyMs = Math.round(performance.now() - start)
      const { nextId, steps } = get()
      set({
        steps: [
          ...steps,
          {
            id: nextId,
            action: `Kernel ${mode === 'explain' ? 'explainAccess' : 'checkAccess'}`,
            latencyMs,
            result: { authContext: res.authContext, ...(res.result as Record<string, unknown>) },
          },
        ],
        nextId: nextId + 1,
        loading: false,
      })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  clearSteps: () => set({ steps: [], nextId: 1, error: null }),
}))
