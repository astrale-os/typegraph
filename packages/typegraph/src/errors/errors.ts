/**
 * Custom Error Classes
 */

/**
 * Base error for all graph query errors.
 */
export class GraphQueryError extends Error {
  public override readonly cause?: Error

  constructor(message: string, cause?: Error) {
    super(message)
    this.name = 'GraphQueryError'
    this.cause = cause

    // V8-specific stack trace capture (not in TypeScript's lib)
    if (typeof (Error as { captureStackTrace?: unknown }).captureStackTrace === 'function') {
      ;(Error as { captureStackTrace: (target: Error, ctor: unknown) => void }).captureStackTrace(
        this,
        this.constructor,
      )
    }
  }
}

/**
 * Schema validation error.
 * Thrown when data doesn't match the schema.
 */
export class SchemaValidationError extends GraphQueryError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly expected?: string,
    public readonly received?: unknown,
  ) {
    super(message)
    this.name = 'SchemaValidationError'
  }
}

/**
 * Cardinality error.
 * Thrown when expected one result but got zero or multiple.
 */
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

/**
 * Not found error.
 * Thrown when a required node doesn't exist.
 */
export class NotFoundError extends GraphQueryError {
  constructor(
    public readonly nodeLabel?: string,
    public readonly nodeId?: string,
  ) {
    const details =
      nodeLabel && nodeId ? ` (${nodeLabel} with id ${nodeId})` : nodeLabel ? ` (${nodeLabel})` : ''
    super(`Node not found${details}`)
    this.name = 'NotFoundError'
  }
}

/**
 * Connection error.
 * Thrown when database connection fails.
 */
export class ConnectionError extends GraphQueryError {
  constructor(
    message: string,
    public readonly uri?: string,
    cause?: Error,
  ) {
    super(message, cause)
    this.name = 'ConnectionError'
  }
}

/**
 * Compilation error.
 * Thrown when AST cannot be compiled to Cypher.
 */
export class CompilationError extends GraphQueryError {
  constructor(
    message: string,
    public readonly step?: string,
    cause?: Error,
  ) {
    super(message, cause)
    this.name = 'CompilationError'
  }
}

/**
 * Execution error.
 * Thrown when query execution fails.
 */
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

/**
 * Timeout error.
 * Thrown when query exceeds timeout.
 */
export class TimeoutError extends GraphQueryError {
  constructor(
    public readonly timeoutMs: number,
    public readonly cypher?: string,
  ) {
    super(`Query timed out after ${timeoutMs}ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * Alias error.
 * Thrown when using an unregistered alias or duplicate alias.
 */
export class AliasError extends GraphQueryError {
  constructor(
    message: string,
    public readonly alias: string,
    public readonly availableAliases?: string[],
  ) {
    super(message)
    this.name = 'AliasError'
  }
}
