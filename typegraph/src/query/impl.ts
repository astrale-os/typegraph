/**
 * Query Implementation
 *
 * GraphQueryImpl class that implements the GraphQuery interface.
 */

import type { SchemaShape, TypeMap, UntypedMap } from '../schema'
import type { NodeLabels, EdgeTypes } from '../inference'
import { createEdgeProjection } from '../ast'
import { QueryAST } from '../ast'
import type { GraphQuery, QueryExecutor } from './types'
import { CollectionBuilder } from './collection'
import { SingleNodeBuilder } from './single-node'
import { EdgeBuilder } from './edge'
import { type PathBuilder } from './path'

/**
 * Implementation of the GraphQuery interface.
 *
 * Provides the entry points for building graph queries.
 * Creates and returns appropriate query builders.
 */
export class GraphQueryImpl<S extends SchemaShape, T extends TypeMap = UntypedMap> implements GraphQuery<S, T> {
  private readonly _schema: S
  private readonly _executor: QueryExecutor | null

  constructor(schema: S, executor: QueryExecutor | null = null) {
    this._schema = schema
    this._executor = executor
  }

  get schema(): S {
    return this._schema
  }

  get executor(): QueryExecutor | null {
    return this._executor
  }

  // ---------------------------------------------------------------------------
  // NODE QUERIES
  // ---------------------------------------------------------------------------

  node<N extends NodeLabels<S>>(
    label: N,
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T> {
    const ast = new QueryAST().addMatch(label as string)
    return new CollectionBuilder(ast, this._schema, {}, {}, this._executor) as CollectionBuilder<
      S,
      N,
      Record<string, never>,
      Record<string, never>,
      T
    >
  }

  nodeByIdWithLabel<N extends NodeLabels<S>>(
    label: N,
    id: string,
  ): SingleNodeBuilder<S, N, Record<string, never>, Record<string, never>, T> {
    return this.node(label).byId(id)
  }

  nodeById(
    id: string,
  ): SingleNodeBuilder<S, NodeLabels<S>, Record<string, never>, Record<string, never>, T> {
    const ast = new QueryAST().addMatchById(id)
    return new SingleNodeBuilder(ast, this._schema, {}, {}, this._executor) as SingleNodeBuilder<
      S,
      NodeLabels<S>,
      Record<string, never>,
      Record<string, never>,
      T
    >
  }

  // ---------------------------------------------------------------------------
  // EDGE QUERIES
  // ---------------------------------------------------------------------------

  edge<E extends EdgeTypes<S>>(
    edgeType: E,
  ): EdgeBuilder<S, E, Record<string, never>, Record<string, never>, T> {
    const ast = new QueryAST()
    const projection = createEdgeProjection('e0', 'edgeCollection')
    const newAst = ast.setProjection(projection)
    return new EdgeBuilder(newAst, this._schema, edgeType, {}, {}, this._executor)
  }

  // ---------------------------------------------------------------------------
  // SET OPERATIONS
  // ---------------------------------------------------------------------------

  intersect<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any, any, T>[]
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T> {
    if (queries.length < 2) {
      throw new Error('intersect() requires at least 2 queries')
    }
    const baseAst = new QueryAST()
    const branchAst = baseAst.addBranch({
      operator: 'intersect',
      branches: queries.map((q) => q.ast),
      distinct: true,
    })
    return new CollectionBuilder(branchAst, this._schema, {}, {}, this._executor)
  }

  union<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any, any, T>[]
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T> {
    if (queries.length < 2) {
      throw new Error('union() requires at least 2 queries')
    }
    const baseAst = new QueryAST()
    const branchAst = baseAst.addBranch({
      operator: 'union',
      branches: queries.map((q) => q.ast),
      distinct: true,
    })
    return new CollectionBuilder(branchAst, this._schema, {}, {}, this._executor)
  }

  unionAll<N extends NodeLabels<S>>(
    ...queries: CollectionBuilder<S, N, any, any, T>[]
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T> {
    if (queries.length < 2) {
      throw new Error('unionAll() requires at least 2 queries')
    }
    const baseAst = new QueryAST()
    const branchAst = baseAst.addBranch({
      operator: 'union',
      branches: queries.map((q) => q.ast),
      distinct: false,
    })
    return new CollectionBuilder(branchAst, this._schema, {}, {}, this._executor)
  }

  // ---------------------------------------------------------------------------
  // PATH QUERIES
  // ---------------------------------------------------------------------------

  shortestPath<
    NFrom extends NodeLabels<S>,
    NTo extends NodeLabels<S>,
    E extends EdgeTypes<S>,
  >(_config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
  }): PathBuilder<S, NFrom, NTo> {
    throw new Error('shortestPath() is not yet implemented')
  }

  allShortestPaths<
    NFrom extends NodeLabels<S>,
    NTo extends NodeLabels<S>,
    E extends EdgeTypes<S>,
  >(_config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
  }): PathBuilder<S, NFrom, NTo> {
    throw new Error('allShortestPaths() is not yet implemented')
  }

  allPaths<
    NFrom extends NodeLabels<S>,
    NTo extends NodeLabels<S>,
    E extends EdgeTypes<S>,
  >(_config: {
    from: { label: NFrom; id: string }
    to: { label: NTo; id: string }
    via: E
    direction?: 'out' | 'in' | 'both'
    maxDepth?: number
  }): PathBuilder<S, NFrom, NTo> {
    throw new Error('allPaths() is not yet implemented')
  }

  // ---------------------------------------------------------------------------
  // RAW QUERY
  // ---------------------------------------------------------------------------

  async raw<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    if (!this._executor) {
      throw new Error('Raw queries not available: no executor provided')
    }
    return this._executor.run<T>(cypher, params)
  }
}
