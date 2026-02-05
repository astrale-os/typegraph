/**
 * Type definitions for Neo4j adapter.
 */

/**
 * Configuration for the Neo4j adapter.
 */
export interface Neo4jConfig {
  /** Bolt URI (e.g., 'bolt://localhost:7687' or 'neo4j://localhost:7687') */
  uri: string
  /** Authentication credentials */
  auth?: {
    username: string
    password: string
  }
  /** Database name (Neo4j 4.0+) */
  database?: string
  /** Connection pool settings */
  pool?: {
    maxSize?: number
    acquisitionTimeout?: number
  }
  /** Enable encryption */
  encrypted?: boolean
  /** Trust strategy for TLS certificates */
  trust?: 'TRUST_ALL_CERTIFICATES' | 'TRUST_SYSTEM_CA_SIGNED_CERTIFICATES'
  /** Retry settings for transient failures */
  retry?: {
    maxAttempts?: number
    delayMs?: number
    backoffMultiplier?: number
  }
}

// Neo4j driver types (for dynamic import)

export type Driver = {
  session: (config?: { database?: string; defaultAccessMode?: string }) => Session
  close: () => Promise<void>
  verifyConnectivity: () => Promise<void>
}

export type Session = {
  run: (query: string, params?: Record<string, unknown>) => Promise<Neo4jQueryResult>
  close: () => Promise<void>
  executeRead: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>
  executeWrite: <T>(work: (tx: Transaction) => Promise<T>) => Promise<T>
}

export type Transaction = {
  run: (query: string, params?: Record<string, unknown>) => Promise<Neo4jQueryResult>
}

export type Neo4jQueryResult = {
  records: Neo4jRecord[]
  summary: ResultSummary
}

export type Neo4jRecord = {
  keys: string[]
  get: (key: string | number) => unknown
  toObject: () => Record<string, unknown>
}

export type ResultSummary = {
  resultAvailableAfter: { toNumber: () => number }
  resultConsumedAfter: { toNumber: () => number }
  counters: {
    updates: () => Record<string, number>
  }
  server: {
    version: string
    address?: string
  }
}
