/**
 * AST Node Type Definitions
 *
 * The AST represents a query as a tree of operations.
 * This enables:
 * - Query optimization before compilation
 * - Multiple backend targets (Cypher, Gremlin, etc.)
 * - Query introspection and debugging
 */

// =============================================================================
// COMPARISON OPERATORS
// =============================================================================

export type ComparisonOperator =
  | 'eq' // =
  | 'neq' // !=
  | 'gt' // >
  | 'gte' // >=
  | 'lt' // <
  | 'lte' // <=
  | 'in' // IN [...]
  | 'notIn' // NOT IN [...]
  | 'contains' // String contains
  | 'startsWith' // String starts with
  | 'endsWith' // String ends with
  | 'isNull' // IS NULL
  | 'isNotNull' // IS NOT NULL

// =============================================================================
// CONDITION VALUES
// =============================================================================

/**
 * Represents a value in a condition - either a literal or a named parameter.
 *
 * - `literal`: Value is inlined into the query (use for discriminating values)
 * - `param`: Value is passed as a parameter (use for user input, enables plan caching)
 *
 * @example
 * // Literal - value is part of the query string
 * { kind: 'literal', value: 'active' }
 *
 * // Parameter - value is passed separately
 * { kind: 'param', name: 'status' }
 */
export type ConditionValue =
  | { kind: 'literal'; value: unknown }
  | { kind: 'param'; name: string }

// =============================================================================
// WHERE CONDITIONS
// =============================================================================

/**
 * A single comparison condition on a node or edge property.
 */
export interface ComparisonCondition {
  type: 'comparison'
  /** The property name */
  field: string
  /** The comparison operator */
  operator: ComparisonOperator
  /** The value to compare against (undefined for isNull/isNotNull) */
  value?: unknown
  /** The alias of the node/edge this condition applies to */
  target: string
}

/**
 * Logical combination of conditions.
 */
export interface LogicalCondition {
  type: 'logical'
  operator: 'AND' | 'OR' | 'NOT'
  conditions: WhereCondition[]
}

/**
 * Filter nodes by label presence.
 * Used for multi-label node queries.
 */
export interface LabelCondition {
  type: 'label'
  /** Labels to check for */
  labels: string[]
  /** Check mode: 'all' = node must have ALL labels, 'any' = node must have ANY label */
  mode: 'all' | 'any'
  /** Whether to negate the condition */
  negated: boolean
  /** The alias of the node this condition applies to */
  target: string
}

/**
 * Compare fields across two different aliased nodes.
 * Used in pattern matching for cross-alias comparisons.
 *
 * @example
 * // user.createdAt < project.startDate
 * { type: 'aliasComparison', leftAlias: 'user', leftField: 'createdAt', operator: 'lt', rightAlias: 'project', rightField: 'startDate' }
 */
export interface AliasComparisonCondition {
  type: 'aliasComparison'
  leftAlias: string
  leftField: string
  operator: ComparisonOperator
  rightAlias: string
  rightField: string
}

export type WhereCondition =
  | ComparisonCondition
  | LogicalCondition
  | LabelCondition
  | SubqueryCondition
  | AliasComparisonCondition

/**
 * Condition specifically for edge properties during traversal.
 */
export interface EdgeWhereCondition {
  field: string
  operator: ComparisonOperator
  value?: unknown
}

// =============================================================================
// VARIABLE LENGTH PATH CONFIG
// =============================================================================

/**
 * Configuration for variable-length path traversal.
 */
export interface VariableLengthConfig {
  /** Minimum number of hops (default: 1) */
  min: number

  /** Maximum number of hops (undefined = unbounded) */
  max?: number

  /**
   * Uniqueness constraint for cycle prevention.
   * - 'nodes': No node can appear twice in the path
   * - 'edges': No edge can be traversed twice
   * - 'none': No constraint (use with caution!)
   */
  uniqueness: 'nodes' | 'edges' | 'none'
}

// =============================================================================
// AST STEPS
// =============================================================================

/**
 * Match a node by label.
 */
export interface MatchStep {
  type: 'match'
  /** Node label to match */
  label: string
  /** Variable name for this node in the query */
  alias: string
}

