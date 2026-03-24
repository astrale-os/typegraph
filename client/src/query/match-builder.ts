/**
 * MatchBuilder — Declarative Pattern Matching Query Builder
 *
 * Provides a fluent API for matching complex graph patterns (diamonds, cycles,
 * multi-point joins) using Cypher MATCH semantics.
 *
 * Internally converts MatchConfig to AST PatternStep via QueryAST.addPattern().
 *
 * @example
 * ```typescript
 * const results = await graph.match({
 *   nodes: { a: 'user', b: 'post', c: 'category' },
 *   edges: [
 *     { from: 'a', to: 'b', type: 'authored' },
 *     { from: 'b', to: 'c', type: 'categorizedAs' },
 *   ],
 * })
 * .where('a', 'status', 'eq', 'active')
 * .limit(10)
 * .compile()
 * ```
 */

import type { NodeLabels } from '../inference'
import type { SchemaShape } from '../schema'
import type { QueryAST } from './ast'
import type { ComparisonOperator, WhereCondition } from './ast'
import type { CompiledQuery } from './compiler'
import type { QueryExecutor } from './types'

import { getCompiler, getQueryPipeline } from './compiler'

// =============================================================================
// CONFIG TYPES
// =============================================================================

/**
 * Configuration for a match query.
 * Internally converts to AST PatternStep.
 */
export interface MatchConfig<S extends SchemaShape> {
  /** Node aliases mapped to labels or full config */
  nodes: Record<string, NodeLabels<S> | MatchNodeConfig>
  /** Edge connections between nodes */
  edges: MatchEdgeConfig[]
}

export interface MatchNodeConfig {
  /** Node labels */
  labels: string[]
  /** Match by specific ID */
  id?: string
  /** Inline WHERE conditions */
  where?: Array<{
    field: string
    operator: ComparisonOperator
    value: unknown
  }>
}

export interface MatchEdgeConfig {
  /** Source node alias */
  from: string
  /** Target node alias */
  to: string
  /** Edge type(s) */
  type: string | string[]
  /** Direction (default: 'out') */
  direction?: 'out' | 'in' | 'both'
  /** Optional edge (LEFT JOIN semantics) */
  optional?: boolean
  /** Edge alias for referencing in WHERE/RETURN */
  as?: string
  /** Variable-length path */
  variableLength?: { min?: number; max?: number }
}

// =============================================================================
// MATCH BUILDER
// =============================================================================

export class MatchBuilder<S extends SchemaShape> {
  protected readonly _ast: QueryAST
  protected readonly _schema: S
  protected readonly _executor: QueryExecutor | null
  protected readonly _nodeAliases: Set<string>

  constructor(ast: QueryAST, schema: S, executor: QueryExecutor | null, nodeAliases: Set<string>) {
    this._ast = ast
    this._schema = schema
    this._executor = executor
    this._nodeAliases = nodeAliases
  }

  // ---------------------------------------------------------------------------
  // WHERE
  // ---------------------------------------------------------------------------

  /**
   * Add WHERE condition on a specific pattern node.
   *
   * @param alias - The node alias defined in the pattern
   * @param field - Field name on that node
   * @param operator - Comparison operator
   * @param value - Value to compare against
   */
  where<A extends string>(
    alias: A,
    field: string,
    operator: ComparisonOperator,
    value: unknown,
  ): MatchBuilder<S> {
    if (!this._nodeAliases.has(alias)) {
      throw new Error(
        `Unknown pattern alias: ${alias}. Available: ${[...this._nodeAliases].join(', ')}`,
      )
    }

    const condition: WhereCondition = {
      type: 'comparison',
      field,
      operator,
      value,
      target: alias,
    }

    const newAst = this._ast.addWhere([condition])
    return new MatchBuilder(newAst, this._schema, this._executor, this._nodeAliases)
  }

  /**
   * Add multiple WHERE conditions (AND).
   */
  whereAll(conditions: Array<[string, string, ComparisonOperator, unknown]>): MatchBuilder<S> {
    const compiled: WhereCondition[] = conditions.map(([alias, field, operator, value]) => {
      if (!this._nodeAliases.has(alias)) {
        throw new Error(`Unknown pattern alias: ${alias}`)
      }
      return {
        type: 'comparison' as const,
        field,
        operator,
        value,
        target: alias,
      }
    })

    const newAst = this._ast.addWhere(compiled)
    return new MatchBuilder(newAst, this._schema, this._executor, this._nodeAliases)
  }

  /**
   * Add WHERE condition comparing fields across two pattern aliases.
   *
   * @example pattern.whereCompare('user', 'createdAt', 'lt', 'project', 'startDate')
   */
  whereCompare(
    alias1: string,
    field1: string,
    operator: ComparisonOperator,
    alias2: string,
    field2: string,
  ): MatchBuilder<S> {
    if (!this._nodeAliases.has(alias1)) {
      throw new Error(`Unknown pattern alias: ${alias1}`)
    }
    if (!this._nodeAliases.has(alias2)) {
      throw new Error(`Unknown pattern alias: ${alias2}`)
    }

    const condition: WhereCondition = {
      type: 'aliasComparison',
      leftAlias: alias1,
      leftField: field1,
      operator,
      rightAlias: alias2,
      rightField: field2,
    }

    const newAst = this._ast.addWhere([condition])
    return new MatchBuilder(newAst, this._schema, this._executor, this._nodeAliases)
  }

