/**
 * In-Memory Query Engine
 *
 * Interprets QueryAST directly against the GraphStore without
 * generating intermediate query strings (like Cypher).
 */

import type { GraphStore, StoredNode, StoredEdge } from "../store"
import type {
  QueryAST,
  ASTNode,
  MatchStep,
  MatchByIdStep,
  TraversalStep,
  WhereStep,
  WhereCondition,
  ComparisonCondition,
  LogicalCondition,
  ConnectedToCondition,
  HierarchyStep,
  OrderByStep,
  LimitStep,
  SkipStep,
  AggregateStep,
  ReachableStep,
  ForkStep,
  Projection,
  ComparisonOperator,
} from "@astrale/typegraph"

/**
 * Execution context tracks bound variables during query execution.
 */
interface ExecutionContext {
  /** Bound node variables: alias -> node */
  nodes: Map<string, StoredNode>
  /** Bound edge variables: alias -> edge */
  edges: Map<string, StoredEdge>
  /** Additional computed values (e.g., depth) */
  computed: Map<string, unknown>
}

/**
 * A row in the result set during execution.
 */
type ResultRow = ExecutionContext

/**
 * Query engine configuration.
 */
export interface QueryEngineConfig {
  /** Maximum depth for recursive traversals (default: 100) */
  maxRecursionDepth?: number
  /** Enable query tracing for debugging */
  trace?: boolean
}

/**
 * In-memory query engine that interprets AST directly.
 */
export class QueryEngine {
  private readonly config: Required<QueryEngineConfig>

  constructor(
    private readonly store: GraphStore,
    config: QueryEngineConfig = {},
  ) {
    this.config = {
      maxRecursionDepth: config.maxRecursionDepth ?? 100,
      trace: config.trace ?? false,
    }
  }

  /**
   * Execute a query AST and return results.
   */
  execute(ast: QueryAST): unknown[] {
    const steps = ast.steps as ASTNode[]
    const projection = ast.projection

    // Start with empty result set
    let results: ResultRow[] = [this.createEmptyContext()]

    // Process each step
    for (const step of steps) {
      results = this.executeStep(step, results)
      if (results.length === 0) break
    }

    // Apply projection to get final results
    return this.applyProjection(results, projection, ast)
  }

  private createEmptyContext(): ExecutionContext {
    return {
      nodes: new Map(),
      edges: new Map(),
      computed: new Map(),
    }
  }

  private cloneContext(ctx: ExecutionContext): ExecutionContext {
    return {
      nodes: new Map(ctx.nodes),
      edges: new Map(ctx.edges),
      computed: new Map(ctx.computed),
    }
  }

  private executeStep(step: ASTNode, rows: ResultRow[]): ResultRow[] {
    switch (step.type) {
      case "match":
        return this.executeMatch(step, rows)
      case "matchById":
        return this.executeMatchById(step, rows)
      case "traversal":
        return this.executeTraversal(step, rows)
      case "where":
        return this.executeWhere(step, rows)
      case "hierarchy":
        return this.executeHierarchy(step, rows)
      case "reachable":
        return this.executeReachable(step, rows)
      case "orderBy":
        return this.executeOrderBy(step, rows)
      case "limit":
        return this.executeLimit(step, rows)
      case "skip":
        return this.executeSkip(step, rows)
      case "distinct":
        return this.executeDistinct(rows)
      case "aggregate":
        return this.executeAggregate(step, rows)
      case "alias":
        // Alias steps just register names, no row transformation needed
        return rows
      case "fork":
        return this.executeFork(step, rows)
      default:
        // Unsupported step types pass through
        return rows
    }
  }

  // ===========================================================================
  // MATCH
  // ===========================================================================

  private executeMatch(step: MatchStep, rows: ResultRow[]): ResultRow[] {
    const matchedNodes = this.store.getNodesByLabel(step.label)
    const results: ResultRow[] = []

    for (const row of rows) {
      for (const node of matchedNodes) {
        const newRow = this.cloneContext(row)
        newRow.nodes.set(step.alias, node)
        results.push(newRow)
      }
    }

    return results
  }

  /**
   * Execute a label-agnostic match by ID.
   */
  private executeMatchById(step: MatchByIdStep, rows: ResultRow[]): ResultRow[] {
    const node = this.store.getNode(step.id)
    if (!node) return []

    const results: ResultRow[] = []
    for (const row of rows) {
      const newRow = this.cloneContext(row)
      newRow.nodes.set(step.alias, node)
      results.push(newRow)
    }

    return results
  }

  // ===========================================================================
  // TRAVERSAL
  // ===========================================================================

  private executeTraversal(step: TraversalStep, rows: ResultRow[]): ResultRow[] {
    const results: ResultRow[] = []

    for (const row of rows) {
      const sourceNode = row.nodes.get(step.fromAlias)
      if (!sourceNode) continue

      const traversedRows = this.traverseFromNode(sourceNode, step, row)

      if (step.optional && traversedRows.length === 0) {
        // OPTIONAL MATCH: keep row with null target node
        const newRow = this.cloneContext(row)
        // Set target alias to null so projection can find it
        newRow.nodes.set(step.toAlias, null as unknown as StoredNode)
        results.push(newRow)
      } else {
        results.push(...traversedRows)
      }
    }

    return results
  }

