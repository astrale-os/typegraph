/**
 * Span Collector
 *
 * Aggregates spans during execution and builds trace trees.
 * Thread-safe via isolation per trace ID.
 */

import type { Span, Trace, TraceInput, TraceOutput, Phase, SpanMetadata } from './types'
import {
  generateSpanId,
  generateTraceId,
  getContext,
  runWithContext,
  type ExecutionContext,
} from './execution-context'

// =============================================================================
// COLLECTOR CLASS
// =============================================================================

export class SpanCollector {
  private spans: Map<string, Span[]> = new Map()
  private traceInputs: Map<string, TraceInput> = new Map()
  private traceOutputs: Map<string, TraceOutput> = new Map()
  private traceNames: Map<string, string> = new Map()
  private traceStarts: Map<string, number> = new Map()

  /**
   * Start a new trace with the given input parameters.
   * Returns a context that should be used for all operations in this trace.
   */
  startTrace(name: string, input: TraceInput): { traceId: string; context: ExecutionContext } {
    const traceId = generateTraceId()
    this.spans.set(traceId, [])
    this.traceInputs.set(traceId, input)
    this.traceNames.set(traceId, name)
    this.traceStarts.set(traceId, performance.now() * 1000)

    const context: ExecutionContext = {
      traceId,
      parentSpanId: null,
      phase: 'decide',
    }

    return { traceId, context }
  }

  /**
   * End a trace and return the complete Trace object.
   */
  endTrace(traceId: string, output: TraceOutput): Trace {
    const spans = this.spans.get(traceId) ?? []
    const input = this.traceInputs.get(traceId)!
    const name = this.traceNames.get(traceId) ?? 'unknown'
    const startMicros = this.traceStarts.get(traceId) ?? 0
    const endMicros = performance.now() * 1000

    this.traceOutputs.set(traceId, output)

    // Clean up
    this.spans.delete(traceId)
    this.traceInputs.delete(traceId)
    this.traceNames.delete(traceId)
    this.traceStarts.delete(traceId)
    this.traceOutputs.delete(traceId)

    return {
      id: traceId,
      name,
      startMicros,
      endMicros,
      totalMicros: endMicros - startMicros,
      spans,
      input,
      output,
    }
  }

  /**
   * Add a span to the current trace.
   */
  addSpan(span: Span): void {
    const ctx = getContext()
    if (!ctx) return

    const spans = this.spans.get(ctx.traceId)
    if (spans) {
      spans.push(span)
    }
  }

  /**
   * Create and record a span for a synchronous operation.
   */
  recordSync<T>(name: string, phase: Phase, fn: () => T, metadata?: Partial<SpanMetadata>): T {
    const ctx = getContext()
    if (!ctx) {
      return fn()
    }

    const spanId = generateSpanId()
    const startMicros = performance.now() * 1000

    // Run the function with this span as the parent
    const childContext: ExecutionContext = {
      ...ctx,
      parentSpanId: spanId,
      phase,
    }

    const result = runWithContext(childContext, fn)

    const endMicros = performance.now() * 1000
    const durationMicros = endMicros - startMicros

    // Note: We don't infer cache hits from timing as it's unreliable.
    // The cached flag should be set explicitly via metadata if known.
    const cached = metadata?.result === 'cached' ? true : false

    const span: Span = {
      id: spanId,
      parentId: ctx.parentSpanId,
      name,
      phase,
      startMicros,
      endMicros,
      durationMicros,
      cached,
      metadata: metadata ? { ...metadata, result } : { result },
    }

    this.addSpan(span)
    return result
  }

  /**
   * Create and record a span for an async operation.
   */
  async recordAsync<T>(
    name: string,
    phase: Phase,
    fn: () => Promise<T>,
    metadata?: Partial<SpanMetadata>,
  ): Promise<T> {
    const ctx = getContext()
    if (!ctx) {
      return fn()
    }

    const spanId = generateSpanId()
    const startMicros = performance.now() * 1000

    // Run the function with this span as the parent
    const childContext: ExecutionContext = {
      ...ctx,
      parentSpanId: spanId,
      phase,
    }

    const result = await runWithContext(childContext, fn)

    const endMicros = performance.now() * 1000
    const durationMicros = endMicros - startMicros

    // Note: We don't infer cache hits from timing as it's unreliable.
    // The cached flag should be set explicitly via metadata if known.
    const cached = metadata?.result === 'cached' ? true : false

    const span: Span = {
      id: spanId,
      parentId: ctx.parentSpanId,
      name,
      phase,
      startMicros,
      endMicros,
      durationMicros,
      cached,
      metadata: metadata ? { ...metadata, result } : { result },
    }

    this.addSpan(span)
    return result
  }

  /**
   * Get all spans for a trace (for debugging).
   */
  getSpans(traceId: string): Span[] {
    return this.spans.get(traceId) ?? []
  }

  /**
   * Clear all collected data.
   */
  clear(): void {
    this.spans.clear()
    this.traceInputs.clear()
    this.traceOutputs.clear()
    this.traceNames.clear()
    this.traceStarts.clear()
  }
}

// =============================================================================
// TRACE TREE UTILITIES
// =============================================================================

export interface SpanNode {
  span: Span
  children: SpanNode[]
}

/**
 * Build a tree structure from flat spans.
 */
export function buildSpanTree(spans: Span[]): SpanNode[] {
  const nodeMap = new Map<string, SpanNode>()
  const roots: SpanNode[] = []

  // Create nodes
  for (const span of spans) {
    nodeMap.set(span.id, { span, children: [] })
  }

  // Build tree
  for (const span of spans) {
    const node = nodeMap.get(span.id)!
    if (span.parentId && nodeMap.has(span.parentId)) {
      nodeMap.get(span.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  // Sort children by start time
  function sortChildren(node: SpanNode): void {
    node.children.sort((a, b) => a.span.startMicros - b.span.startMicros)
    for (const child of node.children) {
      sortChildren(child)
    }
  }

  for (const root of roots) {
    sortChildren(root)
  }

  return roots.sort((a, b) => a.span.startMicros - b.span.startMicros)
}

/**
 * Flatten a span tree back to an array (depth-first).
 */
export function flattenSpanTree(roots: SpanNode[]): Span[] {
  const result: Span[] = []

  function visit(node: SpanNode): void {
    result.push(node.span)
    for (const child of node.children) {
      visit(child)
    }
  }

  for (const root of roots) {
    visit(root)
  }

  return result
}
