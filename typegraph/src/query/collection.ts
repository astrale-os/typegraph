/**
 * Collection Builder
 *
 * Represents a query that resolves to MULTIPLE nodes.
 * Extends NodeQueryBuilder for shared filtering, traversal, hierarchy, and projection.
 */

import { NodeQueryBuilder, _registerCollectionBuilder } from './node-query-builder'
import type { BaseBuilder } from './base'
import { buildOutTraversal, buildInTraversal, buildMultiEdgeTraversal } from './traversal'
import type { TraversalOptions } from './traits'
import type { QueryAST } from './ast'
import { getCompiler } from './compiler'
import type { SchemaShape, TypeMap, UntypedMap } from '../schema'
import type { ResolveNode } from '../resolve'
import type {
  NodeLabels,
  NodeProps,
  OutgoingEdges,
  IncomingEdges,
  EdgeTargetsFrom,
  EdgeSourcesTo,
} from '../inference'
import type {
  AliasMap,
  EdgeAliasMap,
  MultiEdgeTargets,
  MultiEdgeSources,
  MultiEdgeBidirectional,
} from '../inference'

import { GroupedBuilder } from './grouped'
import { extractNodeFromRecord, convertNeo4jValue } from '../utils'
import { ExecutionError } from '../errors'
import { SingleNodeBuilder } from './single-node'
import type { OptionalNodeBuilder } from './optional-node'

/**
 * Builder for queries that return multiple nodes.
 *
 * @template S - Schema type
 * @template N - Current node label
 * @template Aliases - Map of registered user aliases
 * @template EdgeAliases - Map of registered edge aliases
 */
export class CollectionBuilder<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  Aliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
  T extends TypeMap = UntypedMap,
