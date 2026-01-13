/**
 * Cypher Query Compiler
 *
 * Transforms AST into Cypher query strings for Neo4j/Memgraph.
 */

import type { QueryAST } from '../../ast'
import type { SchemaDefinition } from '../../schema'
import type { CompiledQuery, CompilerOptions } from '../types'
import type { QueryCompilerProvider } from '../provider'
import type {
  ASTNode,
  MatchStep,
  MatchByIdStep,
  TraversalStep,
  WhereStep,
  WhereCondition,
  ComparisonCondition,
  LogicalCondition,
  ExistsCondition,
  ConnectedToCondition,
  EdgeWhereCondition,
  BranchStep,
  PathStep,
  AggregateStep,
  OrderByStep,
  LimitStep,
  SkipStep,
  HierarchyStep,
  ReachableStep,
  Projection,
  ForkStep,
} from '../../ast'

/**
 * Cypher compiler implementation.
 * Compiles AST to Cypher queries for Neo4j/Memgraph.
 */
export class CypherCompiler implements QueryCompilerProvider {
  readonly name = 'cypher'

  private options: CompilerOptions

  private params: Record<string, unknown> = {}
  private paramCounter: number = 0
  private clauses: string[] = []
  private orderByClause: string | null = null
  private limitClause: string | null = null
  private skipClause: string | null = null
  private hasDistinct: boolean = false
  private aggregateStep: AggregateStep | null = null
  private hasBranchStep: boolean = false

  constructor(_schema?: SchemaDefinition, options: CompilerOptions = {}) {
    this.options = {
      paramPrefix: 'p',
      includeComments: false,
      ...options,
    }
  }

  compile(ast: QueryAST, _schema?: SchemaDefinition, options?: CompilerOptions): CompiledQuery {
    // Allow options override per compile call
    if (options) this.options = { ...this.options, ...options }

    // Reset state
    this.params = {}
    this.paramCounter = 0
    this.clauses = []
    this.orderByClause = null
    this.limitClause = null
    this.skipClause = null
    this.hasDistinct = false
    this.aggregateStep = null
    this.hasBranchStep = false

    ast.validate()

    // This ensures we generate `WHERE a AND b` instead of `WHERE a WHERE b`
    const mergedSteps = this.mergeConsecutiveWhereSteps(ast.steps)

    // First pass: collect all steps
    for (const step of mergedSteps) {
      this.compileStep(step)
    }

    // Compile projection (RETURN clause) - skip if branch step already handled it
    if (!this.hasBranchStep) {
      this.compileProjection(ast.projection, ast)
    }

    // Build final query with correct clause order
    const parts: string[] = [...this.clauses]

    if (this.orderByClause) {
      parts.push(this.orderByClause)
    }
    if (this.skipClause) {
      parts.push(this.skipClause)
    }
    if (this.limitClause) {
      parts.push(this.limitClause)
    }

    const cypher = parts.join('\n')

    return {
      cypher,
      params: this.params,
      resultType: this.inferResultType(ast),
      meta: this.computeMeta(ast),
    }
  }

  /**
   * Merge consecutive WHERE steps that would produce adjacent WHERE clauses.
   *
   * This transforms:
   *   [match, where(a), where(b), traversal, where(c)]
   * Into:
   *   [match, where(a AND b), traversal, where(c)]
   */
  private mergeConsecutiveWhereSteps(steps: readonly ASTNode[]): ASTNode[] {
    const result: ASTNode[] = []
    let pendingWhereConditions: WhereCondition[] = []

    const hasConnectedTo = (conditions: WhereCondition[]) =>
      conditions.some((c) => c.type === 'connectedTo')

    for (const step of steps) {
      if (step.type === 'where') {
        // If this WhereStep has connectedTo conditions, it will produce MATCH patterns
        // which naturally separate WHERE clauses from adjacent steps.
        // Don't merge it with pending conditions - preserve the step ordering.
        if (hasConnectedTo(step.conditions)) {
          if (pendingWhereConditions.length > 0) {
            result.push({
              type: 'where',
              conditions: [...pendingWhereConditions],
            } as WhereStep)
            pendingWhereConditions = []
          }
          result.push(step)
        } else {
          pendingWhereConditions.push(...step.conditions)
        }
      } else {
        // Non-WHERE step: flush pending and add the step
        if (pendingWhereConditions.length > 0) {
          result.push({
            type: 'where',
            conditions: [...pendingWhereConditions],
          } as WhereStep)
          pendingWhereConditions = []
        }
        result.push(step)
      }
    }

    if (pendingWhereConditions.length > 0) {
      result.push({
        type: 'where',
        conditions: [...pendingWhereConditions],
      } as WhereStep)
    }

    return result
  }

