/**
 * Grouped Builder
 *
 * Represents a grouped query for aggregation operations.
 * Created by CollectionBuilder.groupBy().
 */

import type { QueryAST, ComparisonOperator } from "../ast"
import type { CompiledQuery } from "../compiler"
import { CypherCompiler } from "../compiler"
import type { AnySchema, NodeLabels, NodeProps } from "../schema"
import type { QueryExecutor } from "./entry"
import { ExecutionError } from "../errors"
import { convertNeo4jValue } from "../utils"

/**
 * Infer the result type of a grouped aggregation.
 */
export type GroupedResult<
  S extends AnySchema,
  N extends NodeLabels<S>,
  GroupKeys extends keyof NodeProps<S, N>,
  Aggregations extends Record<string, unknown>,
> = Pick<NodeProps<S, N>, GroupKeys> & Aggregations

/**
 * Builder for grouped aggregation queries.
 *
 * @template S - Schema type
 * @template N - Node label being aggregated
 * @template K - Fields being grouped by
 */
export class GroupedBuilder<S extends AnySchema, N extends NodeLabels<S>, K extends keyof NodeProps<S, N> & string> {
  protected readonly _ast: QueryAST
  protected readonly _schema: S
  protected readonly _groupFields: K[]
  protected readonly _aggregations: Array<{
    function: "count" | "sum" | "avg" | "min" | "max" | "collect"
    field?: string
    alias: string
    distinct?: boolean
  }>
  protected readonly _executor: QueryExecutor | null
  protected readonly _orderBy: Array<{ field: string; direction: "ASC" | "DESC" }> | null
  protected readonly _limit: number | null
  protected readonly _skip: number | null

  constructor(
    ast: QueryAST,
    schema: S,
    groupFields: K[],
    aggregations: typeof GroupedBuilder.prototype._aggregations = [],
    executor: QueryExecutor | null = null,
    orderBy: Array<{ field: string; direction: "ASC" | "DESC" }> | null = null,
    limit: number | null = null,
    skip: number | null = null,
  ) {
    this._ast = ast
    this._schema = schema
    this._groupFields = groupFields
    this._aggregations = aggregations
    this._executor = executor
    this._orderBy = orderBy
    this._limit = limit
    this._skip = skip
  }

  private _clone(updates: {
    aggregations?: typeof GroupedBuilder.prototype._aggregations
    orderBy?: Array<{ field: string; direction: "ASC" | "DESC" }> | null
    limit?: number | null
    skip?: number | null
  }): GroupedBuilder<S, N, K> {
    return new GroupedBuilder(
      this._ast,
      this._schema,
      this._groupFields,
      updates.aggregations ?? this._aggregations,
      this._executor,
      updates.orderBy !== undefined ? updates.orderBy : this._orderBy,
      updates.limit !== undefined ? updates.limit : this._limit,
      updates.skip !== undefined ? updates.skip : this._skip,
    )
  }

  count(options?: { distinct?: boolean; alias?: string }): GroupedBuilder<S, N, K> {
    const alias = options?.alias ?? "count"
    return this._clone({
      aggregations: [...this._aggregations, { function: "count", alias, distinct: options?.distinct }],
    })
  }

  sum<F extends keyof NodeProps<S, N> & string>(field: F, options?: { alias?: string }): GroupedBuilder<S, N, K> {
    const alias = options?.alias ?? `sum_${field}`
    return this._clone({
      aggregations: [...this._aggregations, { function: "sum", field, alias }],
    })
  }

  avg<F extends keyof NodeProps<S, N> & string>(field: F, options?: { alias?: string }): GroupedBuilder<S, N, K> {
    const alias = options?.alias ?? `avg_${field}`
    return this._clone({
      aggregations: [...this._aggregations, { function: "avg", field, alias }],
    })
  }

  min<F extends keyof NodeProps<S, N> & string>(field: F, options?: { alias?: string }): GroupedBuilder<S, N, K> {
    const alias = options?.alias ?? `min_${field}`
    return this._clone({
      aggregations: [...this._aggregations, { function: "min", field, alias }],
    })
  }

  max<F extends keyof NodeProps<S, N> & string>(field: F, options?: { alias?: string }): GroupedBuilder<S, N, K> {
    const alias = options?.alias ?? `max_${field}`
    return this._clone({
      aggregations: [...this._aggregations, { function: "max", field, alias }],
    })
  }

  collect<F extends keyof NodeProps<S, N> & string>(
    field: F,
    options?: { alias?: string; distinct?: boolean },
  ): GroupedBuilder<S, N, K> {
    const alias = options?.alias ?? `${field}s`
    return this._clone({
      aggregations: [...this._aggregations, { function: "collect", field, alias, distinct: options?.distinct }],
    })
  }

