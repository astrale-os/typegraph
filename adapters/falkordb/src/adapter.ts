/**
 * FalkorDB Adapter Implementation
 *
 * Implements the GraphAdapter interface for FalkorDB (Redis-based graph database).
 */

import type { GraphAdapter, TransactionContext, AdapterMetrics } from '@astrale/typegraph-client'
import type { Graph } from 'falkordb'

import { FalkorDB } from 'falkordb'

import type { FalkorDBConfig } from './types'

import { validateConfig, createConnectionError } from './errors'
import { retryWithBackoff } from './retry'
import { transformResults } from './transform'

/**
 * FalkorDB QueryParam type (matches internal FalkorDB definition).
 */
type QueryParam = null | string | number | boolean | QueryParams | Array<QueryParam>

type QueryParams = {
  [key: string]: QueryParam
}

/**
 * Convert unknown params to FalkorDB QueryParam type.
 */
function toQueryParams(params: Record<string, unknown>): QueryParams {
  return params as QueryParams
}

/**
 * FalkorDB adapter implementing the GraphAdapter interface.
 */
export class FalkorDBAdapter implements GraphAdapter {
  readonly name = 'falkordb'

  private readonly config: FalkorDBConfig
  private client: FalkorDB | null = null
  private graph: Graph | null = null
  private queryCount = 0
  private mutationCount = 0
  private totalLatencyMs = 0

  constructor(config: FalkorDBConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    if (this.client) return

    // Validate configuration
    validateConfig(this.config)

    // Apply defaults
    const host = this.config.host ?? 'localhost'
    const port = this.config.port ?? 6379
    const maxRetries = this.config.retry?.maxRetries ?? 3
    const delayMs = this.config.retry?.delayMs ?? 1000
    const backoffMultiplier = this.config.retry?.backoffMultiplier ?? 2

    // Connect with retry
    try {
      await retryWithBackoff(
        async () => {
          this.client = await FalkorDB.connect({
            socket: {
              host,
              port,
            },
            username: this.config.auth?.username,
            password: this.config.auth?.password,
          })
          this.graph = this.client.selectGraph(this.config.graphName)
        },
        {
          maxRetries,
          delayMs,
          backoffMultiplier,
        },
      )
    } catch (error) {
      throw createConnectionError({ ...this.config, host, port }, error as Error)
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close()
      this.client = null
      this.graph = null
    }
  }

  async isConnected(): Promise<boolean> {
    if (!this.graph) return false

    try {
      const result = await this.graph.roQuery('RETURN 1')
      return result !== null
    } catch {
      return false
    }
  }

  async query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    if (!this.graph) {
      throw new Error('Not connected. Call connect() first.')
    }

    const start = Date.now()
    this.queryCount++

    const result = await this.graph.query(
      cypher,
      params ? { params: toQueryParams(params) } : undefined,
    )

    this.totalLatencyMs += Date.now() - start
    return transformResults(result.data) as T[]
  }

  async mutate<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    if (!this.graph) {
      throw new Error('Not connected. Call connect() first.')
    }

    const start = Date.now()
    this.mutationCount++

    // Use query for writes
    const result = await this.graph.query(
      cypher,
      params ? { params: toQueryParams(params) } : undefined,
    )

    this.totalLatencyMs += Date.now() - start
    return transformResults(result.data) as T[]
  }

  async transaction<T>(_work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    throw new Error(
      'FalkorDB does not support ACID transactions with rollback. ' +
        'Each query is committed immediately. For atomic operations, combine them into a single Cypher query using graph.mutate.raw(). ' +
        'See: https://github.com/FalkorDB/FalkorDB/discussions/504',
    )
  }

  getMetrics(): AdapterMetrics {
    return {
      queriesExecuted: this.queryCount,
      mutationsExecuted: this.mutationCount,
      totalLatencyMs: this.totalLatencyMs,
      avgLatencyMs:
        this.queryCount + this.mutationCount > 0
          ? this.totalLatencyMs / (this.queryCount + this.mutationCount)
          : 0,
      activeConnections: this.client ? 1 : 0,
    }
  }

  /**
   * Get the raw FalkorDB graph instance for advanced operations.
   */
  get rawGraph(): Graph | null {
    return this.graph
  }

  /**
   * Get the raw FalkorDB client for advanced operations.
   */
  get rawClient(): FalkorDB | null {
    return this.client
  }
}
