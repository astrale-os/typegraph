/**
 * Utility functions for FalkorDB adapter.
 */

import type { FalkorDBConfig } from './types'

/**
 * Retry a function with exponential backoff.
 *
 * @example
 * ```typescript
 * const result = await retryWithBackoff(
 *   () => client.connect(),
 *   { maxRetries: 3, delayMs: 1000, backoffMultiplier: 2 }
 * )
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: {
    maxRetries: number
    delayMs: number
    backoffMultiplier?: number
    onRetry?: (error: Error, attempt: number) => void
  }
): Promise<T> {
  const { maxRetries, delayMs, backoffMultiplier = 2, onRetry } = options
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error as Error

      if (attempt === maxRetries) break

      const delay = delayMs * Math.pow(backoffMultiplier, attempt)
      onRetry?.(lastError, attempt + 1)

      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  const error = new Error(`Failed after ${maxRetries + 1} attempts: ${lastError?.message}`)
  ;(error as any).cause = lastError
  throw error
}

/**
 * Validate FalkorDB configuration with helpful error messages.
 */
export function validateConfig(config: Partial<FalkorDBConfig>): asserts config is FalkorDBConfig {
  if (!config.graphName) {
    throw new Error(
      'FalkorDB configuration error: graphName is required\n' +
        'Example: { graphName: "my-graph", host: "localhost", port: 6379 }'
    )
  }

  if (config.port && (config.port < 1 || config.port > 65535)) {
    throw new Error(
      `FalkorDB configuration error: invalid port ${config.port}\n` +
        'Port must be between 1 and 65535'
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
