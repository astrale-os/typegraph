/**
 * Type definitions for FalkorDB adapter.
 */

import type { Graph } from 'falkordb'

/**
 * FalkorDB client type (re-exported to avoid namespace issues)
 */
export type FalkorDBClient = {
  selectGraph(graphId: string): Graph
  list(): Promise<string[]>
  close(): Promise<void>
}

/**
 * FalkorDB connection configuration.
 */
export interface FalkorDBConfig {
  /** FalkorDB host (default: 'localhost') */
  host?: string
  /** FalkorDB port (default: 6379) */
  port?: number
  /** Graph name (required) */
  graphName: string
  /** Optional authentication */
  auth?: {
    username?: string
    password?: string
  }
  /** Connection retry configuration */
  retry?: {
    maxRetries?: number
    delayMs?: number
    backoffMultiplier?: number
  }
  /** Connection timeout in ms (default: 5000) */
  timeout?: number
}

/**
 * FalkorDB driver interface with connection management.
 */
export interface FalkorDBDriver {
  /** FalkorDB graph instance */
  readonly graph: Graph
  /** FalkorDB client instance */
  readonly client: FalkorDBClient
  /** Graph name */
  readonly graphName: string
  /** Close connection */
  close: () => Promise<void>
  /** Verify connection is alive */
  verifyConnection: () => Promise<boolean>
  /** Health check with latency */
  healthCheck: () => Promise<{
    healthy: boolean
    latencyMs: number
    version?: string
  }>
  /** Get connection statistics */
  getStats: () => {
    queriesExecuted: number
    totalLatencyMs: number
    avgLatencyMs: number
  }
}

/**
 * FalkorDB node type.
 */
export interface FalkorNode {
  id: number
  labels: string[]
  properties: Record<string, unknown>
}

/**
 * FalkorDB relationship type.
 */
export interface FalkorRelationship {
  id: number
  relationshipType: string
  properties: Record<string, unknown>
}