  private compileStep(step: ASTNode): void {
    switch (step.type) {
      case 'match':
        this.compileMatch(step)
        break
      case 'matchById':
        this.compileMatchById(step)
        break
      case 'traversal':
        this.compileTraversal(step)
        break
      case 'where':
        this.compileWhere(step)
        break
      case 'alias':
        // Alias steps don't generate Cypher, they're metadata
        break
      case 'branch':
        this.compileBranch(step)
        break
      case 'path':
        this.compilePath(step)
        break
      case 'aggregate':
        this.aggregateStep = step
        break
      case 'orderBy':
        this.compileOrderBy(step)
        break
      case 'limit':
        this.compileLimit(step)
        break
      case 'skip':
        this.compileSkip(step)
        break
      case 'distinct':
        this.hasDistinct = true
        break
      case 'hierarchy':
        this.compileHierarchy(step)
        break
      case 'reachable':
        this.compileReachable(step)
        break
      case 'fork':
        this.compileFork(step)
        break
    }
  }

  private compileMatch(step: MatchStep): void {
    this.clauses.push(`MATCH (${step.alias}:${step.label})`)
  }

  private compileMatchById(step: MatchByIdStep): void {
    const paramRef = this.addParam(step.id)
    this.clauses.push(`MATCH (${step.alias} {id: ${paramRef}})`)
  }

  private compileTraversal(step: TraversalStep): void {
    const [leftArrow, rightArrow] = this.getArrow(step.direction)
    const edgeTypes = step.edges.join('|')

    // Build variable length pattern if applicable
    let lengthPattern = ''
    if (step.variableLength) {
      const { min, max } = step.variableLength
      if (max === undefined) {
        lengthPattern = `*${min}..`
      } else if (min === max) {
        lengthPattern = `*${min}`
      } else {
        lengthPattern = `*${min}..${max}`
      }
    }

    // Build edge pattern
    const edgeAlias = step.edgeAlias ?? ''
    const edgePattern = `[${edgeAlias}:${edgeTypes}${lengthPattern}]`

    // Build target label(s)
    const targetLabel = step.toLabels.length === 1 ? `:${step.toLabels[0]}` : ''

    const matchKeyword = step.optional ? 'OPTIONAL MATCH' : 'MATCH'
    const pattern = `(${step.fromAlias})${leftArrow}${edgePattern}${rightArrow}(${step.toAlias}${targetLabel})`

    this.clauses.push(`${matchKeyword} ${pattern}`)

    // Add edge WHERE conditions if present
    if (step.edgeWhere && step.edgeWhere.length > 0 && step.edgeAlias) {
      const edgeConditions = this.compileEdgeWhere(step.edgeWhere, step.edgeAlias)
      this.clauses.push(`WHERE ${edgeConditions}`)
    }
  }

  private compileWhere(step: WhereStep): void {
    if (step.conditions.length === 0) return

    // OPTIMIZATION: Separate ConnectedToConditions from other conditions
    // ConnectedToConditions are compiled as MATCH patterns (more efficient)
    // Other conditions remain as WHERE clauses
    const connectedToConditions: ConnectedToCondition[] = []
    const otherConditions: WhereCondition[] = []

    for (const condition of step.conditions) {
      if (condition.type === 'connectedTo') {
        connectedToConditions.push(condition)
      } else {
        otherConditions.push(condition)
      }
    }

    // Compile ConnectedTo conditions as MATCH patterns
    // This allows the query planner to use index lookups on the target node ID
    for (const condition of connectedToConditions) {
      this.compileConnectedToAsMatch(condition)
    }

    // Compile remaining conditions as WHERE clause
    if (otherConditions.length > 0) {
      const conditions = otherConditions.map((c) => this.compileCondition(c)).join(' AND ')
      this.clauses.push(`WHERE ${conditions}`)
    }
  }