  private traverseFromNode(
    sourceNode: StoredNode,
    step: TraversalStep,
    row: ResultRow,
  ): ResultRow[] {
    const results: ResultRow[] = []

    // Get edges based on direction
    let edges: StoredEdge[] = []

    if (step.direction === "out" || step.direction === "both") {
      for (const edgeType of step.edges) {
        edges.push(...this.store.getOutgoingEdges(sourceNode.id, edgeType))
      }
    }

    if (step.direction === "in" || step.direction === "both") {
      for (const edgeType of step.edges) {
        edges.push(...this.store.getIncomingEdges(sourceNode.id, edgeType))
      }
    }

    // Filter edges by edge conditions
    if (step.edgeWhere && step.edgeWhere.length > 0) {
      edges = edges.filter((edge) => this.matchesEdgeConditions(edge, step.edgeWhere!))
    }

    // Handle variable length paths
    if (step.variableLength) {
      return this.traverseVariableLength(sourceNode, step, row)
    }

    // Regular single-hop traversal
    for (const edge of edges) {
      const targetId = step.direction === "in" ? edge.fromId : edge.toId
      const targetNode = this.store.getNode(targetId)

      if (!targetNode) continue

      // Check target label constraint
      if (step.toLabels.length > 0 && !step.toLabels.includes(targetNode.label)) {
        continue
      }

      const newRow = this.cloneContext(row)
      newRow.nodes.set(step.toAlias, targetNode)
      if (step.edgeAlias) {
        newRow.edges.set(step.edgeAlias, edge)
      }
      results.push(newRow)
    }

    return results
  }

  private traverseVariableLength(
    sourceNode: StoredNode,
    step: TraversalStep,
    row: ResultRow,
  ): ResultRow[] {
    const config = step.variableLength!
    const results: ResultRow[] = []
    const visited = new Set<string>()

    const traverse = (currentNode: StoredNode, depth: number, path: StoredNode[]): void => {
      // Check depth bounds
      if (config.max !== undefined && depth > config.max) return
      if (depth > this.config.maxRecursionDepth) return

      // Uniqueness constraint
      if (config.uniqueness === "nodes" && visited.has(currentNode.id)) return
      visited.add(currentNode.id)

      // If within valid range, add to results
      if (depth >= config.min) {
        const newRow = this.cloneContext(row)
        newRow.nodes.set(step.toAlias, currentNode)
        newRow.computed.set("depth", depth)
        results.push(newRow)
      }

      // Continue traversal
      let edges: StoredEdge[] = []

      if (step.direction === "out" || step.direction === "both") {
        for (const edgeType of step.edges) {
          edges.push(...this.store.getOutgoingEdges(currentNode.id, edgeType))
        }
      }

      if (step.direction === "in" || step.direction === "both") {
        for (const edgeType of step.edges) {
          edges.push(...this.store.getIncomingEdges(currentNode.id, edgeType))
        }
      }

      for (const edge of edges) {
        if (config.uniqueness === "edges" && visited.has(edge.id)) continue
        if (config.uniqueness === "edges") visited.add(edge.id)

        const nextId = step.direction === "in" ? edge.fromId : edge.toId
        const nextNode = this.store.getNode(nextId)

        if (!nextNode) continue
        if (step.toLabels.length > 0 && !step.toLabels.includes(nextNode.label)) continue

        traverse(nextNode, depth + 1, [...path, nextNode])
      }
    }

    // Start traversal from source (depth 0 doesn't count as a hop)
    let initialEdges: StoredEdge[] = []

    if (step.direction === "out" || step.direction === "both") {
      for (const edgeType of step.edges) {
        initialEdges.push(...this.store.getOutgoingEdges(sourceNode.id, edgeType))
      }
    }

    if (step.direction === "in" || step.direction === "both") {
      for (const edgeType of step.edges) {
        initialEdges.push(...this.store.getIncomingEdges(sourceNode.id, edgeType))
      }
    }

    for (const edge of initialEdges) {
      const nextId = step.direction === "in" ? edge.fromId : edge.toId
      const nextNode = this.store.getNode(nextId)

      if (!nextNode) continue
      if (step.toLabels.length > 0 && !step.toLabels.includes(nextNode.label)) continue

      traverse(nextNode, 1, [nextNode])
    }

    return results
  }

  private matchesEdgeConditions(
    edge: StoredEdge,
    conditions: { field: string; operator: ComparisonOperator; value?: unknown }[],
  ): boolean {
    for (const cond of conditions) {
      const value = edge.properties[cond.field]
      if (!this.evaluateComparison(value, cond.operator, cond.value)) {
        return false
      }
    }
    return true
  }

  // ===========================================================================
  // WHERE
  // ===========================================================================

