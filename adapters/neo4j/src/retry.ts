/**
 * Simple retry with exponential backoff.
 */

export interface RetryOptions {
  maxAttempts: number
  delayMs: number
  backoffMultiplier: number
}

export const DEFAULT_RETRY: RetryOptions = {
  maxAttempts: 3,
  delayMs: 1000,
  backoffMultiplier: 2,
}

/**
 * Execute a function with retry on failure.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const { maxAttempts, delayMs, backoffMultiplier } = { ...DEFAULT_RETRY, ...options }

  let lastError: Error | undefined
  let delay = delayMs

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt === maxAttempts) break

      await sleep(delay)
      delay *= backoffMultiplier
    }
  }

  throw lastError
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
