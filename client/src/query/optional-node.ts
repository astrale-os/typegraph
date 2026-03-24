/**
 * Optional Node Builder
 *
 * Represents a query that resolves to ZERO or ONE node.
 * Extends NodeQueryBuilder for shared filtering, traversal, hierarchy, and projection.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

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
  EdgeOutboundCardinality,
  EdgeInboundCardinality,
} from '../inference'
import type { ResolveNode } from '../resolve'
import type { SchemaShape, TypeMap, UntypedMap } from '../schema'
import type { QueryAST } from './ast'
import type { CompiledQuery } from './compiler'
import type { TraversalOptions } from './traits'

import { ExecutionError } from '../errors'
import { extractNodeFromRecord } from '../utils'
import { CollectionBuilder } from './collection'
import { NodeQueryBuilder } from './node-query-builder'
import { SingleNodeBuilder } from './single-node'
import { buildOutTraversal, buildInTraversal } from './traversal'

/**
 * Builder for queries that return zero or one node.
 *
 * @template S - Schema type
 * @template N - Current node label
 * @template Aliases - Map of registered user aliases
 * @template EdgeAliases - Map of registered edge aliases
 */
export class OptionalNodeBuilder<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  Aliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
  T extends TypeMap = UntypedMap,
> extends NodeQueryBuilder<S, N, Aliases, EdgeAliases, T> {
  protected _derive(ast: QueryAST): this {
    return new OptionalNodeBuilder(
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

  as<A extends string>(
    alias: A,
  ): OptionalNodeBuilder<S, N, Aliases & { [K in A]: N }, EdgeAliases, T> {
    const { ast, aliases } = this._addAlias(alias)
    return new OptionalNodeBuilder(ast, this._schema, aliases, this._edgeAliases, this._executor)
  }

  // ===========================================================================
  // OPTIONAL HANDLING
  // ===========================================================================

  required(): SingleNodeBuilder<S, N, Aliases, EdgeAliases, T> {
    return new SingleNodeBuilder(
      this._ast,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  async map<R>(mapper: (node: ResolveNode<T, N & string>) => R, defaultValue: R): Promise<R> {
    const result = await this.execute()
    return result ? mapper(result) : defaultValue
  }

  orElse(_defaultValue: NodeProps<S, N>): SingleNodeBuilder<S, N, Aliases, EdgeAliases, T> {
    throw new Error('orElse() not yet implemented')
  }

  // ===========================================================================
  // TRAVERSAL
  // ===========================================================================

  to<E extends OutgoingEdges<S, N>, EA extends string | undefined = undefined>(
    edge: E,
    options?: TraversalOptions<S, E> & { edgeAs?: EA },
  ): EdgeOutboundCardinality<S, E> extends 'one'
    ? OptionalNodeBuilder<
        S,
        EdgeTargetsFrom<S, E, N>,
        Aliases,
        EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases,
        T
      >
    : CollectionBuilder<
        S,
        EdgeTargetsFrom<S, E, N>,
        Aliases,
        EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases,
        T
      > {
    const { ast, cardinality } = buildOutTraversal(this._ast, this._schema, edge as string, {
      where: options?.where as Record<string, unknown>,
      edgeAs: options?.edgeAs,
    })
    const newEdgeAliases = options?.edgeAs
      ? { ...this._edgeAliases, [options.edgeAs]: edge }
      : this._edgeAliases

    // From an optional node, 'one' cardinality becomes optional (source might not exist)
    if (cardinality === 'one') {
      return new OptionalNodeBuilder(
        ast,
        this._schema,
        this._aliases,
        newEdgeAliases,
        this._executor,
      ) as any
    }
    return new CollectionBuilder(
      ast,
      this._schema,
      this._aliases,
      newEdgeAliases,
      this._executor,
    ) as any
  }

  from<E extends IncomingEdges<S, N>, EA extends string | undefined = undefined>(
    edge: E,
    options?: TraversalOptions<S, E> & { edgeAs?: EA },
  ): EdgeInboundCardinality<S, E> extends 'one'
    ? OptionalNodeBuilder<
        S,
        EdgeSourcesTo<S, E, N>,
        Aliases,
        EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases,
        T
      >
    : CollectionBuilder<
        S,
        EdgeSourcesTo<S, E, N>,
        Aliases,
        EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases,
        T
      > {
    const { ast, cardinality } = buildInTraversal(this._ast, this._schema, edge as string, {
      where: options?.where as Record<string, unknown>,
      edgeAs: options?.edgeAs,
    })
    const newEdgeAliases = options?.edgeAs
      ? { ...this._edgeAliases, [options.edgeAs]: edge }
      : this._edgeAliases

    // From an optional node, 'one' cardinality becomes optional (source might not exist)
    if (cardinality === 'one') {
      return new OptionalNodeBuilder(
        ast,
        this._schema,
        this._aliases,
        newEdgeAliases,
        this._executor,
      ) as any
    }
    return new CollectionBuilder(
      ast,
      this._schema,
      this._aliases,
      newEdgeAliases,
      this._executor,
    ) as any
  }

  // ===========================================================================
  // MULTI-EDGE TRAVERSAL (stubs)
  // ===========================================================================

  toAny<Edges extends readonly OutgoingEdges<S, N>[]>(
    _edges: Edges,
    _options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeTargets<S, N, Edges>, Aliases, EdgeAliases, T> {
    throw new Error('toAny() not yet implemented on OptionalNodeBuilder')
  }

  fromAny<Edges extends readonly IncomingEdges<S, N>[]>(
    _edges: Edges,
    _options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeSources<S, N, Edges>, Aliases, EdgeAliases, T> {
    throw new Error('fromAny() not yet implemented on OptionalNodeBuilder')
  }

  viaAny<Edges extends readonly (OutgoingEdges<S, N> & IncomingEdges<S, N>)[]>(
    _edges: Edges,
    _options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeBidirectional<S, N, Edges>, Aliases, EdgeAliases, T> {
    throw new Error('viaAny() not yet implemented on OptionalNodeBuilder')
  }

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  async execute(): Promise<ResolveNode<T, N & string> | null> {
    if (!this._executor) {
      throw new ExecutionError('Query execution not available: no queryExecutor provided in config')
    }

    const compiled = this.compile()
    const results = await this._executor.run<Record<string, unknown>>(
      compiled.cypher,
      compiled.params,
      this._ast,
    )

    if (results.length === 0) return null
    return extractNodeFromRecord(
      results[0]!,
      this._schema,
      this.currentLabel as string,
    ) as ResolveNode<T, N & string>
  }
}

// ===========================================================================
// SELECTOR INTERFACE
// ===========================================================================

export interface OptionalNodeSelector<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  K extends keyof NodeProps<S, N>,
> {
  execute(): Promise<Pick<NodeProps<S, N>, K> | null>
  exists(): Promise<boolean>
  compile(): CompiledQuery
  toCypher(): string
}
