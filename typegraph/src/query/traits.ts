/**
 * Shared Builder Traits
 *
 * Type definitions and utilities shared across builder types.
 */

import type { ComparisonOperator, WhereCondition, EdgeWhereCondition } from '../ast'
import type { SchemaShape } from '../schema'
import type { NodeLabels, NodeProps, EdgeTypes, EdgeProps } from '../inference'

// =============================================================================
// EDGE FILTER OPTIONS
// =============================================================================

/**
 * Options for filtering on edge properties during traversal.
 */
export interface EdgeFilterOptions<S extends SchemaShape, E extends EdgeTypes<S>> {
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
  S extends SchemaShape,
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
export interface WhereBuilder<S extends SchemaShape, N extends NodeLabels<S>> {
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

/**
 * Create a WhereBuilder instance for building query conditions.
 * Shared implementation used by all node builders.
 */
export function createWhereBuilder<S extends SchemaShape, N extends NodeLabels<S>>(
  target: string,
): WhereBuilder<S, N> {
  type Condition = import('../ast').ComparisonCondition
  type Logical = import('../ast').LogicalCondition

  return {
    eq: (field: string, value: unknown) =>
      ({ type: 'comparison', field, operator: 'eq', value, target }) as Condition,
    neq: (field: string, value: unknown) =>
      ({ type: 'comparison', field, operator: 'neq', value, target }) as Condition,
    gt: (field: string, value: unknown) =>
      ({ type: 'comparison', field, operator: 'gt', value, target }) as Condition,
    gte: (field: string, value: unknown) =>
      ({ type: 'comparison', field, operator: 'gte', value, target }) as Condition,
    lt: (field: string, value: unknown) =>
      ({ type: 'comparison', field, operator: 'lt', value, target }) as Condition,
    lte: (field: string, value: unknown) =>
      ({ type: 'comparison', field, operator: 'lte', value, target }) as Condition,
    in: (field: string, values: unknown[]) =>
      ({ type: 'comparison', field, operator: 'in', value: values, target }) as Condition,
    notIn: (field: string, values: unknown[]) =>
      ({ type: 'comparison', field, operator: 'notIn', value: values, target }) as Condition,
    contains: (field: string, substring: string) =>
      ({ type: 'comparison', field, operator: 'contains', value: substring, target }) as Condition,
    startsWith: (field: string, prefix: string) =>
      ({ type: 'comparison', field, operator: 'startsWith', value: prefix, target }) as Condition,
    endsWith: (field: string, suffix: string) =>
      ({ type: 'comparison', field, operator: 'endsWith', value: suffix, target }) as Condition,
    isNull: (field: string) =>
      ({ type: 'comparison', field, operator: 'isNull', value: undefined, target }) as Condition,
    isNotNull: (field: string) =>
      ({ type: 'comparison', field, operator: 'isNotNull', value: undefined, target }) as Condition,
    and: (...conditions: WhereCondition[]) =>
      ({ type: 'logical', operator: 'AND', conditions }) as Logical,
    or: (...conditions: WhereCondition[]) =>
      ({ type: 'logical', operator: 'OR', conditions }) as Logical,
    not: (condition: WhereCondition) =>
      ({ type: 'logical', operator: 'NOT', conditions: [condition] }) as Logical,
  } as WhereBuilder<S, N>
}

/**
 * Convert edge filter options to AST edge where conditions.
 * Handles multiple operators per field (e.g., { gt: 5, lt: 10 }).
 */
export function buildEdgeWhere(where?: Record<string, unknown>): EdgeWhereCondition[] | undefined {
  if (!where) return undefined

  const conditions: EdgeWhereCondition[] = []
  for (const [field, ops] of Object.entries(where)) {
    if (typeof ops === 'object' && ops !== null) {
      for (const [operator, value] of Object.entries(ops as Record<string, unknown>)) {
        conditions.push({ field, operator: operator as ComparisonOperator, value })
      }
    }
  }
  return conditions.length > 0 ? conditions : undefined
}