  private compileCondition(condition: WhereCondition): string {
    switch (condition.type) {
      case 'comparison':
        return this.compileComparisonCondition(condition)
      case 'logical':
        return this.compileLogicalCondition(condition)
      case 'exists':
        return this.compileExistsCondition(condition)
      case 'connectedTo':
        // ConnectedTo conditions are handled separately in compileWhere via compileConnectedToAsMatch.
        // This case should never be reached in normal usage (API doesn't expose nested connectedTo).
        throw new Error(
          'ConnectedTo conditions inside logical operators (AND/OR/NOT) are not supported. ' +
            'Use whereConnectedTo() directly on the query builder instead.',
        )
    }
  }

  private compileComparisonCondition(condition: ComparisonCondition): string {
    const { target, field, operator, value } = condition
    const fieldRef = `${target}.${field}`
    const cypherOp = this.operatorToCypher(operator)

    // Handle operators that don't need a value
    if (operator === 'isNull') {
      return `${fieldRef} IS NULL`
    }
    if (operator === 'isNotNull') {
      return `${fieldRef} IS NOT NULL`
    }

    // Handle NOT IN specially
    if (operator === 'notIn') {
      const paramRef = this.addParam(value)
      return `NOT ${fieldRef} IN ${paramRef}`
    }

    const paramRef = this.addParam(value)
    return `${fieldRef} ${cypherOp} ${paramRef}`
  }

  private compileLogicalCondition(condition: LogicalCondition): string {
    const { operator, conditions } = condition

    if (operator === 'NOT') {
      if (conditions.length !== 1) {
        throw new Error('NOT condition must have exactly one sub-condition')
      }
      return `NOT (${this.compileCondition(conditions[0]!)})`
    }

    const compiled = conditions.map((c) => this.compileCondition(c))
    return `(${compiled.join(` ${operator} `)})`
  }

  private compileExistsCondition(condition: ExistsCondition): string {
    const { edge, direction, target, negated } = condition
    const [leftArrow, rightArrow] = this.getArrow(direction)
    const pattern = `(${target})${leftArrow}[:${edge}]${rightArrow}()`
    return negated ? `NOT ${pattern}` : pattern
  }

  /**
   * Compile a connectedTo condition as an optimized MATCH pattern.
   *
   * OPTIMIZATION: Instead of generating a WHERE clause pattern like:
   *   WHERE (n0)-[:EDGE]->({id: $p0})
   *
   * We generate an explicit MATCH clause:
   *   MATCH (n0)-[:EDGE]->(target0 {id: $p0})
   *
   * This is more efficient because:
   * 1. The query planner can use index lookup on target0.id
   * 2. Traversal starts from the known node, not from a label scan
   * 3. The pattern is explicit, giving better hints to the optimizer
   */
  private compileConnectedToAsMatch(condition: ConnectedToCondition): void {
    const { edge, direction, nodeId, target } = condition
    const paramRef = this.addParam(nodeId)

    // Generate a unique alias for the target node
    const targetAlias = `ct${this.paramCounter}`

    const [leftArrow, rightArrow] = this.getArrow(direction)

    // Generate: MATCH (source)-[:EDGE]->(targetAlias {id: $param})
    // or:       MATCH (source)<-[:EDGE]-(targetAlias {id: $param})
    const pattern = `(${target})${leftArrow}[:${edge}]${rightArrow}(${targetAlias} {id: ${paramRef}})`
    this.clauses.push(`MATCH ${pattern}`)
  }

  private compileEdgeWhere(conditions: EdgeWhereCondition[], edgeAlias: string): string {
    return conditions
      .map((c) => {
        const fieldRef = `${edgeAlias}.${c.field}`
        const cypherOp = this.operatorToCypher(c.operator)

        if (c.operator === 'isNull') return `${fieldRef} IS NULL`
        if (c.operator === 'isNotNull') return `${fieldRef} IS NOT NULL`

        const paramRef = this.addParam(c.value)
        return `${fieldRef} ${cypherOp} ${paramRef}`
      })
      .join(' AND ')
  }