/**
 * Match a node by ID without specifying label.
 * Useful for polymorphic queries where the node type is unknown.
 */
export interface MatchByIdStep {
  type: 'matchById'
  /** The node ID to match */
  id: string
  /** Variable name for this node in the query */
  alias: string
}

/**
 * Traverse an edge to connected nodes.
 * Supports single edge or multiple edges (for toAny/fromAny/viaAny).
 */
export interface TraversalStep {
  type: 'traversal'
  /** Edge type(s) to traverse - single string or array for multi-edge */
  edges: string[]
  /** Direction of traversal */
  direction: 'out' | 'in' | 'both'
  /** Source node alias */
  fromAlias: string
  /** Target node alias */
  toAlias: string
  /** Target node label(s) - can be union for multi-edge traversal */
  toLabels: string[]
  /** Variable length path config (if applicable) */
  variableLength?: VariableLengthConfig
  /** Alias for the edge itself (for edge property filtering/returning) */
  edgeAlias?: string
  /** User-facing edge alias (if captured via toWithEdge) */
  edgeUserAlias?: string
  /** Whether this is an OPTIONAL MATCH */
  optional: boolean
  /** Cardinality hint (for optimization) - 'mixed' when multi-edge with different cardinalities */
  cardinality: 'one' | 'many' | 'optional' | 'mixed'
  /** Conditions on edge properties */
  edgeWhere?: EdgeWhereCondition[]
}

/**
 * Filter nodes/edges by conditions.
 */
export interface WhereStep {
  type: 'where'
  conditions: WhereCondition[]
}

/**
 * Register a user-facing alias for a node.
 */
export interface AliasStep {
  type: 'alias'
  /** The internal alias being registered */
  internalAlias: string
  /** The user-facing alias name */
  userAlias: string
  /** The node label */
  label: string
}

/**
 * Branch operations (UNION, INTERSECT, EXCEPT).
 */
export interface BranchStep {
  type: 'branch'
  /**
   * Set operation to apply:
   * - 'union': combine all results (UNION ALL or UNION based on distinct)
   * - 'intersect': results present in all branches
   * - 'except': results in first branch but not in others (set difference)
   */
  operator: 'union' | 'intersect' | 'except'
  branches: ASTNode[][]
  /** Whether to remove duplicates (UNION vs UNION ALL) */
  distinct: boolean
}

/**
 * Shortest path or all paths between nodes.
 */
export interface PathStep {
  type: 'path'
  algorithm: 'shortestPath' | 'allShortestPaths' | 'allPaths'
  fromAlias: string
  toAlias: string
  edge: string
  direction: 'out' | 'in' | 'both'
  maxHops?: number
  /** Alias for the path variable */
  pathAlias: string
}

/**
 * Aggregation operation.
 */
export interface AggregateStep {
  type: 'aggregate'
  /** Fields to group by (empty = aggregate all) */
  groupBy: Array<{ alias: string; field: string }>
  /** Aggregation functions to apply */
  aggregations: Array<{
    function: 'count' | 'sum' | 'avg' | 'min' | 'max' | 'collect'
    field?: string
    sourceAlias?: string
    resultAlias: string
    distinct?: boolean
  }>
}

/**
 * Order results.
 */
export interface OrderByStep {
  type: 'orderBy'
  fields: Array<{
    field: string
    direction: 'ASC' | 'DESC'
    /** Alias of the node this field belongs to */
    target: string
  }>
}

/**
 * Limit result count.
 */
export interface LimitStep {
  type: 'limit'
  count: number
}

/**
 * Skip results (for pagination).
 */
export interface SkipStep {
  type: 'skip'
  count: number
}

/**
 * Distinct results.
 */
export interface DistinctStep {
  type: 'distinct'
}

/**
 * Hierarchical navigation operation.
 * Used for tree-specific traversals like ancestors, descendants, siblings.
 */
