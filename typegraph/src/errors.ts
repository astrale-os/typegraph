/**
 * Error Classes
 *
 * Inlined from @astrale/typegraph-core to remove the dependency.
 */

// ─── Base Error ──────────────────────────────────────────────

export class GraphQueryError extends Error {
  public override readonly cause?: Error

  constructor(message: string, cause?: Error) {
    super(message)
    this.name = 'GraphQueryError'
    this.cause = cause

    if (typeof (Error as { captureStackTrace?: unknown }).captureStackTrace === 'function') {
      ;(Error as { captureStackTrace: (target: Error, ctor: unknown) => void }).captureStackTrace(
        this,
        this.constructor,
      )
    }
  }
}

// ─── Query Errors ────────────────────────────────────────────

export class CardinalityError extends GraphQueryError {
  constructor(
    public readonly expected: 'one' | 'optional',
    public readonly actual: number,
  ) {
    super(
      `Cardinality error: expected ${expected === 'one' ? 'exactly one' : 'at most one'} result, got ${actual}`,
    )
    this.name = 'CardinalityError'
  }
}

export class ExecutionError extends GraphQueryError {
  constructor(
    message: string,
    public readonly cypher?: string,
    public readonly params?: Record<string, unknown>,
    cause?: Error,
  ) {
    super(message, cause)
    this.name = 'ExecutionError'
  }
}

// ─── Method System Errors ────────────────────────────────────

export class MethodNotImplementedError extends Error {
  constructor(public readonly missing: string[]) {
    super(`Missing method implementations:\n${missing.map((m) => `  - ${m}`).join('\n')}`)
    this.name = 'MethodNotImplementedError'
  }
}
