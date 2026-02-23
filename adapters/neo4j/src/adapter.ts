/**
 * Neo4j Adapter Implementation
 */

import type { GraphAdapter, TransactionContext, AdapterMetrics } from '@astrale/typegraph-client'
import type { Neo4jConfig, Driver, Session, Transaction } from './types'
import { validateConfig, connectionError, notConnectedError, missingDriverError } from './errors'
import { withRetry } from './retry'
import { transformRecord } from './transform'

/**
 * Neo4j adapter implementing the GraphAdapter interface.
 */
export class Neo4jAdapter implements GraphAdapter {
  readonly name = 'neo4j'

  private readonly config: Neo4jConfig
  private driver: Driver | null = null
  private neo4jModule: typeof import('neo4j-driver') | null = null

  // Metrics
  private queryCount = 0
  private mutationCount = 0
  private totalLatencyMs = 0

  constructor(config: Neo4jConfig) {
    validateConfig(config)
    this.config = config
  }

  async connect(): Promise<void> {
    if (this.driver) return

    // Load neo4j-driver
    try {
      this.neo4jModule = await import('neo4j-driver')
    } catch {
      throw missingDriverError()
    }

    const neo4j = this.neo4jModule

    // Build auth
    const auth = this.config.auth
      ? neo4j.auth.basic(this.config.auth.username, this.config.auth.password)
      : undefined

    // Build driver config
    const driverConfig: Record<string, unknown> = {}

    if (this.config.pool?.maxSize) {
      driverConfig.maxConnectionPoolSize = this.config.pool.maxSize
    }
    if (this.config.pool?.acquisitionTimeout) {
      driverConfig.connectionAcquisitionTimeout = this.config.pool.acquisitionTimeout
    }
    if (this.config.encrypted !== undefined) {
      driverConfig.encrypted = this.config.encrypted
    }
    if (this.config.trust) {
      driverConfig.trust = this.config.trust
    }

    this.driver = neo4j.driver(this.config.uri, auth, driverConfig) as unknown as Driver

    // Verify connectivity with retry
    try {
      await withRetry(() => this.driver!.verifyConnectivity(), this.config.retry)
    } catch (error) {
      this.driver = null
      throw connectionError(this.config, error)
    }
  }

  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close()
      this.driver = null
    }
  }

  async isConnected(): Promise<boolean> {
    if (!this.driver) return false
    try {
      await this.driver.verifyConnectivity()
      return true
    } catch {
      return false
    }
  }

  async query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    return this.execute('read', cypher, params, () => this.queryCount++)
  }

  async mutate<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    return this.execute('write', cypher, params, () => this.mutationCount++)
  }

  async transaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const session = this.getSession('write')

    try {
      return await session.executeWrite(async (neoTx: Transaction) => {
        const context: TransactionContext = {
          run: async <R>(cypher: string, params?: Record<string, unknown>): Promise<R[]> => {
            const result = await neoTx.run(cypher, params)
            return result.records.map((r) => transformRecord(r.toObject())) as R[]
          },
        }
        return work(context)
      })
    } finally {
      await session.close()
    }
  }

  getMetrics(): AdapterMetrics {
    const totalOps = this.queryCount + this.mutationCount
    return {
      queriesExecuted: this.queryCount,
      mutationsExecuted: this.mutationCount,
      totalLatencyMs: this.totalLatencyMs,
      avgLatencyMs: totalOps > 0 ? this.totalLatencyMs / totalOps : 0,
      activeConnections: this.driver ? 1 : 0,
    }
  }

  // Internal helpers

  private async execute<T>(
    mode: 'read' | 'write',
    cypher: string,
    params: Record<string, unknown> | undefined,
    incrementCounter: () => void,
  ): Promise<T[]> {
    const session = this.getSession(mode)
    const start = Date.now()
    incrementCounter()

    try {
      const result = await withRetry(() => session.run(cypher, params), this.config.retry)
      return result.records.map((r) => transformRecord(r.toObject())) as T[]
    } finally {
      this.totalLatencyMs += Date.now() - start
      await session.close()
    }
  }

  private getSession(mode: 'read' | 'write'): Session {
    if (!this.driver) {
      throw notConnectedError()
    }

    const neo4j = this.neo4jModule!
    const accessMode = mode === 'read' ? neo4j.session.READ : neo4j.session.WRITE

    return this.driver.session({
      database: this.config.database,
      defaultAccessMode: accessMode,
    })
  }
}
