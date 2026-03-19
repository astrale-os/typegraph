/**
 * Retry utilities for FalkorDB adapter.
 */

/**
 * Options for retry with exponential backoff.
 */
export interface RetryOptions {
  maxRetries: number
  delayMs: number
  backoffMultiplier?: number
  onRetry?: (error: Error, attempt: number) => void
}

/**
 * Default retry configuration.
 */
export const DEFAULT_RETRY: RetryOptions = {
  maxRetries: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
}

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
export async function retryWithBackoff<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
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
  // oxlint-disable-next-line no-explicit-any
  ;(error as any).cause = lastError
  throw error
}
