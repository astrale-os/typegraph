/**
 * Query Context Proxy Implementation
 *
 * Creates runtime proxies for the `.return(q => {...})` callback.
 * These proxies track alias accesses and property accesses for AST building.
 */

import type { AnySchema, AliasMap, EdgeAliasMap, QueryContext } from '@astrale/typegraph-core'

// =============================================================================
// INTERNAL TYPES
// =============================================================================

/**
 * Information about a registered alias.
 * @internal
 */
export interface AliasInfo {
  /** User-facing alias name (e.g., 'u', 'posts') */
  userAlias: string
  /** Internal alias used in Cypher (e.g., 'n0', 'n1') */
  internalAlias: string
  /** Node label (e.g., 'user', 'post') */
  label: string
  /** Whether this alias came from an optional traversal */
  isOptional: boolean
}

/**
 * Information about an edge alias.
 * @internal
 */
export interface EdgeAliasInfo {
  userAlias: string
  internalAlias: string
  edgeType: string
  isOptional: boolean
}

/**
 * Marker for a property access within a return expression.
 * @internal
 */
export interface PropertyAccessMarker {
  readonly __propertyAccess: true
  readonly __alias: string
  readonly __property: string
}

/**
 * Marker for a full node reference within a return expression.
 * @internal
 */
export interface NodeReferenceMarker {
  readonly __nodeReference: true
  readonly __alias: string
}

/**
 * Union of all return expression markers.
 * @internal
 */
export type ReturnMarker = PropertyAccessMarker | NodeReferenceMarker

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if a value is a property access marker.
 * @internal
 */
export function isPropertyAccess(value: unknown): value is PropertyAccessMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__propertyAccess' in value &&
    (value as PropertyAccessMarker).__propertyAccess === true
  )
}

/**
 * Check if a value is a node reference marker.
 * @internal
 */
export function isNodeReference(value: unknown): value is NodeReferenceMarker {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__nodeReference' in value &&
    (value as NodeReferenceMarker).__nodeReference === true
  )
}

// =============================================================================
// PROXY CREATION
// =============================================================================

/**
 * Creates a proxy for a single node alias.
 *
 * The proxy behaves as follows:
 * - Direct use (returning the proxy): creates a NodeReferenceMarker
 * - Property access (e.g., proxy.email): creates a PropertyAccessMarker
 *
 * @internal
 */
function createNodeProxy(aliasInfo: AliasInfo): unknown {
  const marker: NodeReferenceMarker = {
    __nodeReference: true,
    __alias: aliasInfo.internalAlias,
  }

  return new Proxy(marker, {
    get(target, prop: string | symbol) {
      // Allow access to marker properties
      if (prop === '__nodeReference' || prop === '__alias') {
        return target[prop as keyof NodeReferenceMarker]
      }

      // toJSON for serialization
      if (prop === 'toJSON') {
        return () => target
      }

      // Symbol properties (Symbol.toPrimitive, etc.)
      if (typeof prop === 'symbol') {
        return undefined
      }

      // Property access - return a PropertyAccessMarker
      return {
        __propertyAccess: true,
        __alias: aliasInfo.internalAlias,
        __property: prop,
      } as PropertyAccessMarker
    },
  })
}

/**
 * Creates a proxy for an edge alias.
 * Similar to node proxy but for edges.
 *
 * @internal
 */
function createEdgeProxy(aliasInfo: EdgeAliasInfo): unknown {
  const marker = {
    __edgeReference: true,
    __alias: aliasInfo.internalAlias,
  }

  return new Proxy(marker, {
    get(target, prop: string | symbol) {
      if (prop === '__edgeReference' || prop === '__alias') {
        return target[prop as keyof typeof marker]
      }

      if (prop === 'toJSON') {
        return () => target
      }

      if (typeof prop === 'symbol') {
        return undefined
      }

      // Edge property access
      return {
        __propertyAccess: true,
        __alias: aliasInfo.internalAlias,
        __property: prop,
      } as PropertyAccessMarker
    },
  })
}

/**
 * Creates the query context object passed to `.return()` callbacks.
 *
 * @example
 * ```typescript
 * const context = createQueryContext(nodeAliases, edgeAliases)
 * const result = userCallback(context)
 * // result now contains markers for AST building
 * ```
 *
 * @internal
 */
export function createQueryContext<
  S extends AnySchema,
  Aliases extends AliasMap<S>,
  OptionalAliases extends AliasMap<S>,
  EdgeAliases extends EdgeAliasMap<S>,
