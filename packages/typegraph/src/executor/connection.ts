/**
 * Connection Manager
 *
 * Manages Bolt driver connection lifecycle.
 * Works with Neo4j, Memgraph, and other Bolt-compatible databases.
 */

import type { ConnectionConfig, TransactionContext } from "./types"

// Neo4j driver types (dynamically imported)
type Driver = {
  session: (config?: { database?: string; defaultAccessMode?: string }) => Session
  close: () => Promise<void>
  verifyConnectivity: () => Promise<void>
}

type Session = {
  run: (query: string, params?: Record<string, unknown>) => Promise<QueryResult>
  close: () => Promise<void>
  executeRead: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>
  executeWrite: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>
}

type Transaction = {
  run: (query: string, params?: Record<string, unknown>) => Promise<QueryResult>
}

type QueryResult = {
  records: Neo4jRecord[]
  summary: ResultSummary
}

type Neo4jRecord = {
  keys: string[]
  get: (key: string | number) => unknown
  toObject: () => Record<string, unknown>
}

type ResultSummary = {
  resultAvailableAfter: { toNumber: () => number }
  resultConsumedAfter: { toNumber: () => number }
  counters: {
    updates: () => Record<string, number>
  }
  server: {
    version: string
  }
  profile?: unknown
  plan?: unknown
}

/**
 * Manages database connections.
 */
export class ConnectionManager {
  private readonly config: ConnectionConfig
  private driver: Driver | null = null
  private neo4jModule: typeof import("neo4j-driver") | null = null

  constructor(config: ConnectionConfig) {
    this.config = config
  }

  async connect(): Promise<void> {
    if (this.driver) return

    // Dynamically import neo4j-driver
    try {
      this.neo4jModule = await import("neo4j-driver")
    } catch {
      throw new Error("neo4j-driver is required for database connections. Install it with: npm install neo4j-driver")
    }

    const neo4j = this.neo4jModule

    // Build auth
    const auth = this.config.auth ? neo4j.auth.basic(this.config.auth.username, this.config.auth.password) : undefined

    // Build driver config
    const driverConfig: Record<string, unknown> = {}

    if (this.config.pool) {
      if (this.config.pool.maxSize) {
        driverConfig.maxConnectionPoolSize = this.config.pool.maxSize
      }
      if (this.config.pool.acquisitionTimeout) {
        driverConfig.connectionAcquisitionTimeout = this.config.pool.acquisitionTimeout
      }
    }

    if (this.config.encrypted !== undefined) {
      driverConfig.encrypted = this.config.encrypted
    }

    if (this.config.trust) {
      driverConfig.trust = this.config.trust
    }

    this.driver = neo4j.driver(this.config.uri, auth, driverConfig) as unknown as Driver

    // Verify connectivity
    await this.driver.verifyConnectivity()
  }

  async close(): Promise<void> {
    if (this.driver) {
      await this.driver.close()
      this.driver = null
    }
  }

  getSession(mode: "read" | "write" = "read"): Session {
    if (!this.driver) {
      throw new Error("Not connected. Call connect() first.")
    }

    const neo4j = this.neo4jModule!
    const accessMode = mode === "read" ? neo4j.session.READ : neo4j.session.WRITE

    return this.driver.session({
      database: this.config.database,
      defaultAccessMode: accessMode,
    })
  }

  async transaction<T>(work: (tx: TransactionContext) => Promise<T>, mode: "read" | "write" = "write"): Promise<T> {
    const session = this.getSession(mode)

    try {
      const txWork = async (tx: Transaction) => {
        const context: TransactionContext = {
          run: async <R>(query: string, params?: Record<string, unknown>): Promise<R[]> => {
            const result = await tx.run(query, params)
            return result.records.map((r) => r.toObject()) as R[]
          },
          commit: async () => {
            // Transaction auto-commits on success
          },
          rollback: async () => {
            throw new Error("Rollback requested")
          },
        }

        return work(context)
      }

      if (mode === "read") {
        return await session.executeRead(txWork)
      } else {
        return await session.executeWrite(txWork)
      }
    } finally {
      await session.close()
    }
  }

  async run<T>(query: string, params?: Record<string, unknown>): Promise<{ records: T[]; summary: ResultSummary }> {
    const session = this.getSession("write")

    try {
      const result = await session.run(query, params)
      return {
        records: result.records.map((r) => r.toObject()) as T[],
        summary: result.summary,
      }
    } finally {
      await session.close()
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

  getMetrics(): {
    activeConnections: number
    idleConnections: number
    totalAcquisitions: number
  } {
    // Neo4j driver doesn't expose detailed pool metrics easily
    return {
      activeConnections: this.driver ? 1 : 0,
      idleConnections: 0,
      totalAcquisitions: 0,
    }
  }
}