export interface HierarchyStep {
  type: 'hierarchy'
  /** The type of hierarchical operation */
  operation: 'ancestors' | 'descendants' | 'siblings' | 'root' | 'parent' | 'children'
  /** Edge type that defines the hierarchy */
  edge: string
  /** Source node alias */
  fromAlias: string
  /** Target node alias */
  toAlias: string
  /** Minimum depth (default: 1) */
  minDepth?: number
  /** Maximum depth for ancestors/descendants (undefined = unlimited) */
  maxDepth?: number
  /** Direction of the hierarchy edge ('up' = to parent, 'down' = to children) */
  hierarchyDirection: 'up' | 'down'
  /** Whether to include depth in results */
  includeDepth?: boolean
  /** Alias for the depth value in results */
  depthAlias?: string
  /** Include the starting node itself at depth 0 (for selfAndAncestors/selfAndDescendants) */
  includeSelf?: boolean
  /** Target node kind to filter by (stops traversal when this kind is reached) */
  untilKind?: string
  /** Target node label for proper Cypher label matching (derived from edge definition) */
  targetLabel?: string
}

/**
 * Reachable step for transitive closure queries.
 * Finds all nodes reachable via any path through specified edges.
 */
export interface ReachableStep {
  type: 'reachable'
  /** Edge types to traverse (can be multiple for multi-edge reachability) */
  edges: string[]
  /** Direction of traversal */
  direction: 'out' | 'in' | 'both'
  /** Source node alias */
  fromAlias: string
  /** Target node alias */
  toAlias: string
  /** Minimum depth (default: 1) */
  minDepth?: number
  /** Maximum depth (undefined = unlimited, but recommended to set for safety) */
  maxDepth?: number
  /** Whether to include depth in results */
  includeDepth?: boolean
  /** Alias for depth value */
  depthAlias?: string
  /** Uniqueness constraint */
  uniqueness: 'nodes' | 'edges' | 'none'
  /** Include the starting node itself at depth 0 (for selfAndReachable) */
  includeSelf?: boolean
}

/**
 * Fork step for fan-out patterns.
 * Enables multiple independent traversals from the same source node.
 */
export interface ForkStep {
  type: 'fork'
  /** The alias to fork from (source node) */
  sourceAlias: string
  /** Each branch is a sequence of AST steps starting from sourceAlias */
  branches: Array<{
    steps: ASTNode[]
    /** User aliases created in this branch */
    userAliases: Record<string, string>
    /** Edge user aliases created in this branch */
    edgeUserAliases: Record<string, string>
  }>
}

// =============================================================================
// PATTERN MATCHING
// =============================================================================

/**
 * A node in a pattern match.
 */
export interface PatternNode {
  /** Internal alias for this node */
  alias: string
  /** User-facing alias (if different from internal) */
  userAlias?: string
  /** Node labels to match */
  labels?: string[]
  /** Match node by specific ID */
  id?: string
  /** Inline conditions on this node */
  where?: WhereCondition[]
}

/**
 * An edge in a pattern match.
 */
export interface PatternEdge {
  /** Internal alias for this edge (optional) */
  alias?: string
  /** User-facing alias */
  userAlias?: string
  /** Edge types to match (can be multiple with OR semantics) */
  types: string[]
  /** Traversal direction */
  direction: 'out' | 'in' | 'both'
  /** Source node alias */
  from: string
  /** Target node alias */
  to: string
  /** Variable-length path configuration */
  variableLength?: VariableLengthConfig
  /** Inline conditions on this edge */
  where?: EdgeWhereCondition[]
  /** Whether this edge is optional (LEFT JOIN semantics) */
  optional: boolean
}

/**
 * A declarative pattern matching step.
 *
 * Unlike sequential traversals, patterns allow expressing complex graph
 * shapes like diamonds, cycles, and multi-point joins in a single step.
 *
 * @example
 * // Diamond pattern: A -> B, A -> C, B -> D, C -> D
 * {
 *   type: 'pattern',
 *   nodes: [
 *     { alias: 'a', labels: ['A'] },
 *     { alias: 'b', labels: ['B'] },
 *     { alias: 'c', labels: ['C'] },
 *     { alias: 'd', labels: ['D'] },
 *   ],
 *   edges: [
 *     { from: 'a', to: 'b', types: ['E1'], direction: 'out', optional: false },
 *     { from: 'a', to: 'c', types: ['E2'], direction: 'out', optional: false },
 *     { from: 'b', to: 'd', types: ['E3'], direction: 'out', optional: false },
 *     { from: 'c', to: 'd', types: ['E4'], direction: 'out', optional: false },
 *   ],
 * }
 */
