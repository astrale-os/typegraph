/**
 * Immutable AST Builder
 *
 * Provides methods to construct query ASTs in an immutable fashion.
 * Each method returns a new QueryAST instance.
 */

import type {
  ASTNode,
  MatchStep,
  MatchByIdStep,
  TraversalStep,
  WhereStep,
  WhereCondition,
  EdgeWhereCondition,
  Projection,
  ProjectionType,
  AliasRegistry,
  AliasInfo,
  VariableLengthConfig,
  BranchStep,
  PathStep,
  AggregateStep,
  OrderByStep,
  AliasStep,
  HierarchyStep,
  ReachableStep,
  ForkStep,
} from './types'
import { createDefaultProjection } from './types'

/**
 * Immutable query AST representation.
 * Tracks the current node context for chaining operations.
 */
export class QueryAST {
  private readonly _steps: ReadonlyArray<ASTNode>
  private readonly _projection: Projection
  private readonly _aliases: AliasRegistry
  private readonly _userAliases: Map<string, string>
  private readonly _edgeUserAliases: Map<string, string>
  private readonly _aliasCounter: number
  private readonly _currentNodeAlias: string
  private readonly _currentNodeLabel: string

  constructor(
    steps: ASTNode[] = [],
    projection: Projection = { type: 'collection', nodeAliases: ['n0'], edgeAliases: [] },
    aliases: AliasRegistry = new Map(),
    userAliases: Map<string, string> = new Map(),
    edgeUserAliases: Map<string, string> = new Map(),
    aliasCounter: number = 0,
    currentNodeAlias: string = 'n0',
    currentNodeLabel: string = '',
  ) {
    this._steps = Object.freeze([...steps])
    this._projection = projection
    this._aliases = new Map(aliases)
    this._userAliases = new Map(userAliases)
    this._edgeUserAliases = new Map(edgeUserAliases)
    this._aliasCounter = aliasCounter
    this._currentNodeAlias = currentNodeAlias
    this._currentNodeLabel = currentNodeLabel
  }

  get steps(): ReadonlyArray<ASTNode> {
    return this._steps
  }

  get projection(): Projection {
    return this._projection
  }

  get aliases(): ReadonlyMap<string, AliasInfo> {
    return this._aliases
  }

  get userAliases(): ReadonlyMap<string, string> {
    return this._userAliases
  }

  get edgeUserAliases(): ReadonlyMap<string, string> {
    return this._edgeUserAliases
  }

  /** Get the internal alias of the current node in the query chain */
  get currentAlias(): string {
    return this._currentNodeAlias
  }

  /** Get the label of the current node in the query chain */
  get currentLabel(): string {
    return this._currentNodeLabel
  }

  resolveUserAlias(userAlias: string): string | undefined {
    return this._userAliases.get(userAlias)
  }

  resolveEdgeUserAlias(userAlias: string): string | undefined {
    return this._edgeUserAliases.get(userAlias)
  }

  getRegisteredUserAliases(): string[] {
    return Array.from(this._userAliases.keys())
  }

  getRegisteredEdgeUserAliases(): string[] {
    return Array.from(this._edgeUserAliases.keys())
  }

  private nextAlias(prefix: 'n' | 'e' | 'p' = 'n'): [string, number] {
    const alias = `${prefix}${this._aliasCounter}`
    return [alias, this._aliasCounter + 1]
  }

  private createNew(
    steps: ASTNode[],
    projection: Projection = this._projection,
    aliases: AliasRegistry = new Map(this._aliases),
    userAliases: Map<string, string> = new Map(this._userAliases),
    edgeUserAliases: Map<string, string> = new Map(this._edgeUserAliases),
    aliasCounter: number = this._aliasCounter,
    currentNodeAlias: string = this._currentNodeAlias,
    currentNodeLabel: string = this._currentNodeLabel,
  ): QueryAST {
    return new QueryAST(
      steps,
      projection,
      aliases,
      userAliases,
      edgeUserAliases,
      aliasCounter,
      currentNodeAlias,
      currentNodeLabel,
    )
  }

