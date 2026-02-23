import { create } from 'zustand'

export interface RequestProfile {
  id: number
  endpoint: string
  method: string
  latencyMs: number
  requestSize: number
  responseSize: number
  timestamp: number
  error?: string
}

interface ProfilingStore {
  requests: RequestProfile[]
  expanded: boolean
  nextId: number

  addRequest: (profile: Omit<RequestProfile, 'id'>) => void
  toggleExpanded: () => void
  clear: () => void
}

const MAX_REQUESTS = 50

export const useProfilingStore = create<ProfilingStore>((set, get) => ({
  requests: [],
  expanded: false,
  nextId: 1,

  addRequest: (profile) => {
    const { nextId, requests } = get()
    const entry: RequestProfile = { ...profile, id: nextId }
    const updated = [entry, ...requests].slice(0, MAX_REQUESTS)
    set({ requests: updated, nextId: nextId + 1 })
  },

  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),

  clear: () => set({ requests: [], nextId: 1 }),
}))
