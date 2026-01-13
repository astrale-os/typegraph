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
  | "eq" // =
  | "neq" // !=
  | "gt" // >
  | "gte" // >=
  | "lt" // <
  | "lte" // <=
  | "in" // IN [...]
  | "notIn" // NOT IN [...]
  | "contains" // String contains
  | "startsWith" // String starts with
  | "endsWith" // String ends with
  | "isNull" // IS NULL
  | "isNotNull" // IS NOT NULL

// =============================================================================
// WHERE CONDITIONS
// =============================================================================

/**
 * A single comparison condition on a node or edge property.
 */
export interface ComparisonCondition {
  type: "comparison"
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
  type: "logical"
  operator: "AND" | "OR" | "NOT"
  conditions: WhereCondition[]
}

/**
 * Existence check for edges.
 */
export interface ExistsCondition {
  type: "exists"
  edge: string
  direction: "out" | "in" | "both"
  target: string
  negated: boolean
}

/**
 * Filter nodes by edge connection to a specific node ID.
 * Example: "nodes where edge X points to node with id Y"
 */
export interface ConnectedToCondition {
  type: "connectedTo"
  /** The edge type to check */
  edge: string
  /** Direction of the edge: 'out' = outgoing, 'in' = incoming */
  direction: "out" | "in"
  /** The ID of the target/source node */
  nodeId: string
  /** The alias of the node this condition applies to */
  target: string
}

export type WhereCondition =
  | ComparisonCondition
  | LogicalCondition
  | ExistsCondition
  | ConnectedToCondition

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
  uniqueness: "nodes" | "edges" | "none"
}

// =============================================================================
// AST STEPS
// =============================================================================

/**
 * Match a node by label.
 */
export interface MatchStep {
  type: "match"
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
  type: "matchById"
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
  type: "traversal"
  /** Edge type(s) to traverse - single string or array for multi-edge */
  edges: string[]
  /** Direction of traversal */
  direction: "out" | "in" | "both"
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
  cardinality: "one" | "many" | "optional" | "mixed"
  /** Conditions on edge properties */
  edgeWhere?: EdgeWhereCondition[]
}

/**
 * Filter nodes/edges by conditions.
 */
export interface WhereStep {
  type: "where"
  conditions: WhereCondition[]
}

/**
 * Register a user-facing alias for a node.
 */
export interface AliasStep {
  type: "alias"
  /** The internal alias being registered */
  internalAlias: string
  /** The user-facing alias name */
  userAlias: string
  /** The node label */
  label: string
}

/**
 * Branch operations (UNION, INTERSECT).
 */
export interface BranchStep {
  type: "branch"
  operator: "union" | "intersect"
  branches: ASTNode[][]
  /** Whether to remove duplicates (UNION vs UNION ALL) */
  distinct: boolean
}

/**
 * Shortest path or all paths between nodes.
 */
export interface PathStep {
  type: "path"
  algorithm: "shortestPath" | "allShortestPaths" | "allPaths"
  fromAlias: string
  toAlias: string
  edge: string
  direction: "out" | "in" | "both"
  maxHops?: number
  /** Alias for the path variable */
  pathAlias: string
}

/**
 * Aggregation operation.
 */
export interface AggregateStep {
  type: "aggregate"
  /** Fields to group by (empty = aggregate all) */
  groupBy: Array<{ alias: string; field: string }>
  /** Aggregation functions to apply */
  aggregations: Array<{
    function: "count" | "sum" | "avg" | "min" | "max" | "collect"
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
  type: "orderBy"
  fields: Array<{
    field: string
    direction: "ASC" | "DESC"
    /** Alias of the node this field belongs to */
    target: string
  }>
}

/**
 * Limit result count.
 */
export interface LimitStep {
  type: "limit"
  count: number
}

/**
 * Skip results (for pagination).
 */
export interface SkipStep {
  type: "skip"
  count: number
}

/**
 * Distinct results.
 */
export interface DistinctStep {
  type: "distinct"
}

/**
 * Hierarchical navigation operation.
 * Used for tree-specific traversals like ancestors, descendants, siblings.
 */
export interface HierarchyStep {
  type: "hierarchy"
  /** The type of hierarchical operation */
  operation: "ancestors" | "descendants" | "siblings" | "root" | "parent" | "children"
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
  hierarchyDirection: "up" | "down"
  /** Whether to include depth in results */
  includeDepth?: boolean
  /** Alias for the depth value in results */
  depthAlias?: string
  /** Include the starting node itself at depth 0 (for selfAndAncestors/selfAndDescendants) */
  includeSelf?: boolean
  /** Target node kind to filter by (stops traversal when this kind is reached) */
  untilKind?: string
}

/**
 * Cursor-based pagination step.
 * Encodes position using ordered fields for efficient pagination.
 */
export interface CursorStep {
  type: "cursor"
  /** Direction of pagination */
  direction: "after" | "before"
  /** Encoded cursor string */
  cursor: string
  /** Fields used for ordering (needed to decode cursor) */
  orderFields: Array<{ field: string; direction: "ASC" | "DESC" }>
}

/**
 * Reachable step for transitive closure queries.
 * Finds all nodes reachable via any path through specified edges.
 */
export interface ReachableStep {
  type: "reachable"
  /** Edge types to traverse (can be multiple for multi-edge reachability) */
  edges: string[]
  /** Direction of traversal */
  direction: "out" | "in" | "both"
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
  uniqueness: "nodes" | "edges" | "none"
  /** Include the starting node itself at depth 0 (for selfAndReachable) */
  includeSelf?: boolean
}

/**
 * First N results step.
 * Used with cursor pagination to limit result count.
 */
export interface FirstStep {
  type: "first"
  /** Number of results to return */
  count: number
}

/**
 * Fork step for fan-out patterns.
 * Enables multiple independent traversals from the same source node.
 */
export interface ForkStep {
  type: "fork"
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
// PROJECTION
// =============================================================================

/**
 * Projection result type - determines how results are shaped.
 */
export type ProjectionType =
  | "node" // Single node
  | "collection" // Multiple nodes of same type
  | "multiNode" // Multiple aliased nodes/edges
  | "path" // Path result
  | "aggregate" // Aggregation result
  | "count" // Count only
  | "exists" // Boolean existence check
  | "edge" // Edge-centric query
  | "edgeCollection" // Multiple edges

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
    aggregations: AggregateStep["aggregations"]
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
  type: ProjectionType = "collection",
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
  type: ProjectionType = "edgeCollection",
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
  | CursorStep
  | FirstStep
  | ReachableStep
  | ForkStep

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
  /** Whether it's a node or edge */
  type: "node" | "edge" | "path"
  /** Label (for nodes) or edge type (for edges) */
  label: string
  /** Source step index in the AST */
  sourceStep: number
}

export type AliasRegistry = Map<string, AliasInfo>