  /**
   * Filter aggregated results. Not yet implemented.
   * @example
   * ```typescript
   * .having('count', 'gt', 5) // Only groups with count > 5
   * ```
   */
  having(
    _aggregationAlias: string,
    _operator: ComparisonOperator,
    _value: number,
  ): GroupedBuilder<S, N, K> {
    // HAVING is complex - requires post-aggregation filtering
    // Cypher doesn't have HAVING, would need WITH + WHERE pattern
    throw new Error("HAVING not yet implemented - use WHERE on a subquery instead")
  }

  /**
   * Order the aggregated results.
   * Can order by group fields or aggregation result aliases.
   *
   * @example
   * ```typescript
   * .groupBy('status')
   * .count({ alias: 'cnt' })
   * .orderBy('cnt', 'DESC')  // Order by count descending
   * ```
   */
  orderBy(field: K | string, direction: "ASC" | "DESC" = "ASC"): GroupedBuilder<S, N, K> {
    const newOrderBy = [...(this._orderBy ?? []), { field: field as string, direction }]
    return this._clone({ orderBy: newOrderBy })
  }

  /**
   * Limit the number of grouped results.
   */
  limit(count: number): GroupedBuilder<S, N, K> {
    return this._clone({ limit: count })
  }

  /**
   * Skip a number of grouped results (for pagination).
   */
  skip(count: number): GroupedBuilder<S, N, K> {
    return this._clone({ skip: count })
  }

  compile(): CompiledQuery {
    const compiler = new CypherCompiler(this._schema)

    // Build the AST with aggregation
    let finalAst = this._ast.addAggregate({
      groupBy: this._groupFields.map((f) => ({
        alias: this._ast.currentAlias,
        field: f,
      })),
      aggregations: this._aggregations.map((a) => ({
        ...a,
        sourceAlias: this._ast.currentAlias,
        resultAlias: a.alias,
      })),
    })

    // Add ORDER BY if specified
    if (this._orderBy && this._orderBy.length > 0) {
      finalAst = finalAst.addOrderBy(
        this._orderBy.map((o) => ({
          field: o.field,
          direction: o.direction,
          // For aggregation result aliases, we don't need a target
          // The compiler handles this in compileOrderBy
          target: this._ast.currentAlias,
        })),
      )
    }

    // Add SKIP if specified
    if (this._skip !== null) {
      finalAst = finalAst.addSkip(this._skip)
    }

    // Add LIMIT if specified
    if (this._limit !== null) {
      finalAst = finalAst.addLimit(this._limit)
    }

    return compiler.compile(finalAst)
  }

  toCypher(): string {
    return this.compile().cypher
  }

  /**
   * Execute the grouped aggregation query.
   *
   * @returns Array of grouped results with aggregations
   *
   * @example
   * ```typescript
   * const results = await graph
   *   .node('post')
   *   .groupBy('status')
   *   .count({ alias: 'postCount' })
   *   .sum('viewCount', { alias: 'totalViews' })
   *   .execute()
   *
   * // results: [
   * //   { status: 'published', postCount: 42, totalViews: 15000 },
   * //   { status: 'draft', postCount: 10, totalViews: 0 }
   * // ]
   * ```
   */
  async execute(): Promise<Array<Pick<NodeProps<S, N>, K> & Record<string, number | unknown[]>>> {
    if (!this._executor) {
      throw new ExecutionError("Query execution not available: no queryExecutor provided in config")
    }

    const compiled = this.compile()
    const results = await this._executor.run<Record<string, unknown>>(
      compiled.cypher,
      compiled.params,
      this._ast,
    )

    // Transform results - convert Neo4j values and map to expected shape
    return results.map((record) => {
      const transformed: Record<string, unknown> = {}

      // Extract group fields - they come back as alias.field format
      for (const field of this._groupFields) {
        const key = `${this._ast.currentAlias}.${field}`
        if (key in record) {
          transformed[field] = convertNeo4jValue(record[key])
        } else if (field in record) {
          // Sometimes Neo4j returns just the field name
          transformed[field] = convertNeo4jValue(record[field])
        }
      }

      // Extract aggregation results - they come back with their aliases
      for (const agg of this._aggregations) {
        if (agg.alias in record) {
          transformed[agg.alias] = convertNeo4jValue(record[agg.alias])
        }
      }

      return transformed as Pick<NodeProps<S, N>, K> & Record<string, number | unknown[]>
    })
  }
}