  addMatch(label: string): QueryAST {
    const [alias, newCounter] = this.nextAlias('n')
    const step: MatchStep = {
      type: 'match',
      label,
      alias,
    }

    const newAliases = new Map(this._aliases)
    newAliases.set(alias, {
      internalAlias: alias,
      type: 'node',
      label,
      sourceStep: this._steps.length,
    })

    return this.createNew(
      [...this._steps, step],
      createDefaultProjection(alias),
      newAliases,
      new Map(this._userAliases),
      new Map(this._edgeUserAliases),
      newCounter,
      alias,
      label,
    )
  }

  /**
   * Add a match-by-ID step (label-agnostic node lookup).
   * Used when the node type is unknown or for polymorphic queries.
   */
  addMatchById(id: string): QueryAST {
    const [alias, newCounter] = this.nextAlias('n')
    const step: MatchByIdStep = {
      type: 'matchById',
      id,
      alias,
    }

    const newAliases = new Map(this._aliases)
    newAliases.set(alias, {
      internalAlias: alias,
      type: 'node',
      label: '', // Unknown label for polymorphic queries
      sourceStep: this._steps.length,
    })

    return this.createNew(
      [...this._steps, step],
      createDefaultProjection(alias),
      newAliases,
      new Map(this._userAliases),
      new Map(this._edgeUserAliases),
      newCounter,
      alias,
      '', // Unknown label
    )
  }

  addTraversal(config: {
    edges: string[]
    direction: 'out' | 'in' | 'both'
    toLabels: string[]
    variableLength?: VariableLengthConfig
    optional?: boolean
    cardinality: 'one' | 'many' | 'optional' | 'mixed'
    edgeWhere?: EdgeWhereCondition[]
    edgeUserAlias?: string
  }): QueryAST {
    const [nodeAlias, counter1] = this.nextAlias('n')
    const [edgeAlias, counter2] = [`e${counter1}`, counter1 + 1]

    const step: TraversalStep = {
      type: 'traversal',
      edges: config.edges,
      direction: config.direction,
      fromAlias: this._currentNodeAlias,
      toAlias: nodeAlias,
      toLabels: config.toLabels,
      variableLength: config.variableLength,
      edgeAlias,
      edgeUserAlias: config.edgeUserAlias,
      optional: config.optional ?? false,
      cardinality: config.cardinality,
      edgeWhere: config.edgeWhere,
    }

    const newAliases = new Map(this._aliases)
    newAliases.set(nodeAlias, {
      internalAlias: nodeAlias,
      type: 'node',
      label: config.toLabels[0] ?? '',
      sourceStep: this._steps.length,
    })
    newAliases.set(edgeAlias, {
      internalAlias: edgeAlias,
      type: 'edge',
      label: config.edges[0] ?? '',
      sourceStep: this._steps.length,
    })

    const newEdgeUserAliases = new Map(this._edgeUserAliases)
    if (config.edgeUserAlias) {
      newEdgeUserAliases.set(config.edgeUserAlias, edgeAlias)
    }

    return this.createNew(
      [...this._steps, step],
      createDefaultProjection(nodeAlias),
      newAliases,
      new Map(this._userAliases),
      newEdgeUserAliases,
      counter2,
      nodeAlias,
      config.toLabels[0] ?? '',
    )
  }

  addWhere(conditions: WhereCondition[]): QueryAST {
    const step: WhereStep = {
      type: 'where',
      conditions,
    }
    return this.createNew([...this._steps, step])
  }

  addUserAlias(userAlias: string): QueryAST {
    const step: AliasStep = {
      type: 'alias',
      internalAlias: this._currentNodeAlias,
      userAlias,
      label: this._currentNodeLabel,
    }

    const newUserAliases = new Map(this._userAliases)
    newUserAliases.set(userAlias, this._currentNodeAlias)

    const newAliases = new Map(this._aliases)
    const existingInfo = newAliases.get(this._currentNodeAlias)
    if (existingInfo) {
      newAliases.set(this._currentNodeAlias, {
        ...existingInfo,
        userAlias,
      })
    }

    return this.createNew([...this._steps, step], this._projection, newAliases, newUserAliases)
  }