  private executeWhere(step: WhereStep, rows: ResultRow[]): ResultRow[] {
    return rows.filter((row) => this.evaluateConditions(step.conditions, row))
  }

  private evaluateConditions(conditions: WhereCondition[], row: ResultRow): boolean {
    for (const condition of conditions) {
      if (!this.evaluateCondition(condition, row)) {
        return false
      }
    }
    return true
  }

  private evaluateCondition(condition: WhereCondition, row: ResultRow): boolean {
    switch (condition.type) {
      case "comparison":
        return this.evaluateComparisonCondition(condition, row)
      case "logical":
        return this.evaluateLogicalCondition(condition, row)
      case "exists":
        return this.evaluateExistsCondition(condition, row)
      case "connectedTo":
        return this.evaluateConnectedToCondition(condition, row)
      default:
        return true
    }
  }

  private evaluateComparisonCondition(condition: ComparisonCondition, row: ResultRow): boolean {
    const node = row.nodes.get(condition.target)
    if (!node) return false

    const value = condition.field === "id" ? node.id : node.properties[condition.field]

    return this.evaluateComparison(value, condition.operator, condition.value)
  }

  private evaluateComparison(
    value: unknown,
    operator: ComparisonOperator,
    compareValue?: unknown,
  ): boolean {
    switch (operator) {
      case "eq":
        return value === compareValue
      case "neq":
        return value !== compareValue
      case "gt":
        return typeof value === "number" && typeof compareValue === "number" && value > compareValue
      case "gte":
        return (
          typeof value === "number" && typeof compareValue === "number" && value >= compareValue
        )
      case "lt":
        return typeof value === "number" && typeof compareValue === "number" && value < compareValue
      case "lte":
        return (
          typeof value === "number" && typeof compareValue === "number" && value <= compareValue
        )
      case "in":
        return Array.isArray(compareValue) && compareValue.includes(value)
      case "notIn":
        return Array.isArray(compareValue) && !compareValue.includes(value)
      case "contains":
        return (
          typeof value === "string" &&
          typeof compareValue === "string" &&
          value.includes(compareValue)
        )
      case "startsWith":
        return (
          typeof value === "string" &&
          typeof compareValue === "string" &&
          value.startsWith(compareValue)
        )
      case "endsWith":
        return (
          typeof value === "string" &&
          typeof compareValue === "string" &&
          value.endsWith(compareValue)
        )
      case "isNull":
        return value === null || value === undefined
      case "isNotNull":
        return value !== null && value !== undefined
      default:
        return false
    }
  }

  private evaluateLogicalCondition(condition: LogicalCondition, row: ResultRow): boolean {
    switch (condition.operator) {
      case "AND":
        return condition.conditions.every((c) => this.evaluateCondition(c, row))
      case "OR":
        return condition.conditions.some((c) => this.evaluateCondition(c, row))
      case "NOT":
        return !condition.conditions.every((c) => this.evaluateCondition(c, row))
      default:
        return true
    }
  }

  private evaluateExistsCondition(
    condition: {
      type: "exists"
      edge: string
      direction: string
      target: string
      negated: boolean
    },
    row: ResultRow,
  ): boolean {
    const node = row.nodes.get(condition.target)
    if (!node) return condition.negated

    let edges: StoredEdge[] = []

    if (condition.direction === "out" || condition.direction === "both") {
      edges.push(...this.store.getOutgoingEdges(node.id, condition.edge))
    }

    if (condition.direction === "in" || condition.direction === "both") {
      edges.push(...this.store.getIncomingEdges(node.id, condition.edge))
    }

    const exists = edges.length > 0
    return condition.negated ? !exists : exists
  }

  private evaluateConnectedToCondition(condition: ConnectedToCondition, row: ResultRow): boolean {
    const node = row.nodes.get(condition.target)
    if (!node) return false

    if (condition.direction === "out") {
      // Check if there's an outgoing edge to the specified node
      const edges = this.store.getOutgoingEdges(node.id, condition.edge)
      return edges.some((edge) => edge.toId === condition.nodeId)
    } else {
      // Check if there's an incoming edge from the specified node
      const edges = this.store.getIncomingEdges(node.id, condition.edge)
      return edges.some((edge) => edge.fromId === condition.nodeId)
    }
  }

  // ===========================================================================
  // HIERARCHY
  // ===========================================================================

  private executeHierarchy(step: HierarchyStep, rows: ResultRow[]): ResultRow[] {
    const results: ResultRow[] = []

    for (const row of rows) {
      const sourceNode = row.nodes.get(step.fromAlias)
      if (!sourceNode) continue

      const hierarchyResults = this.traverseHierarchy(sourceNode, step, row)
      results.push(...hierarchyResults)
    }

    return results
  }

