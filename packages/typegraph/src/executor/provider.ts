/**
 * Database Driver Provider Interface
 *
 * Abstraction layer for database connections.
 * Allows plugging different database drivers (Neo4j, Memgraph, etc.)
 */

// =============================================================================
// DRIVER PROVIDER INTERFACE
// =============================================================================

/**
 * Interface for database driver providers.
 * Implement this to support different database backends.
 */
export interface DatabaseDriverProvider {
  /** Unique name for this driver (e.g., 'neo4j', 'memgraph', 'neptune') */
  readonly name: string

  /** Connect to the database */
  connect(): Promise<void>

  /** Close the connection */
  close(): Promise<void>

  /** Check if connected */
  isConnected(): Promise<boolean>

  /** Execute a query and return results */
  run<T>(query: string, params?: Record<string, unknown>): Promise<QueryResult<T>>

  /** Execute within a transaction */
  transaction<T>(work: (tx: TransactionContext) => Promise<T>, mode?: "read" | "write"): Promise<T>

  /** Get connection metrics */
  getMetrics(): ConnectionMetrics
}

/**
 * Query result from the database.
 */
export interface QueryResult<T> {
  records: T[]
  summary?: QuerySummary
}

/**
 * Query execution summary.
 */
export interface QuerySummary {
  /** Time to first result in ms */
  resultAvailableAfter?: number
  /** Total execution time in ms */
  resultConsumedAfter?: number
  /** Update statistics */
  counters?: Record<string, number>
  /** Server info */
  server?: {
    version?: string
    address?: string
  }
}

/**
 * Transaction context for executing queries within a transaction.
 */
export interface TransactionContext {
  run<T>(query: string, params?: Record<string, unknown>): Promise<T[]>
  commit(): Promise<void>
  rollback(): Promise<void>
}

/**
 * Connection pool metrics.
 */
export interface ConnectionMetrics {
  activeConnections: number
  idleConnections: number
  totalAcquisitions: number
}

/**
 * Configuration for database connections.
 */
export interface DriverConfig {
  /** Connection URI (e.g., 'bolt://localhost:7687') */
  uri: string
  /** Authentication credentials */
  auth?: {
    username: string
    password: string
  }
  /** Database name (for multi-database setups) */
  database?: string
  /** Connection pool settings */
  pool?: {
    maxSize?: number
    acquisitionTimeout?: number
  }
  /** Enable encryption */
  encrypted?: boolean
  /** Trust settings for TLS */
  trust?: string
}

/**
 * Factory function type for creating driver instances.
 */
export type DatabaseDriverFactory = (config: DriverConfig) => DatabaseDriverProvider