export interface PatternStep {
  type: 'pattern'
  /** All nodes in the pattern */
  nodes: PatternNode[]
  /** All edges connecting the nodes */
  edges: PatternEdge[]
}

// =============================================================================
// SUBQUERY SUPPORT
// =============================================================================

/**
 * A subquery condition used in WHERE clauses.
 *
 * Replaces `ExistsCondition` and `ConnectedToCondition` with a unified,
 * more powerful construct.
 *
 * Discriminated union by `mode` field: countPredicate is REQUIRED when
 * mode='count' and FORBIDDEN when mode='exists'|'notExists'.
 */
export type SubqueryCondition =
  | SubqueryExistsCondition
  | SubqueryNotExistsCondition
  | SubqueryCountCondition

/** Base fields shared by all subquery condition modes */
interface SubqueryConditionBase {
  type: 'subquery'
  /** The subquery AST nodes */
  query: ASTNode[]
  /** Aliases from outer query that this subquery references */
  correlatedAliases: string[]
}

/** EXISTS subquery - checks if subquery returns any results */
export interface SubqueryExistsCondition extends SubqueryConditionBase {
  mode: 'exists'
}

/** NOT EXISTS subquery - checks if subquery returns no results */
export interface SubqueryNotExistsCondition extends SubqueryConditionBase {
  mode: 'notExists'
}

/** COUNT subquery - compares count of subquery results */
export interface SubqueryCountCondition extends SubqueryConditionBase {
  mode: 'count'
  /** How to compare the count */
  countPredicate: {
    operator: ComparisonOperator
    value: number
  }
}

/**
 * A correlated subquery step in the main query pipeline.
 *
 * Used when subquery results need to be joined back to the main query
 * (e.g., for aggregations or additional filtering).
 *
 * Compiles to: CALL { WITH <correlated> ... RETURN <exported> }
 */
export interface SubqueryStep {
  type: 'subquery'
  /** Aliases from outer query imported into subquery */
  correlatedAliases: string[]
  /** AST steps of the subquery */
  steps: ASTNode[]
  /** Aliases exported from subquery to outer query */
  exportedAliases: string[]
}

// =============================================================================
// PROJECTION AS PIPELINE STEP
// =============================================================================

/**
 * Operators for computed expressions in projections.
 */
export type ComputedOperator =
  // Arithmetic
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'divide'
  | 'modulo'
  // Type conversions
  | 'toString'
  | 'toInteger'
  | 'toFloat'
  | 'toBoolean'
  // String functions
  | 'trim'
  | 'toLower'
  | 'toUpper'
  | 'substring'
  | 'concat'
  | 'split'
  | 'replace'
  // Collection functions
  | 'size'
  | 'head'
  | 'tail'
  | 'last'
  | 'reverse'
  // Null handling
  | 'coalesce'
  | 'nullIf'

/**
 * An expression that can be computed in a projection.
 * Recursive type supporting nested expressions.
 */
export type ProjectionExpression =
  | { type: 'field'; alias: string; field: string }
  | { type: 'literal'; value: unknown }
  | { type: 'param'; name: string }
  | {
      type: 'computed'
      operator: ComputedOperator
      operands: ProjectionExpression[]
    }
  | {
      type: 'case'
      branches: Array<{
        when: WhereCondition
        then: ProjectionExpression
      }>
      else?: ProjectionExpression
    }
  | {
      type: 'function'
      name: string
      args: ProjectionExpression[]
    }

/**
 * A single return item in a ReturnStep.
 */
export type ProjectionReturn =
  | {
      kind: 'alias'
      alias: string
      /** If specified, return only these fields from the node/edge */
      fields?: string[]
      /** Result alias (defaults to source alias) */
      resultAlias?: string
    }
  | {
      kind: 'expression'
      expression: ProjectionExpression
      resultAlias: string
    }
  | {
      kind: 'collect'
      sourceAlias: string
      distinct?: boolean
      resultAlias: string
    }
  | {
      kind: 'path'
      pathAlias: string
      resultAlias?: string
    }