  // ---------------------------------------------------------------------------
  // ORDERING & PAGINATION
  // ---------------------------------------------------------------------------

  /**
   * Order results by a field on a specific alias.
   */
  orderBy(alias: string, field: string, direction: 'ASC' | 'DESC' = 'ASC'): MatchBuilder<S> {
    if (!this._nodeAliases.has(alias)) {
      throw new Error(`Unknown pattern alias: ${alias}`)
    }

    const newAst = this._ast.addOrderBy([{ field, direction, target: alias }])
    return new MatchBuilder(newAst, this._schema, this._executor, this._nodeAliases)
  }

  skip(count: number): MatchBuilder<S> {
    const newAst = this._ast.addSkip(count)
    return new MatchBuilder(newAst, this._schema, this._executor, this._nodeAliases)
  }

  limit(count: number): MatchBuilder<S> {
    const newAst = this._ast.addLimit(count)
    return new MatchBuilder(newAst, this._schema, this._executor, this._nodeAliases)
  }

  // ---------------------------------------------------------------------------
  // COMPILATION & INSPECTION
  // ---------------------------------------------------------------------------

  /** Access the underlying AST */
  get ast(): QueryAST {
    return this._ast
  }

  /** Run pipeline + compile on the given AST (defaults to this._ast) */
  private _compile(ast: QueryAST = this._ast): CompiledQuery {
    const pipeline = getQueryPipeline(this._schema)
    const transformedAst = pipeline.run(ast, this._schema)
    return getCompiler(this._schema).compile(transformedAst)
  }

  /** Compile the query to Cypher */
  compile(): CompiledQuery {
    return this._compile()
  }

  /** Get the compiled Cypher string */
  toCypher(): string {
    return this.compile().cypher
  }

  /** Get the compiled parameters */
  toParams(): Record<string, unknown> {
    return this.compile().params
  }

  /** Get the underlying AST */
  toAST(): QueryAST {
    return this._ast
  }

  // ---------------------------------------------------------------------------
  // EXECUTION
  // ---------------------------------------------------------------------------

  /** Execute and return all matched patterns */
  async execute<T = Record<string, unknown>>(): Promise<T[]> {
    if (!this._executor) {
      throw new Error(
        'Cannot execute: no query executor configured. Use compile() for compile-only mode.',
      )
    }
    const compiled = this.compile()
    return this._executor.run<T>(compiled.cypher, compiled.params, this._ast)
  }

  /** Execute and return first match or null */
  async executeFirst<T = Record<string, unknown>>(): Promise<T | null> {
    const limited = this.limit(1)
    const results = await limited.execute<T>()
    return results[0] ?? null
  }

  /** Count matching patterns */
  async count(): Promise<number> {
    if (!this._executor) {
      throw new Error('Cannot execute: no query executor configured.')
    }
    // Use count projection
    const countAst = this._ast.setProjection({
      type: 'count',
      nodeAliases: [...this._nodeAliases],
      edgeAliases: [],
      countOnly: true,
    })
    const compiled = this._compile(countAst)
    const results = await this._executor.run<{ count: number }>(compiled.cypher, compiled.params)
    return results[0]?.count ?? 0
  }

  /** Check if any patterns match */
  async exists(): Promise<boolean> {
    const c = await this.limit(1).count()
    return c > 0
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Convert MatchConfig to AST pattern nodes and edges,
 * then build the QueryAST via addPattern().
 */
export function buildMatchAST<S extends SchemaShape>(
  config: MatchConfig<S>,
  baseAst: QueryAST,
): { ast: QueryAST; nodeAliases: Set<string> } {
  const patternNodes = Object.entries(config.nodes).map(([alias, labelOrConfig]) => {
    if (typeof labelOrConfig === 'string') {
      return { alias, labels: [labelOrConfig] }
    }
    const cfg = labelOrConfig as MatchNodeConfig
    return {
      alias,
      labels: cfg.labels,
      id: cfg.id,
      where: cfg.where?.map((w) => ({
        type: 'comparison' as const,
        field: w.field,
        operator: w.operator,
        value: w.value,
        target: alias,
      })),
    }
  })

  const patternEdges = config.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    types: Array.isArray(edge.type) ? edge.type : [edge.type],
    direction: edge.direction ?? ('out' as const),
    optional: edge.optional ?? false,
    alias: edge.as,
    variableLength: edge.variableLength
      ? {
          min: edge.variableLength.min ?? 1,
          max: edge.variableLength.max,
          uniqueness: 'nodes' as const,
        }
      : undefined,
  }))

  const ast = baseAst.addPattern({
    nodes: patternNodes,
    edges: patternEdges,
  })

  return { ast, nodeAliases: new Set(Object.keys(config.nodes)) }
}
