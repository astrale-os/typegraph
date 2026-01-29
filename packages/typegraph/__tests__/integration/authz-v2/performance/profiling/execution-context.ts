/**
 * Execution Context
 *
 * Uses AsyncLocalStorage to track parent-child span relationships
 * across async boundaries (Promise.all, etc.).
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Phase } from './types'

// =============================================================================
// CONTEXT TYPE
// =============================================================================

export interface ExecutionContext {
  /** Current trace ID. */
  traceId: string

  /** Current parent span ID (null for root spans). */
  parentSpanId: string | null

  /** Current execution phase. */
  phase: Phase
}

// =============================================================================
// ASYNC STORAGE
// =============================================================================

const asyncStorage = new AsyncLocalStorage<ExecutionContext>()

/**
 * Run a function with an execution context.
 * All async operations within the function will have access to this context.
 */
export function runWithContext<T>(ctx: ExecutionContext, fn: () => T): T {
  return asyncStorage.run(ctx, fn)
}

/**
 * Get the current execution context (if any).
 */
export function getContext(): ExecutionContext | undefined {
  return asyncStorage.getStore()
}

/**
 * Get the current trace ID (throws if not in a context).
 */
export function getTraceId(): string {
  const ctx = getContext()
  if (!ctx) {
    throw new Error('Not running within an execution context')
  }
  return ctx.traceId
}

/**
 * Get the current parent span ID.
 */
export function getParentSpanId(): string | null {
  return getContext()?.parentSpanId ?? null
}

/**
 * Get the current phase.
 */
export function getCurrentPhase(): Phase {
  return getContext()?.phase ?? 'query'
}

// =============================================================================
// CONTEXT HELPERS
// =============================================================================

/**
 * Create a child context with a new parent span ID.
 */
export function withParentSpan(spanId: string): ExecutionContext {
  const current = getContext()
  if (!current) {
    throw new Error('Cannot create child context: not in an execution context')
  }
  return {
    ...current,
    parentSpanId: spanId,
  }
}

/**
 * Create a child context with a different phase.
 */
export function withPhase(phase: Phase): ExecutionContext {
  const current = getContext()
  if (!current) {
    throw new Error('Cannot change phase: not in an execution context')
  }
  return {
    ...current,
    phase,
  }
}

/**
 * Run a function with a new parent span.
 */
export function runWithParentSpan<T>(spanId: string, fn: () => T): T {
  return runWithContext(withParentSpan(spanId), fn)
}

/**
 * Run a function with a different phase.
 */
export function runWithPhase<T>(phase: Phase, fn: () => T): T {
  return runWithContext(withPhase(phase), fn)
}

// =============================================================================
// ID GENERATION
// =============================================================================

let spanCounter = 0
let traceCounter = 0

/**
 * Generate a unique span ID.
 */
export function generateSpanId(): string {
  return `span_${++spanCounter}_${Date.now()}`
}

/**
 * Generate a unique trace ID.
 */
export function generateTraceId(): string {
  return `trace_${++traceCounter}_${Date.now()}`
}

/**
 * Reset ID counters (for testing).
 */
export function resetCounters(): void {
  spanCounter = 0
  traceCounter = 0
}
