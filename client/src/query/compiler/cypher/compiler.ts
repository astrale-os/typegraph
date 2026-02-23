/**
 * Cypher Query Compiler
 *
 * Transforms AST into Cypher query strings for Neo4j/Memgraph.
 */

import type { SchemaShape } from '../../../schema'
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
  LabelCondition,
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
  PatternNode,
  PatternEdge,
  PatternStep,
  SubqueryStep,
  SubqueryCondition,
  UnwindStep,
  ReturnStep,
  ProjectionReturn,
  ProjectionExpression,
  ComputedOperator,
} from '../../ast'
import { resolveNodeLabels, formatLabels, toPascalCase } from '../../../helpers'
import type { CompiledQuery, CompilerOptions } from '../types'
import type { QueryCompilerProvider } from '../provider'

/**
 * Cypher compiler implementation.
 * Compiles AST to Cypher queries for Neo4j/Memgraph.
 */
export class CypherCompiler implements QueryCompilerProvider {
  readonly name = 'cypher'

  private options: CompilerOptions
  private schema: SchemaShape | undefined

  private params: Record<string, unknown> = {}
  private paramCounter: number = 0
  private clauses: string[] = []
  private orderByClause: string | null = null
  private limitClause: string | null = null
  private skipClause: string | null = null
  private hasDistinct: boolean = false
  private aggregateStep: AggregateStep | null = null
  private hasBranchStep: boolean = false

  constructor(schema?: SchemaShape, options: CompilerOptions = {}) {
    this.schema = schema
    this.options = {
      paramPrefix: 'p',
      includeComments: false,
      ...options,
    }
  }

