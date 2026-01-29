import { useProfilingStore } from '@/store/profiling-store'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  return `${(bytes / 1024).toFixed(1)}KB`
}

async function instrumentedFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const method = options?.method ?? 'GET'
  const bodyStr = typeof options?.body === 'string' ? options.body : undefined
  const requestSize = bodyStr ? new TextEncoder().encode(bodyStr).length : 0

  const start = performance.now()
  let responseSize = 0
  let error: string | undefined

  try {
    const res = await fetch(url, options)
    const text = await res.text()
    responseSize = new TextEncoder().encode(text).length
    const latencyMs = Math.round(performance.now() - start)

    useProfilingStore.getState().addRequest({
      endpoint: url,
      method,
      latencyMs,
      requestSize,
      responseSize,
      timestamp: Date.now(),
    })

    if (!res.ok) {
      const data = JSON.parse(text).catch?.(() => ({})) ?? JSON.parse(text)
      throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`)
    }

    return JSON.parse(text) as T
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start)
    error = err instanceof Error ? err.message : String(err)

    // Only add profile if we haven't already (non-network errors)
    if (responseSize === 0) {
      useProfilingStore.getState().addRequest({
        endpoint: url,
        method,
        latencyMs,
        requestSize,
        responseSize,
        timestamp: Date.now(),
        error,
      })
    }

    throw err
  }
}

function get<T>(url: string): Promise<T> {
  return instrumentedFetch<T>(url)
}

function post<T>(url: string, body?: unknown): Promise<T> {
  return instrumentedFetch<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

// Re-export with same shape as api/client.ts
import type {
  AccessDecision,
  AccessExplanation,
  Grant,
  IdentityId,
  NodeId,
  PermissionT,
} from '@authz/types'

export const instrumentedApi = {
  status: () => get<{ connected: boolean; graphName: string }>('/api/status'),

  connect: (host: string, port: number) => post<{ ok: boolean }>('/api/connect', { host, port }),

  disconnect: () => post<{ ok: boolean }>('/api/disconnect'),

  listGraphs: () => get<{ graphs: string[] }>('/api/graphs'),

  selectGraph: (name: string) =>
    post<{ ok: boolean; graphName: string }>('/api/graph/select', { name }),

  clearGraph: () => post<{ ok: boolean }>('/api/graph/clear'),

  seedGraph: () => post<{ ok: boolean; data: Record<string, unknown> }>('/api/graph/seed'),

  randomSeed: (options?: {
    spaces?: number
    modulesPerSpace?: number
    types?: number
    identities?: number
  }) => post<{ ok: boolean; summary: Record<string, unknown> }>('/api/graph/random-seed', options),

  getNodes: () =>
    get<{
      nodes: Array<{ id: string; labels: string[]; name?: string }>
    }>('/api/graph/nodes'),

  getEdges: () =>
    get<{
      edges: Array<{
        sourceId: string
        targetId: string
        type: string
        properties: Record<string, unknown>
      }>
    }>('/api/graph/edges'),

  query: <T>(query: string, params?: Record<string, unknown>) =>
    post<{ results: T[] }>('/api/query', { query, params }),

  checkAccess: (params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    perm: PermissionT
  }) => post<AccessDecision>('/api/check-access', params),

  explainAccess: (params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    perm: PermissionT
  }) => post<AccessExplanation>('/api/explain-access', params),

  // Relay endpoints
  relaySetup: () => post<{ ok: boolean }>('/api/relay/setup'),

  relayIssueToken: (params: { type: 'app' | 'user'; id: string; issuer?: string }) =>
    post<{ token: string }>('/api/relay/issue-token', params),

  relayRelayToken: (params: { expression: unknown; scopes?: unknown; ttl?: number }) =>
    post<{ token: string; expires_at: number }>('/api/relay/relay-token', params),

  relayAuthenticate: (params: { token: string }) =>
    post<{ authContext: unknown }>('/api/relay/authenticate', params),

  relayDecodeToken: (params: { token: string }) =>
    post<{ header: unknown; payload: unknown }>('/api/relay/decode-token', params),
}

export { formatBytes }
