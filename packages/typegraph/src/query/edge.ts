/**
 * Edge Builder
 *
 * Represents edge-centric queries where edges are the primary focus.
 */

import { type CollectionBuilder } from './collection'
import { ReturningBuilder } from './returning'
import { type QueryAST } from '../ast'
import { CypherCompiler } from '../compiler'
import type { ComparisonOperator, WhereCondition } from '../ast'
import type { AnySchema, EdgeTypes, EdgeProps, EdgeSource, EdgeTarget } from '../schema'
import type { AliasMap, EdgeAliasMap } from '../schema/inference'
import type { QueryExecutor } from './entry'

/**
 * Where builder for edge properties.
 */
export interface EdgeWhereBuilder<S extends AnySchema, E extends EdgeTypes<S>> {
  eq<K extends keyof EdgeProps<S, E> & string>(field: K, value: EdgeProps<S, E>[K]): WhereCondition
  neq<K extends keyof EdgeProps<S, E> & string>(field: K, value: EdgeProps<S, E>[K]): WhereCondition
  gt<K extends keyof EdgeProps<S, E> & string>(field: K, value: EdgeProps<S, E>[K]): WhereCondition
  gte<K extends keyof EdgeProps<S, E> & string>(field: K, value: EdgeProps<S, E>[K]): WhereCondition
  lt<K extends keyof EdgeProps<S, E> & string>(field: K, value: EdgeProps<S, E>[K]): WhereCondition
  lte<K extends keyof EdgeProps<S, E> & string>(field: K, value: EdgeProps<S, E>[K]): WhereCondition
  in<K extends keyof EdgeProps<S, E> & string>(
    field: K,
    values: EdgeProps<S, E>[K][],
  ): WhereCondition
  notIn<K extends keyof EdgeProps<S, E> & string>(
    field: K,
    values: EdgeProps<S, E>[K][],
  ): WhereCondition
  isNull<K extends keyof EdgeProps<S, E> & string>(field: K): WhereCondition
  isNotNull<K extends keyof EdgeProps<S, E> & string>(field: K): WhereCondition
  and(...conditions: WhereCondition[]): WhereCondition
  or(...conditions: WhereCondition[]): WhereCondition
  not(condition: WhereCondition): WhereCondition
}

/**
 * Builder for edge-centric queries.
 *
 * @example
 * ```typescript
 * // Query all 'authored' edges
 * const edges = await graph.edge('authored').execute();
 *
 * // Query edges with their source and target nodes
 * const results = await graph
 *   .edge('authored').as('rel')
 *   .withSource().as('author')
 *   .withTarget().as('post')
 *   .returning('author', 'rel', 'post')
 *   .execute();
 * ```
 */
export class EdgeBuilder<
  S extends AnySchema,
  E extends EdgeTypes<S>,
  Aliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
