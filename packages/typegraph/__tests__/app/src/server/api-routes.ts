import type { IncomingMessage, ServerResponse } from 'node:http'
import { playgroundClient } from './falkordb-client'
import {
  handleRelaySetup,
  handleIssueToken,
  handleRelayToken,
  handleAuthenticate,
  handleDecodeToken,
  handleKernelCheckAccess,
} from './relay-service'

type RouteHandler = (body: Record<string, unknown>, res: ServerResponse) => Promise<void>

function json(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function error(res: ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status)
}

const routes: Record<string, Record<string, RouteHandler>> = {
  GET: {
    '/api/status': async (_body, res) => {
      json(res, {
        connected: playgroundClient.connected,
        graphName: playgroundClient.graphName,
      })
    },

    '/api/graphs': async (_body, res) => {
      const graphs = await playgroundClient.listGraphs()
      json(res, { graphs })
    },

    '/api/graph/nodes': async (_body, res) => {
      const nodes = await playgroundClient.getAllNodes()
      json(res, { nodes })
    },

    '/api/graph/edges': async (_body, res) => {
      const edges = await playgroundClient.getAllEdges()
      json(res, { edges })
    },
  },

  POST: {
    '/api/connect': async (body, res) => {
      const host = (body.host as string) || 'localhost'
      const port = (body.port as number) || 6379
      await playgroundClient.connect(host, port)
      json(res, { ok: true })
    },

    '/api/disconnect': async (_body, res) => {
      await playgroundClient.disconnect()
      json(res, { ok: true })
    },

    '/api/graph/select': async (body, res) => {
      const name = body.name as string
      if (!name) return error(res, 'name is required')
      await playgroundClient.selectGraph(name)
      json(res, { ok: true, graphName: name })
    },

    '/api/graph/clear': async (_body, res) => {
      await playgroundClient.clear()
      json(res, { ok: true })
    },

    '/api/graph/seed': async (_body, res) => {
      const data = await playgroundClient.seed()
      json(res, { ok: true, data })
    },

    '/api/graph/random-seed': async (body, res) => {
      const options = body as
        | {
            spaces?: number
            modulesPerSpace?: number
            types?: number
            identities?: number
          }
        | undefined
      const summary = await playgroundClient.randomSeed(options)
      json(res, { ok: true, summary })
    },

    '/api/query': async (body, res) => {
      const query = body.query as string
      if (!query) return error(res, 'query is required')
      const params = (body.params as Record<string, unknown>) || undefined
      const results = await playgroundClient.query(query, params)
      json(res, { results })
    },

    '/api/check-access': async (body, res) => {
      const { principal, grant, nodeId, perm } = body as {
        principal: string
        grant: { forType: unknown; forResource: unknown }
        nodeId: string
        perm: string
      }
      if (!principal || !grant || !nodeId || !perm) {
        return error(res, 'principal, grant, nodeId, and perm are required')
      }
      const result = await playgroundClient.checkAccess({
        principal,
        grant: grant as any,
        nodeId,
        perm,
      })
      json(res, result)
    },

    '/api/explain-access': async (body, res) => {
      const { principal, grant, nodeId, perm } = body as {
        principal: string
        grant: { forType: unknown; forResource: unknown }
        nodeId: string
        perm: string
      }
      if (!principal || !grant || !nodeId || !perm) {
        return error(res, 'principal, grant, nodeId, and perm are required')
      }
      const result = await playgroundClient.explainAccess({
        principal,
        grant: grant as any,
        nodeId,
        perm,
      })
      json(res, result)
    },

    '/api/relay/setup': async (body, res) => {
      const result = await handleRelaySetup(body)
      json(res, result)
    },

    '/api/relay/issue-token': async (body, res) => {
      const result = await handleIssueToken(body)
      json(res, result)
    },

    '/api/relay/relay-token': async (body, res) => {
      const result = await handleRelayToken(body)
      json(res, result)
    },

    '/api/relay/authenticate': async (body, res) => {
      const result = await handleAuthenticate(body)
      json(res, result)
    },

    '/api/relay/decode-token': async (body, res) => {
      const result = await handleDecodeToken(body)
      json(res, result)
    },

    '/api/relay/kernel-check-access': async (body, res) => {
      const result = await handleKernelCheckAccess(body)
      json(res, result)
    },
  },
}

export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = req.url
  if (!url?.startsWith('/api/')) return false

  const method = req.method ?? 'GET'
  const handler = routes[method]?.[url]

  if (!handler) {
    error(res, `Unknown route: ${method} ${url}`, 404)
    return true
  }

  let body: Record<string, unknown> = {}
  if (method === 'POST') {
    body = await parseBody(req)
  }

  try {
    await handler(body, res)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    error(res, message, 500)
  }

  return true
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('Invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}