  compile(ast: QueryAST, schema?: SchemaShape, options?: CompilerOptions): CompiledQuery {
    // Allow options override per compile call
    if (options) this.options = { ...this.options, ...options }
    // Use provided schema or fall back to constructor schema
    if (schema) this.schema = schema

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

    // Compile projection (RETURN clause)
    // ReturnStep is already compiled in compileStep - only use legacy projection if no ReturnStep
    const hasReturnStep = mergedSteps.some((s) => s.type === 'return')
    if (!this.hasBranchStep && !hasReturnStep) {
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

    for (const step of steps) {
      if (step.type === 'where') {
        pendingWhereConditions.push(...step.conditions)
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
      // New v2 types
      case 'pattern':
        this.compilePattern(step)
        break
      case 'subquery':
        this.compileSubqueryStep(step)
        break
      case 'unwind':
        this.compileUnwind(step)
        break
      case 'return':
        this.compileReturnStep(step)
        break
    }
  }

  private compileMatch(step: MatchStep): void {
    // Resolve labels when schema is available (includes base labels like :Node)
    const labelStr = this.schema
      ? formatLabels(resolveNodeLabels(this.schema, step.label))
      : `:${step.label}`
    this.clauses.push(`MATCH (${step.alias}${labelStr})`)
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

    // Build target label(s) - resolve node type keys to full labels
    let targetLabel = ''
    if (step.toLabels.length > 0 && this.schema) {
      // If the first label is a known schema type, resolve inheritance labels.
      // Otherwise (meta-labels like Node, Class, Link), format all toLabels directly.
      if (this.schema.nodes[step.toLabels[0]!]) {
        const resolvedLabels = resolveNodeLabels(this.schema, step.toLabels[0]!)
        targetLabel = formatLabels(resolvedLabels)
      } else {
        targetLabel = formatLabels(step.toLabels)
      }
    } else if (step.toLabels.length > 0) {
      targetLabel = formatLabels(step.toLabels)
    }

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

    const conditions = step.conditions.map((c) => this.compileCondition(c)).join(' AND ')
    this.clauses.push(`WHERE ${conditions}`)
  }

  private compileCondition(condition: WhereCondition): string {
    switch (condition.type) {
      case 'comparison':
        return this.compileComparisonCondition(condition)
      case 'logical':
        return this.compileLogicalCondition(condition)
      case 'label':
        return this.compileLabelCondition(condition)
      // New v2: SubqueryCondition
      case 'subquery':
        return this.compileSubqueryCondition(condition)
      case 'aliasComparison': {
        const aliasOp = this.operatorToCypher(condition.operator)
        return `${condition.leftAlias}.${condition.leftField} ${aliasOp} ${condition.rightAlias}.${condition.rightField}`
      }
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

  private compileLabelCondition(condition: LabelCondition): string {
    const { labels, mode, negated, target } = condition

    if (labels.length === 0) {
      return 'true' // Empty labels = no constraint
    }

    const labelChecks = labels.map((label) => `${target}:${label}`)

    const joiner = mode === 'all' ? ' AND ' : ' OR '
    const combined = labelChecks.length === 1 ? labelChecks[0] : `(${labelChecks.join(joiner)})`

    return negated ? `NOT ${combined}` : combined!
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
      targetLabel,
    } = step

    let direction: 'out' | 'in'
    if (hierarchyDirection === 'up') {
      direction =
        operation === 'ancestors' || operation === 'parent' || operation === 'root' ? 'out' : 'in'
    } else {
      direction = operation === 'descendants' || operation === 'children' ? 'out' : 'in'
    }

    const [leftArrow, rightArrow] = this.getArrow(direction)

    // Build target node pattern with proper label resolution
    // Priority: untilKind > targetLabel > no label
    let targetLabelStr = ''
    if (untilKind && this.schema) {
      // untilKind takes precedence - resolve it properly
      targetLabelStr = formatLabels(resolveNodeLabels(this.schema, untilKind))
    } else if (untilKind) {
      // No schema, use untilKind with PascalCase conversion
      targetLabelStr = `:${toPascalCase(untilKind)}`
    } else if (targetLabel && this.schema) {
      // Use step's targetLabel with proper resolution (includes multi-label support)
      targetLabelStr = formatLabels(resolveNodeLabels(this.schema, targetLabel))
    } else if (targetLabel) {
      // No schema, use targetLabel with PascalCase conversion
      targetLabelStr = `:${toPascalCase(targetLabel)}`
    }

    const targetNode = `(${toAlias}${targetLabelStr})`

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
        // Siblings need special handling: go UP to parent, then back DOWN to siblings
        // For 'up' direction (child -[:hasParent]-> parent): go out then in
        // For 'down' direction (parent -[:contains]-> child): go in then out
        const parentAlias = `parent_${this.paramCounter++}`
        const [toParentLeft, toParentRight] =
          hierarchyDirection === 'up' ? ['-', '->'] : ['<-', '-']
        const [toSiblingLeft, toSiblingRight] =
          hierarchyDirection === 'up' ? ['<-', '-'] : ['-', '->']
        // Use same label for parent as for sibling target (in hierarchies, parent is same type)
        const parentNode = `(${parentAlias}${targetLabelStr})`
        const pattern = `(${fromAlias})${toParentLeft}[:${edge}]${toParentRight}${parentNode}${toSiblingLeft}[:${edge}]${toSiblingRight}${targetNode}`
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
      if (branches.length < 2) {
        throw new Error('INTERSECT requires at least 2 branches')
      }

      const branchResults: string[] = []
      let finalNodeAlias = 'n0'

      for (let i = 0; i < branches.length; i++) {
        const branchSteps = branches[i]!
        const branchClauses: string[] = []

        let nodeAlias = 'n0'
        for (const bStep of branchSteps) {
          if (bStep.type === 'match') {
            nodeAlias = bStep.alias
            break
          }
        }

        finalNodeAlias = nodeAlias

        for (const bStep of branchSteps) {
          if (bStep.type === 'match') {
            const labelStr = this.schema
              ? formatLabels(resolveNodeLabels(this.schema, bStep.label))
              : `:${bStep.label}`
            branchClauses.push(`MATCH (${bStep.alias}${labelStr})`)
          } else if (bStep.type === 'where') {
            const conditions = bStep.conditions.map((c) => this.compileCondition(c)).join(' AND ')
            branchClauses.push(`WHERE ${conditions}`)
          }
        }

        if (i < branches.length - 1) {
          branchClauses.push(`WITH ${nodeAlias}`)
        }

        branchResults.push(branchClauses.join('\n'))
      }

      branchResults.push(`RETURN ${finalNodeAlias}`)
      this.clauses = [branchResults.join('\n')]
    } else if (operator === 'except') {
      // EXCEPT: Set difference - results in first branch but not in others
      if (branches.length < 2) {
        throw new Error('EXCEPT requires at least 2 branches')
      }

      const branchQueries: string[] = []
      for (const branchSteps of branches) {
        branchQueries.push(this.compileBranchQuery(branchSteps))
      }

      const exceptKeyword = distinct ? 'EXCEPT' : 'EXCEPT ALL'
      this.clauses = [branchQueries.join(`\n${exceptKeyword}\n`)]
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
        case 'match': {
          // Resolve labels when schema is available (includes base labels like :Node)
          const labelStr = this.schema
            ? formatLabels(resolveNodeLabels(this.schema, step.label))
            : `:${step.label}`
          branchClauses.push(`MATCH (${step.alias}${labelStr})`)
          break
        }
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
          let targetLabel = ''
          if (step.toLabels.length > 0 && this.schema) {
            if (this.schema.nodes[step.toLabels[0]!]) {
              const resolvedLabels = resolveNodeLabels(this.schema, step.toLabels[0]!)
              targetLabel = formatLabels(resolvedLabels)
            } else {
              targetLabel = formatLabels(step.toLabels)
            }
          } else if (step.toLabels.length > 0) {
            targetLabel = formatLabels(step.toLabels)
          }
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

  // ===========================================================================
  // PATTERN COMPILATION (Spec 04)
  // ===========================================================================

  /**
   * Compile a pattern step to MATCH clauses.
   */
  private compilePattern(step: PatternStep): void {
    const emittedNodes = new Set<string>()

    // Group edges by whether they're optional
    const requiredEdges = step.edges.filter((e) => !e.optional)
    const optionalEdges = step.edges.filter((e) => e.optional)

    // Build the required MATCH patterns first
    if (requiredEdges.length > 0) {
      this.compilePatternEdges(step.nodes, requiredEdges, emittedNodes, 'MATCH')
    }

    // Emit any standalone nodes not covered by edges
    const standaloneNodes = step.nodes.filter((n) => !emittedNodes.has(n.alias))
    for (const node of standaloneNodes) {
      const pattern = this.buildNodePattern(node)
      this.clauses.push(`MATCH ${pattern}`)
      emittedNodes.add(node.alias)
    }

    // Build OPTIONAL MATCH for optional edges
    if (optionalEdges.length > 0) {
      this.compilePatternEdges(step.nodes, optionalEdges, emittedNodes, 'OPTIONAL MATCH')
    }

    // Compile inline WHERE conditions
    this.compilePatternConditions(step)
  }

  /**
   * Build a Cypher node pattern string.
   */
  private buildNodePattern(node: PatternNode): string {
    let pattern = `(${node.alias}`

    if (node.labels?.length) {
      let labels: string
      if (this.schema && this.schema.nodes[node.labels[0]!]) {
        labels = formatLabels(resolveNodeLabels(this.schema, node.labels[0]!))
      } else if (this.schema) {
        labels = formatLabels(node.labels)
      } else {
        labels = `:${node.labels.join(':')}`
      }
      pattern += labels
    }

    if (node.id !== undefined) {
      const paramRef = this.addParam(node.id)
      pattern += ` {id: ${paramRef}}`
    }

    pattern += ')'
    return pattern
  }

  /**
   * Build a Cypher edge pattern with direction arrows.
   */
  private buildEdgePattern(edge: PatternEdge): {
    leftArrow: string
    rightArrow: string
    edgeStr: string
  } {
    const [leftArrow, rightArrow] = this.getArrow(edge.direction)
    const typesStr = edge.types.join('|')
    const aliasStr = edge.alias ?? ''

    let lengthStr = ''
    if (edge.variableLength) {
      const { min, max } = edge.variableLength
      if (max !== undefined) {
        lengthStr = `*${min}..${max}`
      } else {
        lengthStr = `*${min}..`
      }
    }

    const edgeStr = `[${aliasStr}:${typesStr}${lengthStr}]`
    return { leftArrow, rightArrow, edgeStr }
  }

  /**
   * Compile a set of pattern edges to MATCH clauses.
   */
  private compilePatternEdges(
    nodes: PatternNode[],
    edges: PatternEdge[],
    emittedNodes: Set<string>,
    keyword: 'MATCH' | 'OPTIONAL MATCH',
  ): void {
    const nodeMap = new Map(nodes.map((n) => [n.alias, n]))

    for (const edge of edges) {
      const fromNode = nodeMap.get(edge.from)
      const toNode = nodeMap.get(edge.to)

      const { leftArrow, rightArrow, edgeStr } = this.buildEdgePattern(edge)

      const fromPattern = emittedNodes.has(edge.from)
        ? `(${edge.from})`
        : this.buildNodePattern(fromNode ?? { alias: edge.from })

      const toPattern = emittedNodes.has(edge.to)
        ? `(${edge.to})`
        : this.buildNodePattern(toNode ?? { alias: edge.to })

      this.clauses.push(`${keyword} ${fromPattern}${leftArrow}${edgeStr}${rightArrow}${toPattern}`)

      emittedNodes.add(edge.from)
      emittedNodes.add(edge.to)
    }
  }

  /**
   * Compile inline WHERE conditions from pattern nodes and edges.
   */
  private compilePatternConditions(step: PatternStep): void {
    const conditions: string[] = []

    for (const node of step.nodes) {
      if (node.where?.length) {
        for (const condition of node.where) {
          conditions.push(this.compileCondition(condition))
        }
      }
    }

    for (const edge of step.edges) {
      if (edge.where?.length && edge.alias) {
        for (const edgeCond of edge.where) {
          const fieldRef = `${edge.alias}.${edgeCond.field}`
          const cypherOp = this.operatorToCypher(edgeCond.operator)

          if (edgeCond.operator === 'isNull') {
            conditions.push(`${fieldRef} IS NULL`)
          } else if (edgeCond.operator === 'isNotNull') {
            conditions.push(`${fieldRef} IS NOT NULL`)
          } else {
            const paramRef = this.addParam(edgeCond.value)
            conditions.push(`${fieldRef} ${cypherOp} ${paramRef}`)
          }
        }
      }
    }

    if (conditions.length > 0) {
      this.clauses.push(`WHERE ${conditions.join(' AND ')}`)
    }
  }

  // ===========================================================================
  // SUBQUERY COMPILATION (Spec 05)
  // ===========================================================================

  /**
   * Compile a correlated subquery step to CALL { ... } syntax.
   */
  private compileSubqueryStep(step: SubqueryStep): void {
    this.clauses.push('CALL {')

    if (step.correlatedAliases.length > 0) {
      this.clauses.push(`  WITH ${step.correlatedAliases.join(', ')}`)
    }

    const subResult = this.compileSteps(step.steps)

    for (const clause of subResult.clauses) {
      this.clauses.push(`  ${clause}`)
    }

    if (!subResult.hasReturn && step.exportedAliases.length > 0) {
      this.clauses.push(`  RETURN ${step.exportedAliases.join(', ')}`)
    }

    this.clauses.push('}')
  }

  /**
   * Compile a subquery condition to EXISTS/COUNT syntax.
   *
   * OPTIMIZATION: Detects the common "connected to node by ID" pattern
   * (a single traversal + WHERE id = value) and compiles it as an inline
   * MATCH pattern instead of EXISTS { ... }, enabling index-based lookup.
   */
  private compileSubqueryCondition(condition: SubqueryCondition): string {
    // Try optimization for exists/notExists: inline MATCH pattern
    if (condition.mode === 'exists' || condition.mode === 'notExists') {
      const optimized = this.tryCompileOptimizedConnectedTo(condition)
      if (optimized !== null) return optimized
    }

    const subResult = this.compileSteps(condition.query)
    const subqueryBody = subResult.clauses.join(' ')

    switch (condition.mode) {
      case 'exists':
        return `EXISTS { ${subqueryBody} }`

      case 'notExists':
        return `NOT EXISTS { ${subqueryBody} }`

      case 'count': {
        const { operator, value } = condition.countPredicate
        const cypherOp = this.operatorToCypher(operator)
        const paramRef = this.addParam(value)
        return `COUNT { ${subqueryBody} } ${cypherOp} ${paramRef}`
      }
    }
  }

  /**
   * Try to compile a subquery condition as an optimized inline pattern.
   *
   * Detects: EXISTS { MATCH (n)-[:EDGE]->(target) WHERE target.id = $p }
   * Compiles as: (n)-[:EDGE]->({id: $p})
   *
   * This is 10-100x faster because the query planner can use index lookups
   * on the target node ID instead of evaluating the full subquery.
   *
   * Returns null if the pattern doesn't match (falls back to generic compilation).
   */
  private tryCompileOptimizedConnectedTo(
    condition: SubqueryCondition,
  ): string | null {
    const { query } = condition

    // Pattern: exactly 1 traversal + 1 where step
    if (query.length !== 2) return null

    const [first, second] = query
    if (first!.type !== 'traversal' || second!.type !== 'where') return null

    const traversal = first as TraversalStep
    const whereStep = second as WhereStep

    // WHERE must have exactly 1 comparison on 'id' with 'eq'
    if (whereStep.conditions.length !== 1) return null
    const cond = whereStep.conditions[0]!
    if (cond.type !== 'comparison') return null
    if (cond.field !== 'id' || cond.operator !== 'eq') return null
    if (cond.target !== traversal.toAlias) return null

    // Pattern matches — compile as inline MATCH pattern
    const [leftArrow, rightArrow] = this.getArrow(traversal.direction)
    const edgeTypes = traversal.edges.join('|')
    const paramRef = this.addParam(cond.value)
    const pattern = `(${traversal.fromAlias})${leftArrow}[:${edgeTypes}]${rightArrow}({id: ${paramRef}})`

    return condition.mode === 'notExists' ? `NOT ${pattern}` : pattern
  }

  /**
   * Compile a list of steps without the full AST wrapper.
   * Used for subquery compilation.
   */
  private compileSteps(steps: ASTNode[]): {
    clauses: string[]
    params: Record<string, unknown>
    hasReturn: boolean
  } {
    const savedClauses = this.clauses
    const savedOrderBy = this.orderByClause
    const savedLimit = this.limitClause
    const savedSkip = this.skipClause
    const savedDistinct = this.hasDistinct
    const savedAggregate = this.aggregateStep
    const savedBranch = this.hasBranchStep

    this.clauses = []
    this.orderByClause = null
    this.limitClause = null
    this.skipClause = null
    this.hasDistinct = false
    this.aggregateStep = null
    this.hasBranchStep = false

    let hasReturn = false
    for (const step of steps) {
      if (step.type === 'return') hasReturn = true
      this.compileStep(step)
    }

    // Append ordering/pagination to sub-clauses
    if (this.orderByClause) this.clauses.push(this.orderByClause)
    if (this.skipClause) this.clauses.push(this.skipClause)
    if (this.limitClause) this.clauses.push(this.limitClause)

    const result = {
      clauses: this.clauses,
      params: this.params,
      hasReturn,
    }

    // Restore state
    this.clauses = savedClauses
    this.orderByClause = savedOrderBy
    this.limitClause = savedLimit
    this.skipClause = savedSkip
    this.hasDistinct = savedDistinct
    this.aggregateStep = savedAggregate
    this.hasBranchStep = savedBranch

    return result
  }

  // ===========================================================================
  // RETURN/PROJECTION COMPILATION (Spec 06)
  // ===========================================================================

  /**
   * Compile a ReturnStep to RETURN clause.
   */
  private compileReturnStep(step: ReturnStep): void {
    if (step.countOnly) {
      const alias =
        step.returns[0]?.kind === 'alias' ? step.returns[0].alias : 'n0'
      this.clauses.push(`RETURN count(${alias}) AS count`)
      return
    }

    if (step.existsOnly) {
      const alias =
        step.returns[0]?.kind === 'alias' ? step.returns[0].alias : 'n0'
      this.clauses.push(`RETURN count(${alias}) > 0 AS exists`)
      return
    }

    const returnExprs: string[] = []
    for (const ret of step.returns) {
      returnExprs.push(this.compileReturnItem(ret))
    }

    const distinct = this.hasDistinct ? 'DISTINCT ' : ''
    this.clauses.push(`RETURN ${distinct}${returnExprs.join(', ')}`)
  }

  /**
   * Compile a single return item.
   */
  private compileReturnItem(ret: ProjectionReturn): string {
    switch (ret.kind) {
      case 'alias': {
        if (ret.fields?.length) {
          return ret.fields.map((f) => `${ret.alias}.${f}`).join(', ')
        }
        const resultAlias =
          ret.resultAlias && ret.resultAlias !== ret.alias ? ` AS ${ret.resultAlias}` : ''
        return `${ret.alias}${resultAlias}`
      }
      case 'expression': {
        const exprStr = this.compileExpression(ret.expression)
        return `${exprStr} AS ${ret.resultAlias}`
      }
      case 'collect': {
        const distinct = ret.distinct ? 'DISTINCT ' : ''
        return `collect(${distinct}${ret.sourceAlias}) AS ${ret.resultAlias}`
      }
      case 'path': {
        const resultAlias =
          ret.resultAlias && ret.resultAlias !== ret.pathAlias ? ` AS ${ret.resultAlias}` : ''
        return `${ret.pathAlias}${resultAlias}`
      }
    }
  }

  /**
   * Compile a projection expression to Cypher.
   */
  private compileExpression(expr: ProjectionExpression): string {
    switch (expr.type) {
      case 'field':
        return `${expr.alias}.${expr.field}`
      case 'literal':
        return this.compileLiteralValue(expr.value)
      case 'param':
        return `$${expr.name}`
      case 'computed':
        return this.compileComputedExpression(expr)
      case 'case':
        return this.compileCaseExpression(expr)
      case 'function':
        return this.compileFunctionExpression(expr)
    }
  }

  /**
   * Compile a literal value to Cypher representation.
   */
  private compileLiteralValue(value: unknown): string {
    if (value === null) return 'null'
    if (typeof value === 'string') return `'${value.replace(/'/g, "\\'")}'`
    if (typeof value === 'number') return String(value)
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (Array.isArray(value)) {
      return `[${value.map((v) => this.compileLiteralValue(v)).join(', ')}]`
    }
    // For objects, use parameter
    const paramRef = this.addParam(value)
    return paramRef
  }

  /**
   * Compile computed expression with operator.
   */
  private compileComputedExpression(expr: {
    type: 'computed'
    operator: ComputedOperator
    operands: ProjectionExpression[]
  }): string {
    const operands = expr.operands.map((op) => this.compileExpression(op))

    switch (expr.operator) {
      // Arithmetic
      case 'add':
        return `(${operands[0]} + ${operands[1]})`
      case 'subtract':
        return `(${operands[0]} - ${operands[1]})`
      case 'multiply':
        return `(${operands[0]} * ${operands[1]})`
      case 'divide':
        return `(${operands[0]} / ${operands[1]})`
      case 'modulo':
        return `(${operands[0]} % ${operands[1]})`
      // Type conversions
      case 'toString':
        return `toString(${operands[0]})`
      case 'toInteger':
        return `toInteger(${operands[0]})`
      case 'toFloat':
        return `toFloat(${operands[0]})`
      case 'toBoolean':
        return `toBoolean(${operands[0]})`
      // String functions
      case 'trim':
        return `trim(${operands[0]})`
      case 'toLower':
        return `toLower(${operands[0]})`
      case 'toUpper':
        return `toUpper(${operands[0]})`
      case 'substring':
        return operands.length === 3
          ? `substring(${operands[0]}, ${operands[1]}, ${operands[2]})`
          : `substring(${operands[0]}, ${operands[1]})`
      case 'concat':
        return operands.join(' + ')
      case 'split':
        return `split(${operands[0]}, ${operands[1]})`
      case 'replace':
        return `replace(${operands[0]}, ${operands[1]}, ${operands[2]})`
      // Collection functions
      case 'size':
        return `size(${operands[0]})`
      case 'head':
        return `head(${operands[0]})`
      case 'tail':
        return `tail(${operands[0]})`
      case 'last':
        return `last(${operands[0]})`
      case 'reverse':
        return `reverse(${operands[0]})`
      // Null handling
      case 'coalesce':
        return `coalesce(${operands.join(', ')})`
      case 'nullIf':
        return `nullIf(${operands[0]}, ${operands[1]})`
    }
  }

  /**
   * Compile CASE WHEN expression.
   */
  private compileCaseExpression(expr: {
    type: 'case'
    branches: Array<{ when: WhereCondition; then: ProjectionExpression }>
    else?: ProjectionExpression
  }): string {
    const parts: string[] = ['CASE']

    for (const branch of expr.branches) {
      const whenCondition = this.compileCondition(branch.when)
      const thenExpr = this.compileExpression(branch.then)
      parts.push(`WHEN ${whenCondition} THEN ${thenExpr}`)
    }

    if (expr.else) {
      parts.push(`ELSE ${this.compileExpression(expr.else)}`)
    }

    parts.push('END')
    return parts.join(' ')
  }

  /**
   * Compile function call expression.
   */
  private compileFunctionExpression(expr: {
    type: 'function'
    name: string
    args: ProjectionExpression[]
  }): string {
    const args = expr.args.map((arg) => this.compileExpression(arg))
    return `${expr.name}(${args.join(', ')})`
  }

  // ===========================================================================
  // UNWIND COMPILATION (Spec 07)
  // ===========================================================================

  /**
   * Compile an unwind step to UNWIND clause.
   */
  private compileUnwind(step: UnwindStep): void {
    this.clauses.push(`UNWIND ${step.sourceAlias}.${step.field} AS ${step.itemAlias}`)
  }

  // ===========================================================================

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
  schema?: SchemaShape,
  options?: CompilerOptions,
): CypherCompiler {
  return new CypherCompiler(schema, options)
}