/**
 * Explicit return/projection step in the query pipeline.
 *
 * Makes projection a first-class step, enabling subqueries to have
 * their own projections.
 */
export interface ReturnStep {
  type: 'return'
  /** Items to return */
  returns: ProjectionReturn[]
  /** Return only count */
  countOnly?: boolean
  /** Return only exists (count > 0) */
  existsOnly?: boolean
}

/**
 * Unwind an array field into individual rows.
 *
 * @example
 * // Unwind tags array
 * { type: 'unwind', sourceAlias: 'post', field: 'tags', itemAlias: 'tag' }
 * // Compiles to: UNWIND post.tags AS tag
 */
export interface UnwindStep {
  type: 'unwind'
  /** Alias of the node containing the array */
  sourceAlias: string
  /** Field name of the array to unwind */
  field: string
  /** Alias for each unwound item */
  itemAlias: string
}

// =============================================================================
// PROJECTION
// =============================================================================

/**
 * Projection result type - determines how results are shaped.
 */
export type ProjectionType =
  | 'node' // Single node
  | 'collection' // Multiple nodes of same type
  | 'multiNode' // Multiple aliased nodes/edges
  | 'path' // Path result
  | 'aggregate' // Aggregation result
  | 'count' // Count only
  | 'exists' // Boolean existence check
  | 'edge' // Edge-centric query
  | 'edgeCollection' // Multiple edges

/**
 * Unified projection configuration.
 * Describes what to return from the query in a flexible, composable way.
 */
export interface Projection {
  /** The type of projection - determines result shape */
  type: ProjectionType

  /** Node aliases to return (empty = return current node) */
  nodeAliases: string[]

  /** Edge aliases to return (for edge properties) */
  edgeAliases: string[]

  /** Specific fields to select per alias (undefined = all fields) */
  fields?: Record<string, string[]>

  /** Include depth information for hierarchy traversals */
  includeDepth?: boolean

  /** Path alias if returning a path */
  pathAlias?: string

  /** Aggregation configuration */
  aggregate?: {
    groupBy: Array<{ alias: string; field: string }>
    aggregations: AggregateStep['aggregations']
  }

  /** Return only existence check (boolean) */
  existsOnly?: boolean

  /** Return only count (number) */
  countOnly?: boolean

  /** Raw Cypher expression for advanced cases */
  raw?: string

  /** Aliases to collect into arrays (maps result alias -> source alias config) */
  collectAliases?: Record<
    string,
    {
      /** The user alias of the node to collect */
      sourceAlias: string
      /** Whether to use DISTINCT in collect() */
      distinct?: boolean
    }
  >
}

/**
 * Create a default projection for a single node.
 */
export function createDefaultProjection(
  alias: string,
  type: ProjectionType = 'collection',
): Projection {
  return {
    type,
    nodeAliases: [alias],
    edgeAliases: [],
  }
}

/**
 * Create a projection for edge-centric queries.
 */
export function createEdgeProjection(
  alias: string,
  type: ProjectionType = 'edgeCollection',
): Projection {
  return {
    type,
    nodeAliases: [],
    edgeAliases: [alias],
  }
}

// =============================================================================
// COMBINED AST NODE TYPE
// =============================================================================

export type ASTNode =
  | MatchStep
  | MatchByIdStep
  | TraversalStep
  | WhereStep
  | AliasStep
  | BranchStep
  | PathStep
  | AggregateStep
  | OrderByStep
  | LimitStep
  | SkipStep
  | DistinctStep
  | HierarchyStep
  | ReachableStep
  | ForkStep
  | PatternStep
  | SubqueryStep
  | UnwindStep
  | ReturnStep

// =============================================================================
// ALIAS REGISTRY
// =============================================================================

/**
 * Tracks all aliases used in the query and their types.
 */
export interface AliasInfo {
  /** The internal variable name */
  internalAlias: string
  /** User-facing alias (if set via .as()) */
  userAlias?: string
  /** Whether it's a node, edge, path, computed value, or unwound value */
  type: 'node' | 'edge' | 'path' | 'computed' | 'value'
  /** Label (for nodes) or edge type (for edges) */
  label: string
  /** Source step index in the AST */
  sourceStep: number
}

export type AliasRegistry = Map<string, AliasInfo>
