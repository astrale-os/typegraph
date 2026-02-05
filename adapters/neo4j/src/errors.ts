/**
 * Error handling and config validation.
 */

import type { Neo4jConfig } from './types'

/**
 * Validate Neo4j configuration.
 * Throws descriptive errors for invalid config.
 */
export function validateConfig(config: Neo4jConfig): void {
  if (!config.uri) {
    throw new Error('Neo4j config: uri is required')
  }

  if (!config.uri.startsWith('bolt://') && !config.uri.startsWith('neo4j://')) {
    throw new Error(
      `Neo4j config: uri must start with 'bolt://' or 'neo4j://', got '${config.uri}'`,
    )
  }

  if (config.pool?.maxSize !== undefined && config.pool.maxSize < 1) {
    throw new Error(`Neo4j config: pool.maxSize must be >= 1, got ${config.pool.maxSize}`)
  }

  if (config.pool?.acquisitionTimeout !== undefined && config.pool.acquisitionTimeout < 0) {
    throw new Error(
      `Neo4j config: pool.acquisitionTimeout must be >= 0, got ${config.pool.acquisitionTimeout}`,
    )
  }

  if (config.retry?.maxAttempts !== undefined && config.retry.maxAttempts < 1) {
    throw new Error(`Neo4j config: retry.maxAttempts must be >= 1, got ${config.retry.maxAttempts}`)
  }
}

/**
 * Create a connection error with helpful context.
 */
export function connectionError(config: Neo4jConfig, cause: unknown): Error {
  const lines = [
    'Failed to connect to Neo4j',
    `  URI: ${config.uri}`,
    config.database ? `  Database: ${config.database}` : null,
    config.auth ? `  Auth: ${config.auth.username}` : '  Auth: none',
    `  Error: ${cause instanceof Error ? cause.message : String(cause)}`,
    '',
    'Troubleshooting:',
    '  1. Verify Neo4j is running and accessible',
    '  2. Check URI, credentials, and database name',
    '  3. Ensure firewall allows Bolt port (default 7687)',
    config.encrypted ? '  4. Verify TLS certificate configuration' : null,
  ]

  const error = new Error(lines.filter(Boolean).join('\n'))
  error.cause = cause
  return error
}

/**
 * Create an error for when adapter is not connected.
 */
export function notConnectedError(): Error {
  return new Error('Neo4j adapter not connected. Call connect() first.')
}

/**
 * Create an error for missing neo4j-driver dependency.
 */
export function missingDriverError(): Error {
  return new Error(
    'neo4j-driver is required for Neo4j connections.\n' + 'Install it with: pnpm add neo4j-driver',
  )
}