  private traverseHierarchy(
    sourceNode: StoredNode,
    step: HierarchyStep,
    row: ResultRow,
  ): ResultRow[] {
    const results: ResultRow[] = []
    // If includeSelf is true, start from 0 to include the starting node
    const minDepth = step.includeSelf ? 0 : (step.minDepth ?? 1)
    const maxDepth = step.maxDepth ?? this.config.maxRecursionDepth

    switch (step.operation) {
      case "parent": {
        const parent = this.getParent(sourceNode.id, step.edge, step.hierarchyDirection)
        if (parent) {
          const newRow = this.cloneContext(row)
          newRow.nodes.set(step.toAlias, parent)
          if (step.includeDepth) newRow.computed.set(step.depthAlias ?? "_depth", 1)
          results.push(newRow)
        }
        break
      }

      case "children": {
        const children = this.getChildren(sourceNode.id, step.edge, step.hierarchyDirection)
        for (const child of children) {
          const newRow = this.cloneContext(row)
          newRow.nodes.set(step.toAlias, child)
          if (step.includeDepth) newRow.computed.set(step.depthAlias ?? "_depth", 1)
          results.push(newRow)
        }
        break
      }

      case "ancestors": {
        const visited = new Set<string>()
        // If includeSelf, add the source node at depth 0 first
        if (step.includeSelf) {
          const newRow = this.cloneContext(row)
          newRow.nodes.set(step.toAlias, sourceNode)
          newRow.computed.set(step.depthAlias ?? "_depth", 0)
          results.push(newRow)
        }
        this.collectAncestors(sourceNode.id, step, row, results, visited, 1, minDepth, maxDepth)
        break
      }

      case "descendants": {
        const visited = new Set<string>()
        // If includeSelf, add the source node at depth 0 first
        if (step.includeSelf) {
          const newRow = this.cloneContext(row)
          newRow.nodes.set(step.toAlias, sourceNode)
          newRow.computed.set(step.depthAlias ?? "_depth", 0)
          results.push(newRow)
        }
        this.collectDescendants(sourceNode.id, step, row, results, visited, 1, minDepth, maxDepth)
        break
      }

      case "siblings": {
        const parent = this.getParent(sourceNode.id, step.edge, step.hierarchyDirection)
        if (parent) {
          const siblings = this.getChildren(parent.id, step.edge, step.hierarchyDirection)
          for (const sibling of siblings) {
            if (sibling.id === sourceNode.id) continue
            const newRow = this.cloneContext(row)
            newRow.nodes.set(step.toAlias, sibling)
            results.push(newRow)
          }
        }
        break
      }

      case "root": {
        let current = sourceNode
        let depth = 0
        while (depth < maxDepth) {
          const parent = this.getParent(current.id, step.edge, step.hierarchyDirection)
          if (!parent) break
          current = parent
          depth++
        }
        const newRow = this.cloneContext(row)
        newRow.nodes.set(step.toAlias, current)
        if (step.includeDepth) newRow.computed.set(step.depthAlias ?? "_depth", depth)
        results.push(newRow)
        break
      }
    }

    return results
  }

  private getParent(
    nodeId: string,
    edgeType: string,
    direction: "up" | "down",
  ): StoredNode | undefined {
    // direction 'up' means edge points from child to parent
    const edges =
      direction === "up"
        ? this.store.getOutgoingEdges(nodeId, edgeType)
        : this.store.getIncomingEdges(nodeId, edgeType)

    const firstEdge = edges[0]
    if (!firstEdge) return undefined

    const parentId = direction === "up" ? firstEdge.toId : firstEdge.fromId
    return this.store.getNode(parentId)
  }

  private getChildren(nodeId: string, edgeType: string, direction: "up" | "down"): StoredNode[] {
    // direction 'up' means edge points from child to parent, so children have incoming edges
    const edges =
      direction === "up"
        ? this.store.getIncomingEdges(nodeId, edgeType)
        : this.store.getOutgoingEdges(nodeId, edgeType)

    return edges
      .map((e) => this.store.getNode(direction === "up" ? e.fromId : e.toId))
      .filter((n): n is StoredNode => n !== undefined)
  }

  private collectAncestors(
    nodeId: string,
    step: HierarchyStep,
    row: ResultRow,
    results: ResultRow[],
    visited: Set<string>,
    depth: number,
    minDepth: number,
    maxDepth: number,
  ): void {
    if (depth > maxDepth) return
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    const parent = this.getParent(nodeId, step.edge, step.hierarchyDirection)
    if (!parent) return

    // If untilKind is specified, only include nodes of that kind
    const matchesKind = !step.untilKind || parent.label === step.untilKind

    if (depth >= minDepth && matchesKind) {
      const newRow = this.cloneContext(row)
      newRow.nodes.set(step.toAlias, parent)
      if (step.includeDepth) newRow.computed.set(step.depthAlias ?? "_depth", depth)
      results.push(newRow)

      // If untilKind is specified and we found a match, stop traversing
      if (step.untilKind) return
    }

    this.collectAncestors(parent.id, step, row, results, visited, depth + 1, minDepth, maxDepth)
  }