  private compileHierarchy(step: HierarchyStep): void {
    const {
      operation,
      edge,
      fromAlias,
      toAlias,
      minDepth,
      maxDepth,
      hierarchyDirection,
      includeSelf,
      untilKind,
    } = step

    let direction: 'out' | 'in'
    if (hierarchyDirection === 'up') {
      direction =
        operation === 'ancestors' || operation === 'parent' || operation === 'root' ? 'out' : 'in'
    } else {
      direction = operation === 'descendants' || operation === 'children' ? 'out' : 'in'
    }

    const [leftArrow, rightArrow] = this.getArrow(direction)

    // Build target node pattern with optional label filter
    const targetNode = untilKind ? `(${toAlias}:${untilKind})` : `(${toAlias})`

    switch (operation) {
      case 'parent':
      case 'children': {
        const pattern = `(${fromAlias})${leftArrow}[:${edge}]${rightArrow}${targetNode}`
        this.clauses.push(`MATCH ${pattern}`)
        break
      }

      case 'ancestors':
      case 'descendants': {
        // If includeSelf is true, start from 0 to include the starting node
        const min = includeSelf ? 0 : (minDepth ?? 1)
        const lengthPattern = maxDepth !== undefined ? `*${min}..${maxDepth}` : `*${min}..`
        const pattern = `(${fromAlias})${leftArrow}[:${edge}${lengthPattern}]${rightArrow}${targetNode}`

        if (step.includeDepth) {
          this.clauses.push(`MATCH path = ${pattern}`)
        } else {
          this.clauses.push(`MATCH ${pattern}`)
        }
        break
      }

      case 'siblings': {
        const parentAlias = `parent_${this.paramCounter++}`
        const pattern = `(${fromAlias})${leftArrow}[:${edge}]${rightArrow}(${parentAlias})${leftArrow === '<-' ? '<-' : '-'}[:${edge}]${leftArrow === '<-' ? '-' : '->'}${targetNode}`
        this.clauses.push(`MATCH ${pattern}`)
        this.clauses.push(`WHERE ${toAlias}.id <> ${fromAlias}.id`)
        break
      }

      case 'root': {
        const pattern = `(${fromAlias})${leftArrow}[:${edge}*0..]${rightArrow}${targetNode}`
        this.clauses.push(`MATCH ${pattern}`)
        this.clauses.push(`WHERE NOT (${toAlias})${leftArrow}[:${edge}]${rightArrow}()`)
        break
      }
    }
  }

  private compileReachable(step: ReachableStep): void {
    const { edges, direction, fromAlias, toAlias, minDepth, maxDepth, includeSelf } = step
    const [leftArrow, rightArrow] = this.getArrow(direction)
    const edgeTypes = edges.join('|')

    // If includeSelf is true, start from 0 to include the starting node
    const min = includeSelf ? 0 : (minDepth ?? 1)
    const lengthPattern = maxDepth !== undefined ? `*${min}..${maxDepth}` : `*${min}..`

    const pattern = `(${fromAlias})${leftArrow}[:${edgeTypes}${lengthPattern}]${rightArrow}(${toAlias})`

    if (step.includeDepth) {
      this.clauses.push(`MATCH path = ${pattern}`)
    } else {
      this.clauses.push(`MATCH ${pattern}`)
    }

    this.hasDistinct = true
  }

