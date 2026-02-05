/**
 * Unified adapter interface for graph databases.
 *
 * All database adapters (Neo4j, FalkorDB, Memgraph, etc.) implement this interface.
 * This provides a consistent API for connection management, query execution, and transactions.
 */
export interface GraphAdapter {
  /** Unique identifier for this adapter (e.g., 'neo4j', 'falkordb', 'memgraph') */
  readonly name: string

  /**
   * Connect to the database.
   * Called automatically by createGraph() - fails fast if connection fails.
   */
  connect(): Promise<void>

  /**
   * Close the connection and release all resources.
   */
  close(): Promise<void>

  /**
   * Check if the adapter is currently connected.
   */
  isConnected(): Promise<boolean>

  /**
   * Execute a read query.
   */
  query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>

  /**
   * Execute a write query.
   */
  mutate<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>

  /**
   * Execute operations within a transaction.
   *
   * - On success: auto-commits
   * - On error: auto-rollbacks and rethrows
   *
   * @example
   * await adapter.transaction(async (tx) => {
   *   await tx.run('CREATE (n:User {name: $name})', { name: 'John' })
   *   await tx.run('CREATE (n:Post {title: $title})', { title: 'Hello' })
   * })
   */
  transaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T>

  /**
   * Get adapter metrics (optional).
   */
  getMetrics?(): AdapterMetrics
}

/**
 * Transaction context passed to transaction callbacks.
 */
export interface TransactionContext {
  /**
   * Execute a query within the transaction.
   */
  run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>
}

/**
 * Optional metrics for monitoring adapter health and performance.
 */
export interface AdapterMetrics {
  queriesExecuted?: number
  mutationsExecuted?: number
  transactionsExecuted?: number
  activeConnections?: number
  totalLatencyMs?: number
  avgLatencyMs?: number
  [key: string]: unknown
}
