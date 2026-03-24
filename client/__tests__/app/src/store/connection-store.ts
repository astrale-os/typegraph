import { create } from 'zustand'

import { api } from '@/api/client'

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface ConnectionStore {
  status: ConnectionStatus
  host: string
  port: number
  graphName: string
  error: string | null
  seedData: Record<string, unknown> | null
  initialized: boolean

  setHost: (host: string) => void
  setPort: (port: number) => void
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  selectGraph: (name: string) => Promise<void>
  seed: () => Promise<void>
  clearGraph: () => Promise<void>
  checkStatus: () => Promise<void>
  autoInit: () => Promise<void>
}

export const useConnectionStore = create<ConnectionStore>((set, get) => ({
  status: 'disconnected',
  host: 'localhost',
  port: 6379,
  graphName: '',
  error: null,
  seedData: null,
  initialized: false,

  setHost: (host) => set({ host }),
  setPort: (port) => set({ port }),

  connect: async () => {
    const { host, port } = get()
    set({ status: 'connecting', error: null })
    try {
      await api.connect(host, port)
      set({ status: 'connected' })
    } catch (err) {
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
  },

  disconnect: async () => {
    try {
      await api.disconnect()
    } finally {
      set({ status: 'disconnected', graphName: '', seedData: null })
    }
  },

  selectGraph: async (name) => {
    try {
      await api.selectGraph(name)
      set({ graphName: name, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  seed: async () => {
    try {
      const result = await api.seedGraph()
      set({ seedData: result.data, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  clearGraph: async () => {
    try {
      await api.clearGraph()
      set({ seedData: null, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  checkStatus: async () => {
    try {
      const result = await api.status()
      set({
        status: result.connected ? 'connected' : 'disconnected',
        graphName: result.graphName,
      })
    } catch {
      set({ status: 'disconnected' })
    }
  },

  autoInit: async () => {
    if (get().initialized) return
    set({ initialized: true })
    const { host, port } = get()
    try {
      set({ status: 'connecting', error: null })
      await api.connect(host, port)
      set({ status: 'connected' })
      await api.selectGraph('playground')
      const result = await api.seedGraph()
      // Set graphName only after seed completes so loadFromDB sees the seeded data
      set({ graphName: 'playground', seedData: result.data, error: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },
}))