  addEdgeUserAlias(userAlias: string, edgeInternalAlias: string): QueryAST {
    const newEdgeUserAliases = new Map(this._edgeUserAliases)
    newEdgeUserAliases.set(userAlias, edgeInternalAlias)

    const newAliases = new Map(this._aliases)
    const existingInfo = newAliases.get(edgeInternalAlias)
    if (existingInfo) {
      newAliases.set(edgeInternalAlias, {
        ...existingInfo,
        userAlias,
      })
    }

    return this.createNew(
      [...this._steps],
      this._projection,
      newAliases,
      new Map(this._userAliases),
      newEdgeUserAliases,
    )
  }

  addHierarchy(config: {
    operation: HierarchyStep['operation']
    edge: string
    hierarchyDirection: 'up' | 'down'
    minDepth?: number
    maxDepth?: number
    includeDepth?: boolean
    depthAlias?: string
    includeSelf?: boolean
    untilKind?: string
  }): QueryAST {
    const [nodeAlias, newCounter] = this.nextAlias('n')

    const step: HierarchyStep = {
      type: 'hierarchy',
      operation: config.operation,
      edge: config.edge,
      fromAlias: this._currentNodeAlias,
      toAlias: nodeAlias,
      minDepth: config.minDepth,
      maxDepth: config.maxDepth,
      hierarchyDirection: config.hierarchyDirection,
      includeDepth: config.includeDepth,
      depthAlias: config.depthAlias,
      includeSelf: config.includeSelf,
      untilKind: config.untilKind,
    }

    const newAliases = new Map(this._aliases)
    newAliases.set(nodeAlias, {
      internalAlias: nodeAlias,
      type: 'node',
      label: this._currentNodeLabel,
      sourceStep: this._steps.length,
    })

    return this.createNew(
      [...this._steps, step],
      createDefaultProjection(nodeAlias),
      newAliases,
      new Map(this._userAliases),
      new Map(this._edgeUserAliases),
      newCounter,
      nodeAlias,
      this._currentNodeLabel,
    )
  }

  addBranch(config: {
    operator: 'union' | 'intersect'
    branches: QueryAST[]
    distinct?: boolean
  }): QueryAST {
    const step: BranchStep = {
      type: 'branch',
      operator: config.operator,
      branches: config.branches.map((b) => [...b.steps]),
      distinct: config.distinct ?? true,
    }
    return this.createNew([...this._steps, step])
  }

  /**
   * Add a fork step for fan-out patterns.
   * Each branch starts from the current node and can traverse independently.
   * Aliases from all branches are merged into the result.
   */
  addFork(branches: QueryAST[]): QueryAST {
    const step: ForkStep = {
      type: 'fork',
      sourceAlias: this._currentNodeAlias,
      branches: branches.map((b) => ({
        steps: [...b.steps],
        userAliases: Object.fromEntries(b.userAliases),
        edgeUserAliases: Object.fromEntries(b.edgeUserAliases),
      })),
    }

    // Merge aliases from all branches
    const mergedUserAliases = new Map(this._userAliases)
    const mergedEdgeUserAliases = new Map(this._edgeUserAliases)
    const mergedAliases = new Map(this._aliases)

    // Track the highest alias counter across branches
    let maxCounter = this._aliasCounter

    for (const branch of branches) {
      // Merge user aliases
      for (const [key, value] of branch.userAliases) {
        mergedUserAliases.set(key, value)
      }
      // Merge edge user aliases
      for (const [key, value] of branch.edgeUserAliases) {
        mergedEdgeUserAliases.set(key, value)
      }
      // Merge internal aliases
      for (const [key, value] of branch.aliases) {
        mergedAliases.set(key, value)
      }
      // Extract counter from branch's current alias (e.g., "n5" -> 5)
      const branchCounter = parseInt(branch.currentAlias.slice(1), 10)
      if (!isNaN(branchCounter) && branchCounter >= maxCounter) {
        maxCounter = branchCounter + 1
      }
    }

    return this.createNew(
      [...this._steps, step],
      this._projection,
      mergedAliases,
      mergedUserAliases,
      mergedEdgeUserAliases,
      maxCounter,
      this._currentNodeAlias,
      this._currentNodeLabel,
    )
  }