> extends NodeQueryBuilder<S, N, Aliases, EdgeAliases, T> {
  protected _derive(ast: QueryAST): this {
    return new CollectionBuilder(
      ast,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    ) as this
  }

  // ===========================================================================
  // ALIASING
  // ===========================================================================

  as<A extends string>(alias: A): CollectionBuilder<S, N, Aliases & { [K in A]: N }, EdgeAliases, T> {
    const { ast, aliases } = this._addAlias(alias)
    return new CollectionBuilder(ast, this._schema, aliases, this._edgeAliases, this._executor)
  }

  // ===========================================================================
  // FORK
  // ===========================================================================

  fork<
    B1 extends AliasMap<S>,
    E1 extends EdgeAliasMap<S>,
    B2 extends AliasMap<S> = Record<string, never>,
    E2 extends EdgeAliasMap<S> = Record<string, never>,
    B3 extends AliasMap<S> = Record<string, never>,
    E3 extends EdgeAliasMap<S> = Record<string, never>,
    B4 extends AliasMap<S> = Record<string, never>,
    E4 extends EdgeAliasMap<S> = Record<string, never>,
  >(
    branch1: (
      q: CollectionBuilder<S, N, Aliases, EdgeAliases, T>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B1, E1, T>
      | CollectionBuilder<S, NodeLabels<S>, B1, E1, T>
      | OptionalNodeBuilder<S, NodeLabels<S>, B1, E1, T>,
    branch2?: (
      q: CollectionBuilder<S, N, Aliases, EdgeAliases, T>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B2, E2, T>
      | CollectionBuilder<S, NodeLabels<S>, B2, E2, T>
      | OptionalNodeBuilder<S, NodeLabels<S>, B2, E2, T>,
    branch3?: (
      q: CollectionBuilder<S, N, Aliases, EdgeAliases, T>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B3, E3, T>
      | CollectionBuilder<S, NodeLabels<S>, B3, E3, T>
      | OptionalNodeBuilder<S, NodeLabels<S>, B3, E3, T>,
    branch4?: (
      q: CollectionBuilder<S, N, Aliases, EdgeAliases, T>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B4, E4, T>
      | CollectionBuilder<S, NodeLabels<S>, B4, E4, T>
      | OptionalNodeBuilder<S, NodeLabels<S>, B4, E4, T>,
  ): CollectionBuilder<S, N, Aliases & B1 & B2 & B3 & B4, EdgeAliases & E1 & E2 & E3 & E4, T> {
    const ALIAS_OFFSET_PER_BRANCH = 10

    const createBranchBuilder = (branchIndex: number) =>
      new CollectionBuilder(
        this._ast.withAliasOffset(branchIndex * ALIAS_OFFSET_PER_BRANCH),
        this._schema,
        this._aliases,
        this._edgeAliases,
        this._executor,
      ) as CollectionBuilder<S, N, Aliases, EdgeAliases, T>

    const branches: BaseBuilder<S, NodeLabels<S>>[] = [
      branch1(createBranchBuilder(0)) as BaseBuilder<S, NodeLabels<S>>,
    ]
    if (branch2) branches.push(branch2(createBranchBuilder(1)) as BaseBuilder<S, NodeLabels<S>>)
    if (branch3) branches.push(branch3(createBranchBuilder(2)) as BaseBuilder<S, NodeLabels<S>>)
    if (branch4) branches.push(branch4(createBranchBuilder(3)) as BaseBuilder<S, NodeLabels<S>>)

    const newAst = this._ast.addFork(branches.map((b) => b.ast))

    let mergedAliases = { ...this._aliases } as Aliases & B1 & B2 & B3 & B4
    let mergedEdgeAliases = { ...this._edgeAliases } as EdgeAliases & E1 & E2 & E3 & E4

    for (const branch of branches) {
      const b = branch as unknown as { _aliases?: AliasMap<S>; _edgeAliases?: EdgeAliasMap<S> }
      if (b._aliases) mergedAliases = { ...mergedAliases, ...b._aliases }
      if (b._edgeAliases) mergedEdgeAliases = { ...mergedEdgeAliases, ...b._edgeAliases }
    }

    return new CollectionBuilder(
      newAst,
      this._schema,
      mergedAliases,
      mergedEdgeAliases,
      this._executor,
    )
  }

  // ===========================================================================
  // COLLECTION OPERATIONS
  // ===========================================================================

  byId(id: string): SingleNodeBuilder<S, N, Aliases, EdgeAliases, T> {
    const newAst = this._ast
      .addWhere([
        {
          type: 'comparison' as const,
          field: 'id',
          operator: 'eq' as const,
          value: id,
          target: this._ast.currentAlias,
        },
      ])
      .setProjectionType('node')
    return new SingleNodeBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  first(): SingleNodeBuilder<S, N, Aliases, EdgeAliases, T> {
    const newAst = this._ast.addLimit(1).setProjectionType('node')
    return new SingleNodeBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  take(count: number): CollectionBuilder<S, N, Aliases, EdgeAliases, T> {
    return this._derive(this._ast.addLimit(count))
  }

  // ===========================================================================
  // TRAVERSAL
  // ===========================================================================

  to<E extends OutgoingEdges<S, N>, EA extends string | undefined = undefined>(
    edge: E,
    options?: TraversalOptions<S, E> & { edgeAs?: EA; depth?: { min: number; max: number } },
  ): CollectionBuilder<
    S,
    EdgeTargetsFrom<S, E, N>,
    Aliases,
    EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases,
    T
  > {
    const { ast } = buildOutTraversal(this._ast, this._schema, edge as string, {
      where: options?.where as Record<string, unknown>,
      edgeAs: options?.edgeAs,
      depth: options?.depth,
    })
    const newEdgeAliases = options?.edgeAs
      ? ({ ...this._edgeAliases, [options.edgeAs]: edge } as EA extends string
          ? EdgeAliases & { [K in EA]: E }
          : EdgeAliases)
      : (this._edgeAliases as EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases)
    return new CollectionBuilder(ast, this._schema, this._aliases, newEdgeAliases, this._executor)
  }

  toOptional<E extends OutgoingEdges<S, N>>(
    edge: E,
    options?: TraversalOptions<S, E>,
  ): CollectionBuilder<S, EdgeTargetsFrom<S, E, N>, Aliases, EdgeAliases, T> {
    const { ast } = buildOutTraversal(this._ast, this._schema, edge as string, {
      where: options?.where as Record<string, unknown>,
      optional: true,
    })
    return new CollectionBuilder(
      ast,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  from<E extends IncomingEdges<S, N>, EA extends string | undefined = undefined>(
    edge: E,
    options?: TraversalOptions<S, E> & { edgeAs?: EA },
  ): CollectionBuilder<
    S,
    EdgeSourcesTo<S, E, N>,
    Aliases,
    EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases,
    T
  > {
    const { ast } = buildInTraversal(this._ast, this._schema, edge as string, {
      where: options?.where as Record<string, unknown>,
      edgeAs: options?.edgeAs,
    })
    const newEdgeAliases = options?.edgeAs
      ? ({ ...this._edgeAliases, [options.edgeAs]: edge } as EA extends string
          ? EdgeAliases & { [K in EA]: E }
          : EdgeAliases)
      : (this._edgeAliases as EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases)
    return new CollectionBuilder(ast, this._schema, this._aliases, newEdgeAliases, this._executor)
  }

  fromOptional<E extends IncomingEdges<S, N>>(
    edge: E,
    options?: TraversalOptions<S, E>,
  ): CollectionBuilder<S, EdgeSourcesTo<S, E, N>, Aliases, EdgeAliases, T> {
    const { ast } = buildInTraversal(this._ast, this._schema, edge as string, {
      where: options?.where as Record<string, unknown>,
      optional: true,
    })
    return new CollectionBuilder(
      ast,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  // ===========================================================================
  // MULTI-EDGE TRAVERSAL
  // ===========================================================================

  toAny<Edges extends readonly OutgoingEdges<S, N>[]>(
    edges: Edges,
    options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeTargets<S, N, Edges>, Aliases, EdgeAliases, T> {
    const { ast } = buildMultiEdgeTraversal(
      this._ast,
      this._schema,
      edges as unknown as string[],
      'out',
      { where: options?.where as Record<string, unknown> },
    )
    return new CollectionBuilder(
      ast,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  fromAny<Edges extends readonly IncomingEdges<S, N>[]>(
    edges: Edges,
    options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeSources<S, N, Edges>, Aliases, EdgeAliases, T> {
    const { ast } = buildMultiEdgeTraversal(
      this._ast,
      this._schema,
      edges as unknown as string[],
      'in',
      { where: options?.where as Record<string, unknown> },
    )
    return new CollectionBuilder(
      ast,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  viaAny<Edges extends readonly (OutgoingEdges<S, N> & IncomingEdges<S, N>)[]>(
    edges: Edges,
    options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeBidirectional<S, N, Edges>, Aliases, EdgeAliases, T> {
    const { ast } = buildMultiEdgeTraversal(
      this._ast,
      this._schema,
      edges as unknown as string[],
      'both',
      { where: options?.where as Record<string, unknown> },
    )
    return new CollectionBuilder(
      ast,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  // ===========================================================================
  // ORDERING & PAGINATION
  // ===========================================================================

  orderBy<K extends keyof NodeProps<S, N> & string>(
    field: K,
    direction: 'ASC' | 'DESC' = 'ASC',
  ): CollectionBuilder<S, N, Aliases, EdgeAliases, T> {
    return this._derive(
      this._ast.addOrderBy([{ field, direction, target: this._ast.currentAlias }]),
    )
  }

  orderByMultiple(
    fields: Array<{ field: keyof NodeProps<S, N> & string; direction: 'ASC' | 'DESC' }>,
  ): CollectionBuilder<S, N, Aliases, EdgeAliases, T> {
    const orderFields = fields.map((f) => ({
      field: f.field,
      direction: f.direction,
      target: this._ast.currentAlias,
    }))
    return this._derive(this._ast.addOrderBy(orderFields))
  }

  limit(count: number): CollectionBuilder<S, N, Aliases, EdgeAliases, T> {
    return this._derive(this._ast.addLimit(count))
  }

  skip(count: number): CollectionBuilder<S, N, Aliases, EdgeAliases, T> {
    return this._derive(this._ast.addSkip(count))
  }

  paginate(options: {
    page: number
    pageSize: number
  }): CollectionBuilder<S, N, Aliases, EdgeAliases, T> {
    const offset = (options.page - 1) * options.pageSize
    return this.skip(offset).limit(options.pageSize)
  }

  after(_cursor: string): CollectionBuilder<S, N, Aliases, EdgeAliases, T> {
    throw new Error('Cursor pagination not yet implemented')
  }

  before(_cursor: string): CollectionBuilder<S, N, Aliases, EdgeAliases, T> {
    throw new Error('Cursor pagination not yet implemented')
  }

  distinct(): CollectionBuilder<S, N, Aliases, EdgeAliases, T> {
    return this._derive(this._ast.addDistinct())
  }

  // ===========================================================================
  // AGGREGATION
  // ===========================================================================

  groupBy<K extends keyof NodeProps<S, N> & string>(...fields: K[]): GroupedBuilder<S, N, K> {
    return new GroupedBuilder(this._ast, this._schema, fields, [], this._executor)
  }

  async count(): Promise<number> {
    if (!this._executor) {
      throw new ExecutionError('Query execution not available: no queryExecutor provided in config')
    }
    const newAst = this._ast.setCountProjection()
    const compiled = getCompiler(this._schema).compile(newAst)
    const results = await this._executor.run<{ count: unknown }>(
      compiled.cypher,
      compiled.params,
      newAst,
    )
    if (results.length === 0) return 0
    const countValue = convertNeo4jValue(results[0]!.count)
    return typeof countValue === 'number' ? countValue : Number(countValue)
  }

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  async execute(): Promise<ResolveNode<T, N & string>[]> {
    if (!this._executor) {
      throw new ExecutionError('Query execution not available: no queryExecutor provided in config')
    }
    const compiled = this.compile()
    const results = await this._executor.run<Record<string, unknown>>(
      compiled.cypher,
      compiled.params,
      this._ast,
    )
    return results.map(
      (record) =>
        extractNodeFromRecord(record, this._schema, this.currentLabel as string) as ResolveNode<
          T,
          N & string
        >,
    )
  }

  async executeWithMeta(): Promise<{
    data: ResolveNode<T, N & string>[]
    meta: { count: number; hasMore: boolean }
  }> {
    const data = await this.execute()
    return { data, meta: { count: data.length, hasMore: false } }
  }

  async executeWithCursor(): Promise<{
    data: ResolveNode<T, N & string>[]
    pageInfo: {
      hasNextPage: boolean
      hasPreviousPage: boolean
      startCursor: string | null
      endCursor: string | null
    }
  }> {
    throw new Error('Cursor pagination not yet implemented')
  }

  stream(): AsyncIterable<ResolveNode<T, N & string>> {
    throw new Error('Streaming not yet implemented')
  }
}

// Register with base class to resolve circular dependency
_registerCollectionBuilder(CollectionBuilder)

// ===========================================================================
// SELECTOR INTERFACE
// ===========================================================================

export interface CollectionSelector<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  K extends keyof NodeProps<S, N>,
> {
  orderBy(field: K, direction?: 'ASC' | 'DESC'): CollectionSelector<S, N, K>
  limit(count: number): CollectionSelector<S, N, K>
  skip(count: number): CollectionSelector<S, N, K>
  execute(): Promise<Pick<NodeProps<S, N>, K>[]>
  stream(): AsyncIterable<Pick<NodeProps<S, N>, K>>
  compile(): import('./compiler').CompiledQuery
  toCypher(): string
}