  private collectDescendants(
    nodeId: string,
    step: HierarchyStep,
    row: ResultRow,
    results: ResultRow[],
    visited: Set<string>,
    depth: number,
    minDepth: number,
    maxDepth: number,
  ): void {
    if (depth > maxDepth) return
    if (visited.has(nodeId)) return
    visited.add(nodeId)

    const children = this.getChildren(nodeId, step.edge, step.hierarchyDirection)

    for (const child of children) {
      if (depth >= minDepth) {
        const newRow = this.cloneContext(row)
        newRow.nodes.set(step.toAlias, child)
        if (step.includeDepth) newRow.computed.set(step.depthAlias ?? "_depth", depth)
        results.push(newRow)
      }

      this.collectDescendants(child.id, step, row, results, visited, depth + 1, minDepth, maxDepth)
    }
  }

  // ===========================================================================
  // REACHABLE
  // ===========================================================================

  private executeReachable(step: ReachableStep, rows: ResultRow[]): ResultRow[] {
    const results: ResultRow[] = []

    for (const row of rows) {
      const sourceNode = row.nodes.get(step.fromAlias)
      if (!sourceNode) continue

      // If includeSelf, add the source node at depth 0 first
      if (step.includeSelf) {
        const newRow = this.cloneContext(row)
        newRow.nodes.set(step.toAlias, sourceNode)
        newRow.computed.set(step.depthAlias ?? "_depth", 0)
        results.push(newRow)
      }

      const visited = new Set<string>()
      // If includeSelf, start traversal from depth 1 (self is already at 0)
      const minDepth = step.includeSelf ? 1 : (step.minDepth ?? 1)
      const maxDepth = step.maxDepth ?? this.config.maxRecursionDepth

      this.collectReachable(sourceNode.id, step, row, results, visited, 1, minDepth, maxDepth)
    }

    return results
  }

  private collectReachable(
    nodeId: string,
    step: ReachableStep,
    row: ResultRow,
    results: ResultRow[],
    visited: Set<string>,
    depth: number,
    minDepth: number,
    maxDepth: number,
  ): void {
    if (depth > maxDepth) return

    if (step.uniqueness === "nodes" && visited.has(nodeId)) return
    visited.add(nodeId)

    let edges: StoredEdge[] = []

    if (step.direction === "out" || step.direction === "both") {
      for (const edgeType of step.edges) {
        edges.push(...this.store.getOutgoingEdges(nodeId, edgeType))
      }
    }

    if (step.direction === "in" || step.direction === "both") {
      for (const edgeType of step.edges) {
        edges.push(...this.store.getIncomingEdges(nodeId, edgeType))
      }
    }

    for (const edge of edges) {
      if (step.uniqueness === "edges" && visited.has(edge.id)) continue
      if (step.uniqueness === "edges") visited.add(edge.id)

      const nextId = step.direction === "in" ? edge.fromId : edge.toId
      const nextNode = this.store.getNode(nextId)

      if (!nextNode) continue

      if (depth >= minDepth) {
        const newRow = this.cloneContext(row)
        newRow.nodes.set(step.toAlias, nextNode)
        if (step.includeDepth) newRow.computed.set(step.depthAlias ?? "_depth", depth)
        results.push(newRow)
      }

      this.collectReachable(nextId, step, row, results, visited, depth + 1, minDepth, maxDepth)
    }
  }

  // ===========================================================================
  // ORDER BY / LIMIT / SKIP / DISTINCT
  // ===========================================================================

  private executeOrderBy(step: OrderByStep, rows: ResultRow[]): ResultRow[] {
    return [...rows].sort((a, b) => {
      for (const field of step.fields) {
        const nodeA = a.nodes.get(field.target)
        const nodeB = b.nodes.get(field.target)

        const valueA = nodeA
          ? field.field === "id"
            ? nodeA.id
            : nodeA.properties[field.field]
          : undefined
        const valueB = nodeB
          ? field.field === "id"
            ? nodeB.id
            : nodeB.properties[field.field]
          : undefined

        const comparison = this.compareValues(valueA, valueB)
        if (comparison !== 0) {
          return field.direction === "DESC" ? -comparison : comparison
        }
      }
      return 0
    })
  }

  private compareValues(a: unknown, b: unknown): number {
    if (a === b) return 0
    if (a === undefined || a === null) return -1
    if (b === undefined || b === null) return 1

    if (typeof a === "string" && typeof b === "string") {
      return a.localeCompare(b)
    }

    if (typeof a === "number" && typeof b === "number") {
      return a - b
    }

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() - b.getTime()
    }

