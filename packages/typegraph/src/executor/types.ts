/**
 * Executor Type Definitions
 */

/**
 * Database connection configuration.
 */
export interface ConnectionConfig {
  uri: string;
  auth?: {
    username: string;
    password: string;
  };
  database?: string;
  pool?: {
    maxSize?: number;
    acquisitionTimeout?: number;
  };
  encrypted?: boolean;
  trust?: 'TRUST_ALL_CERTIFICATES' | 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES';
}

/**
 * Metadata about query execution.
 */
export interface QueryMetadata {
  executionTimeMs: number;
  resultCount: number;
  dbHits?: number;
  plan?: QueryPlan;
  serverVersion?: string;
}

/**
 * Query execution plan (from EXPLAIN/PROFILE).
 */
export interface QueryPlan {
  operator: string;
  arguments: Record<string, unknown>;
  identifiers: string[];
  children: QueryPlan[];
  estimatedRows?: number;
  actualRows?: number;
}

/**
 * Result of query execution.
 */
export interface ExecutionResult<T> {
  data: T;
  metadata: QueryMetadata;
}

/**
 * Transaction context for multi-query transactions.
 */
export interface TransactionContext {
  run<T>(query: string, params?: Record<string, unknown>): Promise<T[]>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