  addReachable(config: {
    edges: string[]
    direction: 'out' | 'in' | 'both'
    minDepth?: number
    maxDepth?: number
    includeDepth?: boolean
    depthAlias?: string
    uniqueness?: 'nodes' | 'edges' | 'none'
    includeSelf?: boolean
  }): QueryAST {
    const [nodeAlias, newCounter] = this.nextAlias('n')

    const step: ReachableStep = {
      type: 'reachable',
      edges: config.edges,
      direction: config.direction,
      fromAlias: this._currentNodeAlias,
      toAlias: nodeAlias,
      minDepth: config.minDepth,
      maxDepth: config.maxDepth,
      includeDepth: config.includeDepth,
      depthAlias: config.depthAlias,
      uniqueness: config.uniqueness ?? 'nodes',
      includeSelf: config.includeSelf,
    }

    const newAliases = new Map(this._aliases)
    newAliases.set(nodeAlias, {
      internalAlias: nodeAlias,
      type: 'node',
      label: this._currentNodeLabel,
      sourceStep: this._steps.length,
    })

    return this.createNew(
      [...this._steps, step],
      createDefaultProjection(nodeAlias),
      newAliases,
      new Map(this._userAliases),
      new Map(this._edgeUserAliases),
      newCounter,
      nodeAlias,
      this._currentNodeLabel,
    )
  }

  addPath(config: {
    algorithm: PathStep['algorithm']
    toAlias: string
    edge: string
    direction: 'out' | 'in' | 'both'
    maxHops?: number
  }): QueryAST {
    const [pathAlias, newCounter] = this.nextAlias('p')

    const step: PathStep = {
      type: 'path',
      algorithm: config.algorithm,
      fromAlias: this._currentNodeAlias,
      toAlias: config.toAlias,
      edge: config.edge,
      direction: config.direction,
      maxHops: config.maxHops,
      pathAlias,
    }

    const newAliases = new Map(this._aliases)
    newAliases.set(pathAlias, {
      internalAlias: pathAlias,
      type: 'path',
      label: config.edge,
      sourceStep: this._steps.length,
    })

    return this.createNew(
      [...this._steps, step],
      { ...this._projection, pathAlias },
      newAliases,
      new Map(this._userAliases),
      new Map(this._edgeUserAliases),
      newCounter,
    )
  }

  addAggregate(config: {
    groupBy?: Array<{ alias: string; field: string }>
    aggregations: AggregateStep['aggregations']
  }): QueryAST {
    const step: AggregateStep = {
      type: 'aggregate',
      groupBy: config.groupBy ?? [],
      aggregations: config.aggregations,
    }

    return this.createNew([...this._steps, step], {
      ...this._projection,
      aggregate: {
        groupBy: config.groupBy ?? [],
        aggregations: config.aggregations,
      },
    })
  }

  addOrderBy(fields: OrderByStep['fields']): QueryAST {
    const step: OrderByStep = {
      type: 'orderBy',
      fields,
    }
    return this.createNew([...this._steps, step])
  }

  addLimit(count: number): QueryAST {
    const step = { type: 'limit' as const, count }
    return this.createNew([...this._steps, step])
  }

  addSkip(count: number): QueryAST {
    const step = { type: 'skip' as const, count }
    return this.createNew([...this._steps, step])
  }

  addDistinct(): QueryAST {
    const step = { type: 'distinct' as const }
    return this.createNew([...this._steps, step])
  }

  setProjection(projection: Projection): QueryAST {
    return this.createNew([...this._steps], projection)
  }