> {
  protected readonly _ast: QueryAST
  protected readonly _schema: S
  protected readonly _edgeType: E
  protected readonly _aliases: Aliases
  protected readonly _edgeAliases: EdgeAliases
  protected readonly _executor: QueryExecutor | null

  constructor(
    ast: QueryAST,
    schema: S,
    edgeType: E,
    aliases: Aliases = {} as Aliases,
    edgeAliases: EdgeAliases = {} as EdgeAliases,
    executor: QueryExecutor | null = null,
  ) {
    this._ast = ast
    this._schema = schema
    this._edgeType = edgeType
    this._aliases = aliases
    this._edgeAliases = edgeAliases
    this._executor = executor
  }

  get ast(): QueryAST {
    return this._ast
  }

  // ===========================================================================
  // ALIASING
  // ===========================================================================

  /**
   * Assign a user-friendly alias to the current edge.
   */
  as<A extends string>(alias: A): EdgeBuilder<S, E, Aliases, EdgeAliases & { [K in A]: E }> {
    const newAst = this._ast.addEdgeUserAlias(alias, this._ast.currentAlias)
    return new EdgeBuilder(
      newAst,
      this._schema,
      this._edgeType,
      this._aliases,
      {
        ...this._edgeAliases,
        [alias]: this._edgeType,
      } as EdgeAliases & { [K in A]: E },
      this._executor,
    )
  }

  // ===========================================================================
  // ENDPOINT NAVIGATION
  // ===========================================================================

  /**
   * Navigate to the source node of this edge.
   * Returns a collection of nodes that are the source of this edge type.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withSource(): CollectionBuilder<S, any, Aliases, EdgeAliases> {
    throw new Error('Not implemented')
  }

  /**
   * Navigate to the target node of this edge.
   * Returns a collection of nodes that are the target of this edge type.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  withTarget(): CollectionBuilder<S, any, Aliases, EdgeAliases> {
    throw new Error('Not implemented')
  }

  /**
   * Navigate to both source and target nodes.
   */
  withEndpoints(): EdgeWithEndpointsBuilder<S, E, Aliases, EdgeAliases> {
    throw new Error('Not implemented')
  }

  // ===========================================================================
  // FILTERING
  // ===========================================================================

  /**
   * Filter edges by property value.
   */
  where<K extends keyof EdgeProps<S, E> & string>(
    _field: K,
    _operator: ComparisonOperator,
    _value?: EdgeProps<S, E>[K] | EdgeProps<S, E>[K][],
  ): EdgeBuilder<S, E, Aliases, EdgeAliases> {
    throw new Error('Not implemented')
  }

  /**
   * Filter edges using complex conditions.
   */
  whereComplex(
    _builder: (w: EdgeWhereBuilder<S, E>) => WhereCondition,
  ): EdgeBuilder<S, E, Aliases, EdgeAliases> {
    throw new Error('Not implemented')
  }

  // ===========================================================================
  // RETURNING
  // ===========================================================================

  /**
   * Specify which aliased nodes and edges to return.
   */
  returning<NA extends keyof Aliases & string, EA extends keyof EdgeAliases & string>(
    ...aliases: (NA | EA)[]
  ): ReturningBuilder<S, Pick<Aliases, NA>, Pick<EdgeAliases, EA>> {
    const nodeAliases = aliases.filter((a) => a in this._aliases) as NA[]
    const edgeAliases = aliases.filter((a) => a in this._edgeAliases) as EA[]

    const newAst = this._ast.setMultiNodeProjection(nodeAliases, edgeAliases)

    const selectedNodeAliases = {} as Pick<Aliases, NA>
    for (const alias of nodeAliases) {
      selectedNodeAliases[alias] = this._aliases[alias]
    }

    const selectedEdgeAliases = {} as Pick<EdgeAliases, EA>
    for (const alias of edgeAliases) {
      selectedEdgeAliases[alias] = this._edgeAliases[alias]
    }

    return new ReturningBuilder(
      newAst,
      this._schema,
      selectedNodeAliases,
      selectedEdgeAliases,
      this._executor,
    )
  }

  // ===========================================================================
  // ORDERING & PAGINATION
  // ===========================================================================

  /**
   * Order edges by property.
   */
  orderBy<K extends keyof EdgeProps<S, E> & string>(
    _field: K,
    _direction: 'ASC' | 'DESC' = 'ASC',
  ): EdgeBuilder<S, E, Aliases, EdgeAliases> {
    throw new Error('Not implemented')
  }

  /**
   * Limit the number of edges returned.
   */
  limit(count: number): EdgeBuilder<S, E, Aliases, EdgeAliases> {
    const newAst = this._ast.addLimit(count)
    return new EdgeBuilder(
      newAst,
      this._schema,
      this._edgeType,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Skip a number of edges.
   */
  skip(count: number): EdgeBuilder<S, E, Aliases, EdgeAliases> {
    const newAst = this._ast.addSkip(count)
    return new EdgeBuilder(
      newAst,
      this._schema,
      this._edgeType,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Return distinct edges.
   */
  distinct(): EdgeBuilder<S, E, Aliases, EdgeAliases> {
    const newAst = this._ast.addDistinct()
    return new EdgeBuilder(
      newAst,
      this._schema,
      this._edgeType,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  // ===========================================================================
  // COMPILATION
  // ===========================================================================

  compile(): import('../compiler').CompiledQuery {
    const compiler = new CypherCompiler(this._schema)
    return compiler.compile(this._ast)
  }

  toCypher(): string {
    return this.compile().cypher
  }

  toParams(): Record<string, unknown> {
    return this.compile().params
  }

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  async count(): Promise<number> {
    throw new Error('Not implemented')
  }

  async exists(): Promise<boolean> {
    throw new Error('Not implemented')
  }

  async execute(): Promise<EdgeProps<S, E>[]> {
    throw new Error('Not implemented')
  }

  async executeWithMeta(): Promise<{
    data: EdgeProps<S, E>[]
    meta: { count: number; hasMore: boolean }
  }> {
    throw new Error('Not implemented')
  }

  stream(): AsyncIterable<EdgeProps<S, E>> {
    throw new Error('Not implemented')
  }
}

/**
 * Builder for edges with both endpoints accessible.
 */
export class EdgeWithEndpointsBuilder<
  S extends AnySchema,
  E extends EdgeTypes<S>,
  Aliases extends AliasMap<S>,
  EdgeAliases extends EdgeAliasMap<S>,
> {
  protected readonly _ast: QueryAST
  protected readonly _schema: S
  protected readonly _edgeType: E
  protected readonly _aliases: Aliases
  protected readonly _edgeAliases: EdgeAliases

  constructor(ast: QueryAST, schema: S, edgeType: E, aliases: Aliases, edgeAliases: EdgeAliases) {
    this._ast = ast
    this._schema = schema
    this._edgeType = edgeType
    this._aliases = aliases
    this._edgeAliases = edgeAliases
  }

  /**
   * Alias the source node.
   */
  sourceAs<A extends string>(
    _alias: A,
  ): EdgeWithEndpointsBuilder<S, E, Aliases & { [K in A]: EdgeSource<S, E> }, EdgeAliases> {
    throw new Error('Not implemented')
  }

  /**
   * Alias the target node.
   */
  targetAs<A extends string>(
    _alias: A,
  ): EdgeWithEndpointsBuilder<S, E, Aliases & { [K in A]: EdgeTarget<S, E> }, EdgeAliases> {
    throw new Error('Not implemented')
  }

  /**
   * Alias the edge itself.
   */
  edgeAs<A extends string>(
    _alias: A,
  ): EdgeWithEndpointsBuilder<S, E, Aliases, EdgeAliases & { [K in A]: E }> {
    throw new Error('Not implemented')
  }

  /**
   * Specify which aliased nodes and edges to return.
   */
  returning<NA extends keyof Aliases & string, EA extends keyof EdgeAliases & string>(
    ..._aliases: (NA | EA)[]
  ): ReturningBuilder<S, Pick<Aliases, NA>, Pick<EdgeAliases, EA>> {
    throw new Error('Not implemented')
  }

  /**
   * Execute and return all endpoints with edge.
   */
  async execute(): Promise<
    Array<{
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      source: import('../schema').NodeProps<S, any>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      target: import('../schema').NodeProps<S, any>
      edge: EdgeProps<S, E>
    }>
  > {
    throw new Error('Not implemented')
  }
}
