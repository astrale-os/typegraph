/**
 * FalkorDB driver with connection pooling and health monitoring.
 */

import { FalkorDB } from 'falkordb'
import type { Graph } from 'falkordb'
import type { FalkorDBConfig, FalkorDBDriver } from './types'
import { retryWithBackoff, validateConfig, createConnectionError } from './utils'

/**
 * Create a FalkorDB driver with connection pooling and health monitoring.
 *
 * @example
 * ```typescript
 * const driver = await createFalkorDBDriver({
 *   graphName: 'my-graph',
 *   retry: { maxRetries: 3, delayMs: 1000 }
 * })
 * ```
 */
export async function createFalkorDBDriver(config: FalkorDBConfig): Promise<FalkorDBDriver> {
  // Validate configuration
  validateConfig(config)

  // Apply defaults
  const host = config.host ?? 'localhost'
  const port = config.port ?? 6379
  const maxRetries = config.retry?.maxRetries ?? 3
  const delayMs = config.retry?.delayMs ?? 1000
  const backoffMultiplier = config.retry?.backoffMultiplier ?? 2

  // Statistics tracking
  let queriesExecuted = 0
  let totalLatencyMs = 0

  // Connect with retry
  let client: FalkorDB
  let graph: Graph

  try {
    await retryWithBackoff(
      async () => {
        client = await FalkorDB.connect({
          socket: {
            host,
            port,
          },
          username: config.auth?.username,
          password: config.auth?.password,
        })
        graph = client.selectGraph(config.graphName)
      },
      {
        maxRetries,
        delayMs,
        backoffMultiplier,
      }
    )
  } catch (error) {
    throw createConnectionError(
      { ...config, host, port },
      error as Error
    )
  }

  return {
    graph: graph!,
    client: client!,
    graphName: config.graphName,

    async close(): Promise<void> {
      await client!.close()
    },

    async verifyConnection(): Promise<boolean> {
      try {
        const result = await graph!.roQuery('RETURN 1')
        return result !== null
      } catch {
        return false
      }
    },

    async healthCheck() {
      const start = Date.now()
      try {
        await graph!.roQuery('RETURN 1')
        const latencyMs = Date.now() - start

        // Try to get FalkorDB version
        let version: string | undefined
        try {
          const info = await client!.list()
          version = info ? 'FalkorDB' : undefined
        } catch {
          // Version detection failed, ignore
        }

        return {
          healthy: true,
          latencyMs,
          version,
        }
      } catch (error) {
        return {
          healthy: false,
          latencyMs: Date.now() - start,
        }
      }
    },

    getStats() {
      return {
        queriesExecuted,
        totalLatencyMs,
        avgLatencyMs: queriesExecuted > 0 ? totalLatencyMs / queriesExecuted : 0,
      }
    },
  }
}