  setMultiNodeProjection(
    nodeAliases: string[],
    edgeAliases: string[] = [],
    collectAliases?: Record<string, { sourceAlias: string; distinct?: boolean }>,
  ): QueryAST {
    for (const alias of nodeAliases) {
      if (!this._userAliases.has(alias)) {
        throw new Error(`Unknown node alias: ${alias}. Did you forget to call .as('${alias}')?`)
      }
    }

    for (const alias of edgeAliases) {
      if (!this._edgeUserAliases.has(alias)) {
        throw new Error(
          `Unknown edge alias: ${alias}. Did you forget to capture it with toWithEdge()?`,
        )
      }
    }

    // Validate collect aliases
    if (collectAliases) {
      for (const [resultAlias, spec] of Object.entries(collectAliases)) {
        if (!this._userAliases.has(spec.sourceAlias)) {
          throw new Error(
            `Unknown collect source alias: ${spec.sourceAlias}. Did you forget to call .as('${spec.sourceAlias}')?`,
          )
        }
        // Result alias should not conflict with node/edge aliases
        if (nodeAliases.includes(resultAlias) || edgeAliases.includes(resultAlias)) {
          throw new Error(`Collect result alias '${resultAlias}' conflicts with an existing alias`)
        }
      }
    }

    const projection: Projection = {
      type: 'multiNode',
      nodeAliases,
      edgeAliases,
      collectAliases,
    }

    return this.createNew([...this._steps], projection)
  }

  setCountProjection(): QueryAST {
    return this.createNew([...this._steps], { ...this._projection, type: 'count', countOnly: true })
  }

  setExistsProjection(): QueryAST {
    return this.createNew([...this._steps], {
      ...this._projection,
      type: 'exists',
      existsOnly: true,
    })
  }

  setProjectionType(type: ProjectionType): QueryAST {
    return this.createNew([...this._steps], { ...this._projection, type })
  }

  setFieldSelection(alias: string, fields: string[]): QueryAST {
    const newFields = { ...this._projection.fields, [alias]: fields }
    return this.createNew([...this._steps], { ...this._projection, fields: newFields })
  }

  setIncludeDepth(_depthAlias: string = 'depth'): QueryAST {
    return this.createNew([...this._steps], { ...this._projection, includeDepth: true })
  }

  clone(): QueryAST {
    return this.createNew([...this._steps])
  }

  /**
   * Create a copy of this AST with an offset alias counter.
   * Used by fork() to ensure each branch gets unique aliases.
   */
  withAliasOffset(offset: number): QueryAST {
    return this.createNew(
      [...this._steps],
      this._projection,
      new Map(this._aliases),
      new Map(this._userAliases),
      new Map(this._edgeUserAliases),
      this._aliasCounter + offset,
      this._currentNodeAlias,
      this._currentNodeLabel,
    )
  }

  /**
   * Get the current alias counter value.
   */
  get aliasCounter(): number {
    return this._aliasCounter
  }

  validate(): void {
    // Validate that all referenced aliases exist
    for (const step of this._steps) {
      if (step.type === 'traversal') {
        if (!this._aliases.has(step.fromAlias)) {
          throw new Error(`Invalid AST: traversal references unknown alias '${step.fromAlias}'`)
        }
      }
      if (step.type === 'where') {
        for (const condition of step.conditions) {
          if (condition.type === 'comparison' && !this._aliases.has(condition.target)) {
            throw new Error(
              `Invalid AST: where condition references unknown alias '${condition.target}'`,
            )
          }
        }
      }
    }
  }

  toJSON(): object {
    return {
      steps: this._steps,
      projection: this._projection,
      aliases: Object.fromEntries(this._aliases),
      userAliases: Object.fromEntries(this._userAliases),
      edgeUserAliases: Object.fromEntries(this._edgeUserAliases),
      currentNodeAlias: this._currentNodeAlias,
      currentNodeLabel: this._currentNodeLabel,
    }
  }
}
