import type {
  AccessDecision,
  AccessExplanation,
  Grant,
  IdentityId,
  NodeId,
  PermissionT,
} from '@authz/types'

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

async function post<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error((data as { error?: string }).error ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
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
  relaySetup: (identityIds?: string[]) =>
    post<{ ok: boolean }>('/api/relay/setup', { identityIds }),

  relayIssueToken: (params: { type: 'app' | 'user'; id: string; issuer?: string }) =>
    post<{ token: string; decoded: { header: unknown; payload: unknown } }>(
      '/api/relay/issue-token',
      params,
    ),

  relayRelayToken: (params: { expression: unknown; scopes?: unknown; ttl?: number }) =>
    post<{
      token: string
      expires_at: number
      decoded: { header: unknown; payload: unknown }
    }>('/api/relay/relay-token', params),

  relayAuthenticate: (params: { token: string }) =>
    post<{ authContext: unknown }>('/api/relay/authenticate', params),

  relayDecodeToken: (params: { token: string }) =>
    post<{ header: unknown; payload: unknown }>('/api/relay/decode-token', params),

  relayKernelCheckAccess: (params: {
    token: string
    nodeId: string
    perm: string
    mode?: 'check' | 'explain'
  }) =>
    post<{
      authContext: unknown
      result: unknown
      mode: 'check' | 'explain'
    }>('/api/relay/kernel-check-access', params),
}
