/**
 * Subquery Builder
 *
 * Builder for constructing subqueries used in whereExists, whereNotExists,
 * whereCount, and subquery pipeline callbacks.
 *
 * Builds up ASTNode[] steps directly rather than wrapping a full QueryAST,
 * since subqueries are correlated fragments that reference the outer query's aliases.
 *
 * @example
 * // In whereExists callback
 * graph.node('User').whereExists(q =>
 *   q.to('AUTHORED', 'Post')
 *    .where('status', 'eq', 'published')
 * )
 *
 * @example
 * // In subquery pipeline callback
 * graph.node('User').subquery(q =>
 *   q.to('AUTHORED')
 *    .count('postCount')
 * )
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { NodeLabels, NodeProps, OutgoingEdges, IncomingEdges } from '../inference'
import type { SchemaShape } from '../schema'
import type {
  ASTNode,
  TraversalStep,
  WhereStep,
  ComparisonCondition,
  ComparisonOperator,
  AggregateStep,
  ReturnStep,
  ProjectionReturn,
} from './ast'

export interface ExportMetadata {
  alias: string
  kind: 'scalar' | 'node' | 'array'
}

export class SubqueryBuilder<S extends SchemaShape, N extends NodeLabels<S>> {
  protected readonly _schema: S
  protected readonly _correlatedAlias: string
  protected readonly _currentAlias: string
  protected readonly _steps: ASTNode[]
  protected readonly _aliasCounter: number
  protected readonly _exportedAliases: Map<string, ExportMetadata>

  constructor(
    schema: S,
    correlatedAlias: string,
    steps: ASTNode[] = [],
    currentAlias?: string,
    aliasCounter: number = 0,
    exportedAliases?: Map<string, ExportMetadata>,
  ) {
    this._schema = schema
    this._correlatedAlias = correlatedAlias
    this._currentAlias = currentAlias ?? correlatedAlias
    this._steps = steps
    this._aliasCounter = aliasCounter
    this._exportedAliases = exportedAliases ?? new Map()
  }

  // ===========================================================================
  // TRAVERSAL
  // ===========================================================================

  to<E extends OutgoingEdges<S, N>>(edge: E, targetLabel?: string): SubqueryBuilder<S, any> {
    const [toAlias, edgeAlias, nextCounter] = this._nextAliases('to')

    const step: TraversalStep = {
      type: 'traversal',
      edges: [edge as string],
      direction: 'out',
      fromAlias: this._currentAlias,
      toAlias,
      toLabels: targetLabel ? [targetLabel] : [],
      edgeAlias,
      optional: false,
      cardinality: 'many',
    }

    return this._derive(toAlias, nextCounter, [...this._steps, step])
  }

  from<E extends IncomingEdges<S, N>>(edge: E, sourceLabel?: string): SubqueryBuilder<S, any> {
    const [toAlias, edgeAlias, nextCounter] = this._nextAliases('from')

    const step: TraversalStep = {
      type: 'traversal',
      edges: [edge as string],
      direction: 'in',
      fromAlias: this._currentAlias,
      toAlias,
      toLabels: sourceLabel ? [sourceLabel] : [],
      edgeAlias,
      optional: false,
      cardinality: 'many',
    }

    return this._derive(toAlias, nextCounter, [...this._steps, step])
  }

  related(edge: string): SubqueryBuilder<S, any> {
    const [toAlias, edgeAlias, nextCounter] = this._nextAliases('rel')

    const step: TraversalStep = {
      type: 'traversal',
      edges: [edge],
      direction: 'both',
      fromAlias: this._currentAlias,
      toAlias,
      toLabels: [],
      edgeAlias,
      optional: false,
      cardinality: 'many',
    }

    return this._derive(toAlias, nextCounter, [...this._steps, step])
  }

  // ===========================================================================
  // FILTERING
  // ===========================================================================

  where<K extends keyof NodeProps<S, N> & string>(
    field: K,
    operator: ComparisonOperator,
    value: unknown,
  ): SubqueryBuilder<S, N> {
    const condition: ComparisonCondition = {
      type: 'comparison',
      field,
      operator,
      value,
      target: this._currentAlias,
    }

    const step: WhereStep = {
      type: 'where',
      conditions: [condition],
    }

    return this._derive(this._currentAlias, this._aliasCounter, [...this._steps, step])
  }

  whereAll(conditions: Array<[string, ComparisonOperator, unknown]>): SubqueryBuilder<S, N> {
    if (conditions.length === 0) return this

    const compiledConditions: ComparisonCondition[] = conditions.map(([field, op, value]) => ({
      type: 'comparison' as const,
      field,
      operator: op,
      value,
      target: this._currentAlias,
    }))

    const step: WhereStep = {
      type: 'where',
      conditions: compiledConditions,
    }

    return this._derive(this._currentAlias, this._aliasCounter, [...this._steps, step])
  }

  // ===========================================================================
  // AGGREGATION (for pipeline subqueries)
  // ===========================================================================

  count(alias: string = 'count'): SubqueryBuilder<S, N> {
    const step: AggregateStep = {
      type: 'aggregate',
      groupBy: [],
      aggregations: [
        {
          function: 'count',
          field: '*',
          resultAlias: alias,
        },
      ],
    }

    const newExports = new Map(this._exportedAliases)
    newExports.set(alias, { alias, kind: 'scalar' })

    return new SubqueryBuilder(
      this._schema,
      this._correlatedAlias,
      [...this._steps, step],
      this._currentAlias,
      this._aliasCounter,
      newExports,
    )
  }

  sum<K extends keyof NodeProps<S, N> & string>(field: K, alias: string): SubqueryBuilder<S, N> {
    const step: AggregateStep = {
      type: 'aggregate',
      groupBy: [],
      aggregations: [
        {
          function: 'sum',
          field,
          sourceAlias: this._currentAlias,
          resultAlias: alias,
        },
      ],
    }

    const newExports = new Map(this._exportedAliases)
    newExports.set(alias, { alias, kind: 'scalar' })

    return new SubqueryBuilder(
      this._schema,
      this._correlatedAlias,
      [...this._steps, step],
      this._currentAlias,
      this._aliasCounter,
      newExports,
    )
  }

  max<K extends keyof NodeProps<S, N> & string>(field: K, alias: string): SubqueryBuilder<S, N> {
    return this._addAggregation('max', field, alias)
  }

  min<K extends keyof NodeProps<S, N> & string>(field: K, alias: string): SubqueryBuilder<S, N> {
    return this._addAggregation('min', field, alias)
  }

  avg<K extends keyof NodeProps<S, N> & string>(field: K, alias: string): SubqueryBuilder<S, N> {
    return this._addAggregation('avg', field, alias)
  }

  collect(alias: string, distinct: boolean = false): SubqueryBuilder<S, N> {
    const step: AggregateStep = {
      type: 'aggregate',
      groupBy: [],
      aggregations: [
        {
          function: 'collect',
          field: this._currentAlias,
          resultAlias: alias,
          distinct,
        },
      ],
    }

    const newExports = new Map(this._exportedAliases)
    newExports.set(alias, { alias, kind: 'array' })

    return new SubqueryBuilder(
      this._schema,
      this._correlatedAlias,
      [...this._steps, step],
      this._currentAlias,
      this._aliasCounter,
      newExports,
    )
  }

  // ===========================================================================
  // EXPORT
  // ===========================================================================

  as(alias: string): SubqueryBuilder<S, N> {
    const newExports = new Map(this._exportedAliases)
    newExports.set(alias, { alias, kind: 'node' })

    return new SubqueryBuilder(
      this._schema,
      this._correlatedAlias,
      this._steps,
      this._currentAlias,
      this._aliasCounter,
      newExports,
    )
  }

  // ===========================================================================
  // INTERNAL API (used by query builder methods)
  // ===========================================================================

  get steps(): ASTNode[] {
    return [...this._steps]
  }

  getExportedAliases(): string[] {
    return Array.from(this._exportedAliases.keys())
  }

  getExportMetadata(): Map<string, ExportMetadata> {
    return new Map(this._exportedAliases)
  }

  getCorrelatedAlias(): string {
    return this._correlatedAlias
  }

  /**
   * Build the final steps including a ReturnStep for exported aliases.
   * Used by the subquery() pipeline method.
   */
  buildPipelineSteps(): ASTNode[] {
    const steps = [...this._steps]

    if (this._exportedAliases.size > 0) {
      const returns: ProjectionReturn[] = []

      for (const [alias, meta] of this._exportedAliases) {
        if (meta.kind === 'node') {
          returns.push({ kind: 'alias', alias: this._currentAlias, resultAlias: alias })
        }
        // Scalar/array exports are handled by the aggregate step — they produce
        // RETURN count(*) AS alias, sum(n.field) AS alias, etc.
        // The compiler reads the aggregate step and produces the RETURN clause.
      }

      // Only add a return step if we have node exports that aren't covered by aggregation
      if (returns.length > 0) {
        const returnStep: ReturnStep = {
          type: 'return',
          returns,
        }
        steps.push(returnStep)
      }
    }

    return steps
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private _nextAliases(prefix: string): [string, string, number] {
    const n = this._aliasCounter + 1
    return [`_${prefix}_${n}`, `_e_${prefix}_${n}`, n]
  }

  private _derive(
    newCurrentAlias: string,
    newCounter: number,
    newSteps: ASTNode[],
  ): SubqueryBuilder<S, any> {
    return new SubqueryBuilder(
      this._schema,
      this._correlatedAlias,
      newSteps,
      newCurrentAlias,
      newCounter,
      new Map(this._exportedAliases),
    )
  }

  private _addAggregation(
    fn: 'max' | 'min' | 'avg',
    field: string,
    alias: string,
  ): SubqueryBuilder<S, N> {
    const step: AggregateStep = {
      type: 'aggregate',
      groupBy: [],
      aggregations: [
        {
          function: fn,
          field,
          sourceAlias: this._currentAlias,
          resultAlias: alias,
        },
      ],
    }

    const newExports = new Map(this._exportedAliases)
    newExports.set(alias, { alias, kind: 'scalar' })

    return new SubqueryBuilder(
      this._schema,
      this._correlatedAlias,
      [...this._steps, step],
      this._currentAlias,
      this._aliasCounter,
      newExports,
    )
  }
}
