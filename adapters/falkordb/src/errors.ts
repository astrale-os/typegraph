/**
 * Error handling utilities for FalkorDB adapter.
 */

import type { FalkorDBConfig } from './types'

/**
 * Regex for valid graph names: alphanumeric, underscore, dash only.
 */
const VALID_GRAPH_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * Validate a graph name to prevent injection attacks.
 * @throws Error if graphName contains invalid characters
 */
export function validateGraphName(graphName: string): void {
  if (!VALID_GRAPH_NAME_PATTERN.test(graphName)) {
    throw new Error(
      `FalkorDB configuration error: invalid graphName "${graphName}"\n` +
        'Graph name must contain only alphanumeric characters, underscores, and dashes.',
    )
  }
}

/**
 * Validate FalkorDB configuration with helpful error messages.
 */
export function validateConfig(config: Partial<FalkorDBConfig>): asserts config is FalkorDBConfig {
  if (!config.graphName) {
    throw new Error(
      'FalkorDB configuration error: graphName is required\n' +
        'Example: { graphName: "my-graph", host: "localhost", port: 6379 }',
    )
  }

  validateGraphName(config.graphName)

  if (config.port && (config.port < 1 || config.port > 65535)) {
    throw new Error(
      `FalkorDB configuration error: invalid port ${config.port}\n` +
        'Port must be between 1 and 65535',
    )
  }

  if (config.timeout && config.timeout < 0) {
    throw new Error('FalkorDB configuration error: timeout must be positive')
  }
}

/**
 * Create a descriptive error message for connection failures.
 */
export function createConnectionError(config: FalkorDBConfig, originalError: Error): Error {
  const message = [
    'Failed to connect to FalkorDB',
    `  Host: ${config.host}:${config.port}`,
    `  Graph: ${config.graphName}`,
    `  Error: ${originalError.message}`,
    '',
    'Troubleshooting:',
    '  1. Ensure FalkorDB is running: docker-compose up -d',
    '  2. Check if port is accessible: redis-cli -h localhost -p 6379 ping',
    '  3. Verify graph exists: GRAPH.LIST',
  ].join('\n')

  const error = new Error(message)
  ;(error as any).cause = originalError
  return error
}