  /**
   * Compile a branch step (UNION/INTERSECT).
   * Each branch is compiled as a complete sub-query with its own RETURN.
   */
  private compileBranch(step: BranchStep): void {
    this.hasBranchStep = true
    const { operator, branches, distinct } = step

    if (operator === 'union') {
      // UNION: Each branch becomes a complete query, joined with UNION
      const branchQueries: string[] = []

      for (const branchSteps of branches) {
        // Compile each branch as a complete sub-query
        const branchQuery = this.compileBranchQuery(branchSteps)
        branchQueries.push(branchQuery)
      }

      // Join with UNION or UNION ALL
      const unionKeyword = distinct ? 'UNION' : 'UNION ALL'
      const unionQuery = branchQueries.join(`\n${unionKeyword}\n`)

      // Clear current clauses and replace with union query
      this.clauses = [unionQuery]
    } else if (operator === 'intersect') {
      // INTERSECT: Cypher doesn't have native INTERSECT
      // Use WITH + pattern matching approach for simple cases
      // For each branch after the first, we add it as a pattern that must also match

      if (branches.length < 2) {
        throw new Error('INTERSECT requires at least 2 branches')
      }

      // Strategy: Find the node alias from first branch and ensure all branches
      // return the same nodes. Use WITH to chain the patterns.
      const branchResults: string[] = []
      let finalNodeAlias = 'n0'

      for (let i = 0; i < branches.length; i++) {
        const branchSteps = branches[i]!
        const branchClauses: string[] = []

        // Get the node alias from the match step
        let nodeAlias = 'n0'
        for (const bStep of branchSteps) {
          if (bStep.type === 'match') {
            nodeAlias = bStep.alias
            break
          }
        }

        // Track the final node alias for RETURN
        finalNodeAlias = nodeAlias

        // Compile each step in the branch
        for (const bStep of branchSteps) {
          if (bStep.type === 'match') {
            branchClauses.push(`MATCH (${bStep.alias}:${bStep.label})`)
          } else if (bStep.type === 'where') {
            const conditions = bStep.conditions.map((c) => this.compileCondition(c)).join(' AND ')
            branchClauses.push(`WHERE ${conditions}`)
          }
        }

        // Add WITH to chain to next pattern (except for last branch)
        if (i < branches.length - 1) {
          branchClauses.push(`WITH ${nodeAlias}`)
        }

        branchResults.push(branchClauses.join('\n'))
      }

      // Add RETURN clause at the end
      branchResults.push(`RETURN ${finalNodeAlias}`)

      // Clear and set the intersect query
      this.clauses = [branchResults.join('\n')]
    }
  }

  /**
   * Compile a single branch as a complete sub-query for UNION.
   */
  private compileBranchQuery(steps: ASTNode[]): string {
    const branchClauses: string[] = []
    let nodeAlias = 'n0'

    // Find the node alias from match step
    for (const step of steps) {
      if (step.type === 'match') {
        nodeAlias = step.alias
        break
      } else if (step.type === 'matchById') {
        nodeAlias = step.alias
        break
      }
    }

    // Compile each step
    for (const step of steps) {
      switch (step.type) {
        case 'match':
          branchClauses.push(`MATCH (${step.alias}:${step.label})`)
          break
        case 'matchById': {
          const paramRef = this.addParam(step.id)
          branchClauses.push(`MATCH (${step.alias} {id: ${paramRef}})`)
          break
        }
        case 'where': {
          const conditions = step.conditions.map((c) => this.compileCondition(c)).join(' AND ')
          branchClauses.push(`WHERE ${conditions}`)
          break
        }
        case 'traversal': {
          const [leftArrow, rightArrow] = this.getArrow(step.direction)
          const edgeTypes = step.edges.join('|')
          const edgeAlias = step.edgeAlias ?? ''
          const edgePattern = `[${edgeAlias}:${edgeTypes}]`
          const targetLabel = step.toLabels.length === 1 ? `:${step.toLabels[0]}` : ''
          const matchKeyword = step.optional ? 'OPTIONAL MATCH' : 'MATCH'
          branchClauses.push(
            `${matchKeyword} (${step.fromAlias})${leftArrow}${edgePattern}${rightArrow}(${step.toAlias}${targetLabel})`,
          )
          nodeAlias = step.toAlias // Update current node alias
          break
        }
        // Skip alias steps - they're metadata
        case 'alias':
          break
        // Other steps are not typically used in union branches
        default:
          break
      }
    }

    // Add RETURN clause
    branchClauses.push(`RETURN ${nodeAlias}`)

    return branchClauses.join('\n')
  }

  /**
   * Compile a fork step.
   * Each branch becomes an OPTIONAL MATCH clause to enable fan-out patterns.
   */
  private compileFork(step: ForkStep): void {
    for (const branch of step.branches) {
      for (const branchStep of branch.steps) {
        // Skip the initial match step (it's the same as the source node)
        if (branchStep.type === 'match' || branchStep.type === 'matchById') {
          continue
        }

        // Force optional for traversals in fork branches
        if (branchStep.type === 'traversal') {
          this.compileTraversal({ ...branchStep, optional: true })
        } else {
          this.compileStep(branchStep)
        }
      }
    }
  }