    return String(a).localeCompare(String(b))
  }

  private executeLimit(step: LimitStep, rows: ResultRow[]): ResultRow[] {
    return rows.slice(0, step.count)
  }

  private executeSkip(step: SkipStep, rows: ResultRow[]): ResultRow[] {
    return rows.slice(step.count)
  }

  private executeDistinct(rows: ResultRow[]): ResultRow[] {
    const seen = new Set<string>()
    const results: ResultRow[] = []

    for (const row of rows) {
      // Create a key from all node IDs
      const key = Array.from(row.nodes.values())
        .map((n) => n.id)
        .sort()
        .join("|")

      if (!seen.has(key)) {
        seen.add(key)
        results.push(row)
      }
    }

    return results
  }

  // ===========================================================================
  // AGGREGATE
  // ===========================================================================

  private executeAggregate(step: AggregateStep, rows: ResultRow[]): ResultRow[] {
    if (step.groupBy.length === 0) {
      // Global aggregation
      const result = this.createEmptyContext()

      for (const agg of step.aggregations) {
        const value = this.computeAggregation(agg, rows)
        result.computed.set(agg.resultAlias, value)
      }

      return [result]
    }

    // Group by
    const groups = new Map<string, ResultRow[]>()

    for (const row of rows) {
      const key = step.groupBy
        .map((g) => {
          const node = row.nodes.get(g.alias)
          return node ? String(node.properties[g.field] ?? node.id) : ""
        })
        .join("|")

      if (!groups.has(key)) {
        groups.set(key, [])
      }
      groups.get(key)!.push(row)
    }

    const results: ResultRow[] = []

    for (const [, groupRows] of groups) {
      const firstRow = groupRows[0]
      if (!firstRow) continue
      const result = this.cloneContext(firstRow)

      for (const agg of step.aggregations) {
        const value = this.computeAggregation(agg, groupRows)
        result.computed.set(agg.resultAlias, value)
      }

      results.push(result)
    }

    return results
  }

  private computeAggregation(
    agg: AggregateStep["aggregations"][number],
    rows: ResultRow[],
  ): unknown {
    switch (agg.function) {
      case "count": {
        if (agg.distinct) {
          const values = new Set<unknown>()
          for (const row of rows) {
            if (agg.sourceAlias && agg.field) {
              const node = row.nodes.get(agg.sourceAlias)
              if (node) values.add(node.properties[agg.field])
            } else {
              values.add(row.nodes.keys().next().value)
            }
          }
          return values.size
        }
        return rows.length
      }

      case "sum": {
        let sum = 0
        for (const row of rows) {
          if (agg.sourceAlias && agg.field) {
            const node = row.nodes.get(agg.sourceAlias)
            const value = node?.properties[agg.field]
            if (typeof value === "number") sum += value
          }
        }
        return sum
      }

      case "avg": {
        let sum = 0
        let count = 0
        for (const row of rows) {
          if (agg.sourceAlias && agg.field) {
            const node = row.nodes.get(agg.sourceAlias)
            const value = node?.properties[agg.field]
            if (typeof value === "number") {
              sum += value
              count++
            }
          }
        }
        return count > 0 ? sum / count : null
      }

      case "min": {
        let min: number | null = null
        for (const row of rows) {
          if (agg.sourceAlias && agg.field) {
            const node = row.nodes.get(agg.sourceAlias)
            const value = node?.properties[agg.field]
            if (typeof value === "number" && (min === null || value < min)) {
              min = value
            }
          }
        }
        return min
      }

      case "max": {
        let max: number | null = null
        for (const row of rows) {
          if (agg.sourceAlias && agg.field) {
            const node = row.nodes.get(agg.sourceAlias)
            const value = node?.properties[agg.field]
            if (typeof value === "number" && (max === null || value > max)) {
              max = value
            }
          }
        }
        return max
      }

      case "collect": {
        const values: unknown[] = []
        for (const row of rows) {
          if (agg.sourceAlias && agg.field) {
            const node = row.nodes.get(agg.sourceAlias)
            if (node) values.push(node.properties[agg.field])
          } else if (agg.sourceAlias) {
            const node = row.nodes.get(agg.sourceAlias)
            if (node) values.push(this.nodeToResult(node))
          }
        }
        return values
      }

      default:
        return null
    }
  }

  // ===========================================================================
  // FORK (Fan-out Pattern)
  // ===========================================================================

  /**
   * Execute a fork step.
   * Fork creates multiple independent traversals from the same source node.
   * Each branch is executed as OPTIONAL MATCH semantics.
   *
   * For fork with collect(), we need to produce multiple rows that can be
   * aggregated by the projection. Each row represents one combination of
   * branch results.
   */
  private executeFork(step: ForkStep, rows: ResultRow[]): ResultRow[] {
    const results: ResultRow[] = []

    for (const row of rows) {
      // Get the source node for this fork
      const sourceNode = row.nodes.get(step.sourceAlias)
      if (!sourceNode) {
        results.push(row)
        continue
      }

      // Execute each branch independently and collect results
      const branchResults: ResultRow[][] = []

      for (const branch of step.branches) {
        // Execute branch steps starting from the current row
        let branchRows: ResultRow[] = [this.cloneContext(row)]

        for (const branchStep of branch.steps) {
          // Skip the initial match step (it's the same as the source node)
          if (branchStep.type === "match" || branchStep.type === "matchById") {
            continue
          }

          // Skip alias steps that just register the source alias
          if (branchStep.type === "alias" && branchStep.internalAlias === step.sourceAlias) {
            continue
          }

          // Skip where steps that filter on the source node (already filtered)
          if (branchStep.type === "where") {
            const allConditionsOnSource = branchStep.conditions.every(
              (c) => c.type === "comparison" && c.target === step.sourceAlias,
            )
            if (allConditionsOnSource) continue
          }

          // Skip steps that were already executed before the fork (hierarchy, orderBy, limit, skip)
          if (
            branchStep.type === "hierarchy" ||
            branchStep.type === "orderBy" ||
            branchStep.type === "limit" ||
            branchStep.type === "skip"
          ) {
            continue
          }

          // For traversals in fork branches, treat them as optional
          if (branchStep.type === "traversal") {
            const optionalStep = { ...branchStep, optional: true }
            branchRows = this.executeStep(optionalStep, branchRows)
          } else {
            branchRows = this.executeStep(branchStep, branchRows)
          }
        }

        // If branch produced no results, keep the original row (OPTIONAL MATCH semantics)
        if (branchRows.length === 0) {
          branchRows = [this.cloneContext(row)]
        }

        branchResults.push(branchRows)
      }

      // Compute Cartesian product of all branch results
      const cartesianProduct = this.cartesianProduct(branchResults)

      // Merge each combination into a single row
      for (const combination of cartesianProduct) {
        const mergedRow = this.cloneContext(row)

        for (const branchRow of combination) {
          // Merge nodes from branch
          for (const [alias, node] of branchRow.nodes) {
            // Don't overwrite the source node
            if (alias !== step.sourceAlias) {
              mergedRow.nodes.set(alias, node)
            }
          }
          // Merge edges from branch
          for (const [alias, edge] of branchRow.edges) {
            mergedRow.edges.set(alias, edge)
          }
          // Merge computed values
          for (const [key, value] of branchRow.computed) {
            mergedRow.computed.set(key, value)
          }
        }

        results.push(mergedRow)
      }
    }

    return results
  }

  /**
   * Compute Cartesian product of arrays.
   * [[A, B], [X, Y]] -> [[A, X], [A, Y], [B, X], [B, Y]]
   */
  private cartesianProduct<T>(arrays: T[][]): T[][] {
    if (arrays.length === 0) return [[]]
    if (arrays.length === 1) return arrays[0]!.map((item) => [item])

    return arrays.reduce<T[][]>(
      (acc, curr) => {
        const result: T[][] = []
        for (const a of acc) {
          for (const c of curr) {
            result.push([...a, c])
          }
        }
        return result
      },
      [[]],
    )
  }

  // ===========================================================================
  // PROJECTION
  // ===========================================================================

  /**
   * Resolve a user alias to its internal alias.
   * Handles both QueryAST class instances and plain JSON objects.
   */
  private resolveUserAlias(ast: QueryAST, userAlias: string): string | undefined {
    // If ast has the method (class instance), use it
    if (typeof ast.resolveUserAlias === "function") {
      return ast.resolveUserAlias(userAlias)
    }
    // Otherwise, treat as plain JSON object
    const userAliases = (ast as any).userAliases
    if (userAliases && typeof userAliases === "object") {
      return userAliases[userAlias]
    }
    return undefined
  }

  /**
   * Resolve an edge user alias to its internal alias.
   * Handles both QueryAST class instances and plain JSON objects.
   */
  private resolveEdgeUserAlias(ast: QueryAST, userAlias: string): string | undefined {
    // If ast has the method (class instance), use it
    if (typeof ast.resolveEdgeUserAlias === "function") {
      return ast.resolveEdgeUserAlias(userAlias)
    }
    // Otherwise, treat as plain JSON object
    const edgeUserAliases = (ast as any).edgeUserAliases
    if (edgeUserAliases && typeof edgeUserAliases === "object") {
      return edgeUserAliases[userAlias]
    }
    return undefined
  }

  private applyProjection(rows: ResultRow[], projection: Projection, ast: QueryAST): unknown[] {
    // Handle count/exists special cases
    if (projection.countOnly) {
      // Return in format expected by CollectionBuilder.count(): { count: number }
      return [{ count: rows.length }]
    }

    if (projection.existsOnly) {
      return [rows.length > 0]
    }

    // Handle aggregate results
    if (projection.type === "aggregate") {
      return rows.map((row) => Object.fromEntries(row.computed))
    }

    // Handle multi-node projection (including fork with collect)
    if (projection.type === "multiNode") {
      const hasCollect =
        projection.collectAliases && Object.keys(projection.collectAliases).length > 0

      if (hasCollect) {
        // For fork patterns with collect, we need to aggregate across all rows
        // that share the same "primary" node (the node before fork)
        const primaryAlias = projection.nodeAliases[0]
        const primaryInternalAlias = primaryAlias
          ? this.resolveUserAlias(ast, primaryAlias)
          : undefined

        // Group rows by primary node ID
        const groupedRows = new Map<string, ResultRow[]>()

        for (const row of rows) {
          const primaryNode = primaryInternalAlias ? row.nodes.get(primaryInternalAlias) : undefined
          const groupKey = primaryNode?.id ?? "_no_primary"

          if (!groupedRows.has(groupKey)) {
            groupedRows.set(groupKey, [])
          }
          groupedRows.get(groupKey)!.push(row)
        }

        // Build results for each group
        const results: Record<string, unknown>[] = []

        for (const [, groupRows] of groupedRows) {
          const result: Record<string, unknown> = {}
          const firstRow = groupRows[0]!

          // Add the primary node
          if (primaryInternalAlias && primaryAlias) {
            const primaryNode = firstRow.nodes.get(primaryInternalAlias)
            if (primaryNode) {
              result[primaryAlias] = this.nodeToResult(primaryNode)
            }
          }

          // Add other non-collected node aliases (take from first row)
          for (const userAlias of projection.nodeAliases) {
            if (userAlias === primaryAlias) continue
            // Skip aliases that are being collected
            if (
              projection.collectAliases &&
              Object.values(projection.collectAliases).some((s) => s.sourceAlias === userAlias)
            ) {
              continue
            }
            const internalAlias = this.resolveUserAlias(ast, userAlias)
            if (internalAlias) {
              const node = firstRow.nodes.get(internalAlias)
              if (node) {
                result[userAlias] = this.nodeToResult(node)
              } else {
                // For optional traversals, set to null if not found
                result[userAlias] = null
              }
            }
          }

          // Collect nodes for each collect alias
          for (const [resultAlias, spec] of Object.entries(projection.collectAliases!)) {
            const sourceInternalAlias = this.resolveUserAlias(ast, spec.sourceAlias)
            if (!sourceInternalAlias) continue

            const collected: StoredNode[] = []
            const seenIds = new Set<string>()

            for (const row of groupRows) {
              const node = row.nodes.get(sourceInternalAlias)
              if (node) {
                if (spec.distinct && seenIds.has(node.id)) continue
                seenIds.add(node.id)
                collected.push(node)
              }
            }

            result[resultAlias] = collected.map((n) => this.nodeToResult(n))
          }

          // Add edge aliases
          for (const userAlias of projection.edgeAliases) {
            const internalAlias = this.resolveEdgeUserAlias(ast, userAlias)
            if (internalAlias) {
              const edge = firstRow.edges.get(internalAlias)
              if (edge) {
                result[userAlias] = this.edgeToResult(edge)
              }
            }
          }

          results.push(result)
        }

        return results
      }

      // Standard multi-node projection (no collect)
      return rows.map((row) => {
        const result: Record<string, unknown> = {}

        // Add node aliases
        for (const userAlias of projection.nodeAliases) {
          const internalAlias = this.resolveUserAlias(ast, userAlias)
          if (internalAlias) {
            const node = row.nodes.get(internalAlias)
            if (node) {
              const nodeData = this.nodeToResult(node, projection.fields?.[userAlias])
              // Include computed values (like _depth) in node results
              for (const [key, value] of row.computed) {
                if (key.startsWith("_")) {
                  ;(nodeData as Record<string, unknown>)[key] = value
                }
              }
              result[userAlias] = nodeData
            } else {
              // For optional traversals in fork, set to null
              result[userAlias] = null
            }
          }
        }

        // Add edge aliases with full properties
        for (const userAlias of projection.edgeAliases) {
          const internalAlias = this.resolveEdgeUserAlias(ast, userAlias)
          if (internalAlias) {
            const edge = row.edges.get(internalAlias)
            if (edge) {
              result[userAlias] = this.edgeToResult(edge)
            }
          }
        }

        return result
      })
    }

    // Handle single/collection node projection (default)
    const nodeAlias = projection.nodeAliases[0] ?? ast.currentAlias

    const results: Record<string, unknown>[] = []

    for (const row of rows) {
      const node = row.nodes.get(nodeAlias)
      if (!node) continue

      const nodeData = this.nodeToResult(node, projection.fields?.[nodeAlias])

      // Include depth if requested
      if (projection.includeDepth) {
        const depth = row.computed.get("depth")
        if (depth !== undefined) {
          ;(nodeData as Record<string, unknown>).depth = depth
        }
      }

      // Wrap in Neo4j-style format: { alias: nodeData }
      // This is required because extractNodeFromRecord expects { key: nodeData }
      results.push({ [nodeAlias]: nodeData })
    }

    return results
  }

  private nodeToResult(node: StoredNode, fields?: string[]): Record<string, unknown> {
    const base = { id: node.id, ...node.properties }

    if (!fields) return base

    const result: Record<string, unknown> = {}
    for (const field of fields) {
      if (field === "id") {
        result.id = node.id
      } else if (field in node.properties) {
        result[field] = node.properties[field]
      }
    }
    return result
  }

  private edgeToResult(edge: StoredEdge): Record<string, unknown> {
    return {
      id: edge.id,
      type: edge.type,
      fromId: edge.fromId,
      toId: edge.toId,
      ...edge.properties,
    }
  }
}
