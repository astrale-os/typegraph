/**
 * Type definitions for FalkorDB adapter.
 */

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
