/**
 * Shared Builder Traits
 *
 * Composable behaviors shared across builder types.
 * Uses TypeScript mixins to avoid code duplication.
 */

import type { QueryAST } from '../ast'
import type { ComparisonOperator, WhereCondition, EdgeWhereCondition } from '../ast'
import type { AnySchema, NodeLabels, NodeProps, EdgeTypes, EdgeProps } from '../schema'
import type { AliasMap, EdgeAliasMap } from '../schema/inference'

// =============================================================================
// CONSTRUCTOR TYPE FOR MIXINS
// =============================================================================

/**
 * Generic constructor type for mixin application.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T

/**
 * Base interface that all builders must implement.
 */
export interface BuilderCore<
  S extends AnySchema,
  N extends NodeLabels<S>,
  Aliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
> {
  readonly _ast: QueryAST
  readonly _schema: S
  readonly _aliases: Aliases
  readonly _edgeAliases: EdgeAliases
  readonly currentLabel: N
}

// =============================================================================
// EDGE FILTER OPTIONS
// =============================================================================

/**
 * Options for filtering on edge properties during traversal.
 */
export interface EdgeFilterOptions<S extends AnySchema, E extends EdgeTypes<S>> {
  where?: {
    [K in keyof EdgeProps<S, E>]?: EdgePropertyCondition<EdgeProps<S, E>[K]>
  }
}

/**
 * A condition on a single edge property.
 */
export type EdgePropertyCondition<T> =
  | { eq: T }
  | { neq: T }
  | { gt: T }
  | { gte: T }
  | { lt: T }
  | { lte: T }
  | { in: T[] }
  | { notIn: T[] }
  | { isNull: true }
  | { isNotNull: true }

// =============================================================================
// TRAVERSAL OPTIONS
// =============================================================================

/**
 * Options for edge traversal.
 */
export interface TraversalOptions<
  S extends AnySchema,
  E extends EdgeTypes<S>,
> extends EdgeFilterOptions<S, E> {
  /** Minimum number of hops (default: 1) */
  minHops?: number
  /** Maximum number of hops (default: 1) */
  maxHops?: number
  /** Alias to capture the edge for returning */
  edgeAs?: string
}

// =============================================================================
// HIERARCHY OPTIONS
// =============================================================================

/**
 * Options for hierarchy traversal methods.
 */
export interface HierarchyTraversalOptions {
  /** Minimum depth (default: 1) */
  minDepth?: number
  /** Maximum depth (undefined = unlimited) */
  maxDepth?: number
  /** Include depth value in results */
  includeDepth?: boolean
  /** Alias for the depth value (default: 'depth') */
  depthAlias?: string
  /** Stop traversal when this node kind is reached (filters by label) */
  untilKind?: string
}

// =============================================================================
// REACHABLE OPTIONS
// =============================================================================

/**
 * Options for reachable() transitive closure queries.
 */
export interface ReachableOptions {
  /** Direction of traversal */
  direction?: 'out' | 'in' | 'both'
  /** Minimum depth (default: 1) */
  minDepth?: number
  /** Maximum depth (recommended to set) */
  maxDepth?: number
  /** Include depth value in results */
  includeDepth?: boolean
  /** Alias for the depth value */
  depthAlias?: string
  /** Uniqueness constraint for cycle prevention */
  uniqueness?: 'nodes' | 'edges' | 'none'
}

// =============================================================================
// WHERE BUILDER INTERFACE
// =============================================================================

/**
 * Fluent where condition builder.
 */
export interface WhereBuilder<S extends AnySchema, N extends NodeLabels<S>> {
  eq<K extends keyof NodeProps<S, N> & string>(field: K, value: NodeProps<S, N>[K]): WhereCondition
  neq<K extends keyof NodeProps<S, N> & string>(field: K, value: NodeProps<S, N>[K]): WhereCondition
  gt<K extends keyof NodeProps<S, N> & string>(field: K, value: NodeProps<S, N>[K]): WhereCondition
  gte<K extends keyof NodeProps<S, N> & string>(field: K, value: NodeProps<S, N>[K]): WhereCondition
  lt<K extends keyof NodeProps<S, N> & string>(field: K, value: NodeProps<S, N>[K]): WhereCondition
  lte<K extends keyof NodeProps<S, N> & string>(field: K, value: NodeProps<S, N>[K]): WhereCondition
  in<K extends keyof NodeProps<S, N> & string>(
    field: K,
    values: NodeProps<S, N>[K][],
  ): WhereCondition
  notIn<K extends keyof NodeProps<S, N> & string>(
    field: K,
    values: NodeProps<S, N>[K][],
  ): WhereCondition
  contains<K extends keyof NodeProps<S, N> & string>(field: K, substring: string): WhereCondition
  startsWith<K extends keyof NodeProps<S, N> & string>(field: K, prefix: string): WhereCondition
  endsWith<K extends keyof NodeProps<S, N> & string>(field: K, suffix: string): WhereCondition
  isNull<K extends keyof NodeProps<S, N> & string>(field: K): WhereCondition
  isNotNull<K extends keyof NodeProps<S, N> & string>(field: K): WhereCondition
  and(...conditions: WhereCondition[]): WhereCondition
  or(...conditions: WhereCondition[]): WhereCondition
  not(condition: WhereCondition): WhereCondition
}

// =============================================================================
// SHARED HELPER FUNCTIONS
// =============================================================================

/**
 * Resolve hierarchy edge from schema or explicit parameter.
 */
export function resolveHierarchyEdge<S extends AnySchema>(schema: S, edge?: EdgeTypes<S>): string {
  if (edge) return edge as string
  const hierarchy = schema.hierarchy
  if (!hierarchy?.defaultEdge) {
    throw new Error('No hierarchy edge specified and schema has no default hierarchy configuration')
  }
  return hierarchy.defaultEdge
}

/**
 * Get hierarchy direction from schema.
 */
export function getHierarchyDirection<S extends AnySchema>(schema: S): 'up' | 'down' {
  const hierarchy = schema.hierarchy
  return hierarchy?.direction ?? 'up'
}

/**
 * Parse hierarchy method arguments (edge or options).
 */
export function parseHierarchyArgs<S extends AnySchema>(
  edgeOrOptions?: EdgeTypes<S> | HierarchyTraversalOptions,
  options?: HierarchyTraversalOptions,
): [EdgeTypes<S> | undefined, HierarchyTraversalOptions | undefined] {
  if (typeof edgeOrOptions === 'string') {
    return [edgeOrOptions as EdgeTypes<S>, options]
  }
  return [undefined, edgeOrOptions as HierarchyTraversalOptions | undefined]
}

/**
 * Convert edge filter options to AST edge where conditions.
 */
export function buildEdgeWhere<S extends AnySchema, E extends EdgeTypes<S>>(
  options: EdgeFilterOptions<S, E> | undefined,
): EdgeWhereCondition[] | undefined {
  if (!options?.where) return undefined

  const conditions: EdgeWhereCondition[] = []
  for (const [field, condition] of Object.entries(options.where)) {
    if (condition && typeof condition === 'object') {
      const op = Object.keys(condition)[0] as ComparisonOperator
      const value = (condition as Record<string, unknown>)[op]
      conditions.push({ field, operator: op, value })
    }
  }
  return conditions.length > 0 ? conditions : undefined
}