  private compilePath(step: PathStep): void {
    const { algorithm, fromAlias, toAlias, edge, direction, maxHops, pathAlias } = step
    const [leftArrow, rightArrow] = this.getArrow(direction)

    let pathFunc: string
    switch (algorithm) {
      case 'shortestPath':
        pathFunc = 'shortestPath'
        break
      case 'allShortestPaths':
        pathFunc = 'allShortestPaths'
        break
      case 'allPaths':
        pathFunc = ''
        break
    }

    const lengthPattern = maxHops !== undefined ? `*..${maxHops}` : '*'

    if (pathFunc) {
      this.clauses.push(
        `MATCH ${pathAlias} = ${pathFunc}((${fromAlias})${leftArrow}[:${edge}${lengthPattern}]${rightArrow}(${toAlias}))`,
      )
    } else {
      this.clauses.push(
        `MATCH ${pathAlias} = (${fromAlias})${leftArrow}[:${edge}${lengthPattern}]${rightArrow}(${toAlias})`,
      )
    }
  }

  private compileOrderBy(step: OrderByStep): void {
    // Get aggregation result aliases if we have an aggregate step
    const aggAliases = new Set<string>()
    if (this.aggregateStep) {
      for (const agg of this.aggregateStep.aggregations) {
        aggAliases.add(agg.resultAlias)
      }
    }

    const fields = step.fields
      .map((f) => {
        // If the field is an aggregation alias, don't prefix with target
        if (aggAliases.has(f.field)) {
          return `${f.field} ${f.direction}`
        }
        return `${f.target}.${f.field} ${f.direction}`
      })
      .join(', ')
    this.orderByClause = `ORDER BY ${fields}`
  }

  private compileLimit(step: LimitStep): void {
    this.limitClause = `LIMIT ${step.count}`
  }

  private compileSkip(step: SkipStep): void {
    this.skipClause = `SKIP ${step.count}`
  }

  private compileProjection(projection: Projection, ast: QueryAST): void {
    const distinct = this.hasDistinct ? 'DISTINCT ' : ''

    if (projection.countOnly) {
      const alias = projection.nodeAliases[0] ?? ast.currentAlias
      this.clauses.push(`RETURN count(${alias}) AS count`)
      return
    }

    if (projection.existsOnly) {
      const alias = projection.nodeAliases[0] ?? ast.currentAlias
      this.clauses.push(`RETURN count(${alias}) > 0 AS exists`)
      return
    }

    if (this.aggregateStep || projection.aggregate) {
      this.compileAggregateReturn(projection, ast)
      return
    }

    if (projection.type === 'multiNode') {
      const returns: string[] = []

      for (const userAlias of projection.nodeAliases) {
        const internalAlias = ast.resolveUserAlias(userAlias)
        if (internalAlias) {
          returns.push(`${internalAlias} AS ${userAlias}`)
        }
      }

      for (const userAlias of projection.edgeAliases) {
        const internalAlias = ast.resolveEdgeUserAlias(userAlias)
        if (internalAlias) {
          returns.push(`${internalAlias} AS ${userAlias}`)
        }
      }

      // Handle collect aliases (for fan-out patterns)
      if (projection.collectAliases) {
        for (const [resultAlias, spec] of Object.entries(projection.collectAliases)) {
          const internalAlias = ast.resolveUserAlias(spec.sourceAlias)
          if (internalAlias) {
            const collectExpr = spec.distinct
              ? `collect(DISTINCT ${internalAlias})`
              : `collect(${internalAlias})`
            returns.push(`${collectExpr} AS ${resultAlias}`)
          }
        }
      }

      this.clauses.push(`RETURN ${distinct}${returns.join(', ')}`)
      return
    }

    if (projection.fields) {
      const alias = projection.nodeAliases[0] ?? ast.currentAlias
      const fields = projection.fields[alias]
      if (fields && fields.length > 0) {
        const fieldRefs = fields.map((f) => `${alias}.${f}`).join(', ')
        this.clauses.push(`RETURN ${distinct}${fieldRefs}`)
        return
      }
    }

    if (projection.includeDepth) {
      const alias = projection.nodeAliases[0] ?? ast.currentAlias
      this.clauses.push(`RETURN ${distinct}${alias}, length(path) AS depth`)
      return
    }

    const alias = projection.nodeAliases[0] ?? ast.currentAlias
    this.clauses.push(`RETURN ${distinct}${alias}`)
  }