>(
  nodeAliases: Map<string, AliasInfo>,
  optionalNodeAliases: Map<string, AliasInfo>,
  edgeAliases: Map<string, EdgeAliasInfo>,
): QueryContext<S, Aliases, OptionalAliases, EdgeAliases> {
  const aliasProxies = new Map<string, unknown>()

  // Create proxies for required node aliases
  for (const [userAlias, info] of nodeAliases) {
    aliasProxies.set(userAlias, createNodeProxy(info))
  }

  // Create proxies for optional node aliases
  for (const [userAlias, info] of optionalNodeAliases) {
    aliasProxies.set(userAlias, createNodeProxy({ ...info, isOptional: true }))
  }

  // Create proxies for edge aliases
  for (const [userAlias, info] of edgeAliases) {
    aliasProxies.set(userAlias, createEdgeProxy(info))
  }

  // Return a proxy that provides access to all aliases
  return new Proxy(
    {},
    {
      get(_, prop: string | symbol) {
        if (typeof prop === 'symbol') {
          return undefined
        }

        const proxy = aliasProxies.get(prop)
        if (!proxy) {
          throw new Error(
            `Unknown alias '${prop}' in return expression. ` +
              `Available aliases: ${[...aliasProxies.keys()].join(', ') || '(none)'}`
          )
        }

        return proxy
      },

      has(_, prop: string | symbol) {
        if (typeof prop === 'symbol') {
          return false
        }
        return aliasProxies.has(prop)
      },

      ownKeys() {
        return [...aliasProxies.keys()]
      },

      getOwnPropertyDescriptor(_, prop: string | symbol) {
        if (typeof prop === 'symbol') {
          return undefined
        }
        if (aliasProxies.has(prop)) {
          return {
            enumerable: true,
            configurable: true,
          }
        }
        return undefined
      },
    }
  ) as QueryContext<S, Aliases, OptionalAliases, EdgeAliases>
}

/**
 * Extracts return specification from a callback result.
 * Walks the returned object and extracts markers into a structured format.
 *
 * @internal
 */
export interface ReturnSpec {
  /** Fields that return full nodes */
  nodeFields: Map<string, { outputKey: string; alias: string }>
  /** Fields that return specific properties */
  propertyFields: Map<string, { outputKey: string; alias: string; property: string }>
  /** Fields that collect into arrays */
  collectFields: Map<string, { outputKey: string; alias: string; distinct: boolean }>
}

/**
 * Parses the return callback result into a structured specification.
 * @internal
 */
export function parseReturnSpec(result: Record<string, unknown>): ReturnSpec {
  const spec: ReturnSpec = {
    nodeFields: new Map(),
    propertyFields: new Map(),
    collectFields: new Map(),
  }

  for (const [key, value] of Object.entries(result)) {
    if (value === null || value === undefined) {
      continue
    }

    // Check for collect marker
    if (
      typeof value === 'object' &&
      '__collectMarker' in value &&
      (value as { __collectMarker: boolean }).__collectMarker
    ) {
      const collectMarker = value as unknown as { __alias: string; __distinct: boolean }
      spec.collectFields.set(key, {
        outputKey: key,
        alias: collectMarker.__alias,
        distinct: collectMarker.__distinct,
      })
      continue
    }

    // Check for property access
    if (isPropertyAccess(value)) {
      spec.propertyFields.set(key, {
        outputKey: key,
        alias: value.__alias,
        property: value.__property,
      })
      continue
    }

    // Check for node reference
    if (isNodeReference(value)) {
      spec.nodeFields.set(key, {
        outputKey: key,
        alias: value.__alias,
      })
      continue
    }

    // Unknown value type - might be a literal or nested object
    // For now, we'll throw an error for unsupported types
    throw new Error(
      `Unsupported value in return expression for key '${key}'. ` +
        `Expected q.alias, q.alias.property, or collect(q.alias).`
    )
  }

  return spec
}

/**
 * Transform raw query results according to the return specification.
 * @internal
 */
export function transformReturnResult(
  row: Record<string, unknown>,
  spec: ReturnSpec,
  _originalReturnObject: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  // Handle node reference fields (full nodes)
  for (const [outputKey, field] of spec.nodeFields) {
    result[outputKey] = row[field.alias]
  }

  // Handle property access fields (specific properties)
  for (const [outputKey, field] of spec.propertyFields) {
    const node = row[field.alias] as Record<string, unknown> | undefined
    result[outputKey] = node?.[field.property]
  }

  // Handle collect fields (arrays)
  for (const [outputKey, field] of spec.collectFields) {
    result[outputKey] = row[outputKey] ?? row[field.alias] ?? []
  }

  return result
}
