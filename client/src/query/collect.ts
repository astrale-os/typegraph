/**
 * Collect Aggregation Function
 *
 * Provides type-safe aggregation for `.return()` callbacks.
 * Transforms a NodeProxy into an Array type while tracking the collection
 * operation for Cypher generation.
 */

import type { NodeLabels, NodeProps, NodeProxy, OptionalNodeProxy } from '../inference'
import type { SchemaShape } from '../schema'

// =============================================================================
// COLLECT MARKER TYPES
// =============================================================================

/**
 * Internal marker for collected values.
 * Used by the return builder to identify collect operations.
 * @internal
 */
export interface CollectMarker<T> {
  readonly __collectMarker: true
  readonly __alias: string
  readonly __distinct: boolean
  readonly __type: T
}

// =============================================================================
// COLLECT FUNCTIONS
// =============================================================================

/**
 * Collect multiple nodes into an array.
 *
 * Use in `.return()` callbacks to aggregate multiple matched nodes
 * into an array in the result.
 *
 * @example
 * ```typescript
 * graph.node('user').as('u')
 *   .to('authored').as('p')
 *   .return(q => ({
 *     author: q.u,
 *     posts: collect(q.p)  // Post[]
 *   }))
 * ```
 *
 * @param proxy - A NodeProxy from the query context
 * @returns Array of node properties (type-level), CollectMarker (runtime)
 */
export function collect<S extends SchemaShape, N extends NodeLabels<S>>(
  proxy: NodeProxy<S, N>,
): Array<NodeProps<S, N>>

/**
 * Collect optional nodes into an array.
 * Optional proxies that are null/undefined result in empty arrays.
 */
export function collect<S extends SchemaShape, N extends NodeLabels<S>>(
  proxy: OptionalNodeProxy<S, N>,
): Array<NodeProps<S, N>>

// Implementation
export function collect(proxy: unknown): unknown {
  // At runtime, proxy is a Proxy object with __alias property
  const proxyObj = proxy as { __alias?: string } | undefined
  const alias = proxyObj?.__alias

  if (!alias) {
    throw new Error('collect() must be called with a query alias (e.g., q.posts)')
  }

  return {
    __collectMarker: true,
    __alias: alias,
    __distinct: false,
  } as CollectMarker<unknown>
}

/**
 * Collect distinct nodes into an array (removes duplicates).
 *
 * @example
 * ```typescript
 * .return(q => ({
 *   uniqueTags: collectDistinct(q.tags)
 * }))
 * ```
 */
export function collectDistinct<S extends SchemaShape, N extends NodeLabels<S>>(
  proxy: NodeProxy<S, N>,
): Array<NodeProps<S, N>>

export function collectDistinct<S extends SchemaShape, N extends NodeLabels<S>>(
  proxy: OptionalNodeProxy<S, N>,
): Array<NodeProps<S, N>>

// Implementation
export function collectDistinct(proxy: unknown): unknown {
  const proxyObj = proxy as { __alias?: string } | undefined
  const alias = proxyObj?.__alias

  if (!alias) {
    throw new Error('collectDistinct() must be called with a query alias (e.g., q.posts)')
  }

  return {
    __collectMarker: true,
    __alias: alias,
    __distinct: true,
  } as CollectMarker<unknown>
}

/**
 * Type guard to check if a value is a CollectMarker.
 * @internal
 */
export function isCollectMarker(value: unknown): value is CollectMarker<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__collectMarker' in value &&
    (value as CollectMarker<unknown>).__collectMarker === true
  )
}