  private compileAggregateReturn(projection: Projection, ast: QueryAST): void {
    const agg = this.aggregateStep ?? projection.aggregate
    if (!agg) return

    const returns: string[] = []
    const groupBy = 'groupBy' in agg ? agg.groupBy : []
    const aggregations = 'aggregations' in agg ? agg.aggregations : []

    for (const g of groupBy) {
      returns.push(`${g.alias}.${g.field}`)
    }

    for (const a of aggregations) {
      const sourceAlias = a.sourceAlias ?? ast.currentAlias
      let expr: string

      switch (a.function) {
        case 'count':
          expr = a.distinct ? `count(DISTINCT ${sourceAlias})` : `count(${sourceAlias})`
          break
        case 'sum':
          expr = `sum(${sourceAlias}.${a.field})`
          break
        case 'avg':
          expr = `avg(${sourceAlias}.${a.field})`
          break
        case 'min':
          expr = `min(${sourceAlias}.${a.field})`
          break
        case 'max':
          expr = `max(${sourceAlias}.${a.field})`
          break
        case 'collect':
          expr = a.distinct
            ? `collect(DISTINCT ${sourceAlias}.${a.field})`
            : `collect(${sourceAlias}.${a.field})`
          break
        default:
          expr = `count(${sourceAlias})`
      }

      returns.push(`${expr} AS ${a.resultAlias}`)
    }

    this.clauses.push(`RETURN ${returns.join(', ')}`)
  }

  private addParam(value: unknown): string {
    const name = `${this.options.paramPrefix}${this.paramCounter++}`
    this.params[name] = value
    return `$${name}`
  }

  private getArrow(direction: 'out' | 'in' | 'both'): [string, string] {
    switch (direction) {
      case 'out':
        return ['-', '->']
      case 'in':
        return ['<-', '-']
      case 'both':
        return ['-', '-']
    }
  }

  private operatorToCypher(op: string): string {
    const mapping: Record<string, string> = {
      eq: '=',
      neq: '<>',
      gt: '>',
      gte: '>=',
      lt: '<',
      lte: '<=',
      in: 'IN',
      notIn: 'NOT IN',
      contains: 'CONTAINS',
      startsWith: 'STARTS WITH',
      endsWith: 'ENDS WITH',
      isNull: 'IS NULL',
      isNotNull: 'IS NOT NULL',
    }
    return mapping[op] ?? op
  }

  private inferResultType(ast: QueryAST): CompiledQuery['resultType'] {
    const projType = ast.projection.type
    switch (projType) {
      case 'node':
        return 'single'
      case 'multiNode':
        return 'multiNode'
      case 'path':
        return 'path'
      case 'count':
        return 'scalar'
      case 'aggregate':
        return 'aggregate'
      case 'exists':
        return 'scalar'
      case 'edge':
        return 'single'
      case 'edgeCollection':
        return 'collection'
      case 'collection':
      default:
        return 'collection'
    }
  }

  private computeMeta(ast: QueryAST): CompiledQuery['meta'] {
    let matchCount = 0
    let hasVariableLengthPath = false
    let hasAggregation = false

    for (const step of ast.steps) {
      if (step.type === 'match') matchCount++
      if (step.type === 'traversal') {
        matchCount++
        if (step.variableLength) hasVariableLengthPath = true
      }
      if (step.type === 'path') hasVariableLengthPath = true
      if (step.type === 'hierarchy') hasVariableLengthPath = true
      if (step.type === 'reachable') hasVariableLengthPath = true
      if (step.type === 'aggregate') hasAggregation = true
    }

    return {
      complexity: matchCount + (hasVariableLengthPath ? 10 : 0) + (hasAggregation ? 5 : 0),
      hasVariableLengthPath,
      hasAggregation,
      matchCount,
      returnAliases:
        ast.projection.type === 'multiNode'
          ? [...ast.projection.nodeAliases, ...ast.projection.edgeAliases]
          : undefined,
    }
  }
}

/**
 * Create a Cypher compiler provider.
 */
export function createCypherCompiler(
  schema?: SchemaDefinition,
  options?: CompilerOptions,
): CypherCompiler {
  return new CypherCompiler(schema, options)
}
