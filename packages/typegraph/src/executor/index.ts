/**
 * Executor Module
 *
 * Handles database connection and query execution.
 */

// Provider interface
export type {
  DatabaseDriverProvider,
  DatabaseDriverFactory,
  QueryResult,
  QuerySummary,
  TransactionContext as DriverTransactionContext,
  ConnectionMetrics,
  DriverConfig,
} from "./provider"

// Neo4j/Bolt driver (default)
export { Neo4jDriver, createNeo4jDriver } from "./neo4j"

// Query executor
export { QueryExecutor } from "./executor"

// Legacy connection manager (for backwards compatibility)
export { ConnectionManager } from "./connection"

// Types
export type { ConnectionConfig, ExecutionResult, QueryMetadata, TransactionContext } from "./types"
