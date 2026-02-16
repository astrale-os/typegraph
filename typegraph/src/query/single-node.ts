/**
 * Single Node Builder
 *
 * Represents a query that resolves to exactly ONE node.
 * Extends NodeQueryBuilder for shared filtering, traversal, hierarchy, and projection.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { NodeQueryBuilder } from './node-query-builder'
import { type BaseBuilder } from './base'
import { buildOutTraversal, buildInTraversal } from './traversal'
import type { TraversalOptions } from './traits'
import * as hierarchy from './hierarchy'
import type { QueryAST } from '../ast'
import type { SchemaShape, TypeMap, UntypedMap } from '../schema'
import type { ResolveNode } from '../resolve'
import type {
  NodeLabels,
  NodeProps,
  OutgoingEdges,
  IncomingEdges,
  EdgeTargetsFrom,
  EdgeSourcesTo,
  EdgeTypes,
} from '../inference'
import type {
  AliasMap,
  EdgeAliasMap,
  MultiEdgeTargets,
  MultiEdgeSources,
  MultiEdgeBidirectional,
  EdgeOutboundCardinality,
  EdgeInboundCardinality,
  HierarchyParent,
} from '../inference'

import { CollectionBuilder } from './collection'
import { OptionalNodeBuilder } from './optional-node'
import { extractNodeFromRecord } from '../utils'
import { CardinalityError, ExecutionError } from '../errors'

/**
 * Builder for queries that return exactly one node.
 *
 * @template S - Schema type
 * @template N - Current node label
 * @template Aliases - Map of registered user aliases to their node labels
 * @template EdgeAliases - Map of registered edge aliases to their edge types
 */
export class SingleNodeBuilder<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  Aliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
  T extends TypeMap = UntypedMap,
> extends NodeQueryBuilder<S, N, Aliases, EdgeAliases, T> {
  protected _derive(ast: QueryAST): this {
    return new SingleNodeBuilder(
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

  as<A extends string>(alias: A): SingleNodeBuilder<S, N, Aliases & { [K in A]: N }, EdgeAliases, T> {
    const { ast, aliases } = this._addAlias(alias)
    return new SingleNodeBuilder(ast, this._schema, aliases, this._edgeAliases, this._executor)
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
      q: SingleNodeBuilder<S, N, Aliases, EdgeAliases, T>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B1, E1, T>
      | CollectionBuilder<S, NodeLabels<S>, B1, E1, T>
      | OptionalNodeBuilder<S, NodeLabels<S>, B1, E1, T>,
    branch2?: (
      q: SingleNodeBuilder<S, N, Aliases, EdgeAliases, T>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B2, E2, T>
      | CollectionBuilder<S, NodeLabels<S>, B2, E2, T>
      | OptionalNodeBuilder<S, NodeLabels<S>, B2, E2, T>,
    branch3?: (
      q: SingleNodeBuilder<S, N, Aliases, EdgeAliases, T>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B3, E3, T>
      | CollectionBuilder<S, NodeLabels<S>, B3, E3, T>
      | OptionalNodeBuilder<S, NodeLabels<S>, B3, E3, T>,
    branch4?: (
      q: SingleNodeBuilder<S, N, Aliases, EdgeAliases, T>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B4, E4, T>
      | CollectionBuilder<S, NodeLabels<S>, B4, E4, T>
      | OptionalNodeBuilder<S, NodeLabels<S>, B4, E4, T>,
  ): CollectionBuilder<S, N, Aliases & B1 & B2 & B3 & B4, EdgeAliases & E1 & E2 & E3 & E4, T> {
    const ALIAS_OFFSET_PER_BRANCH = 10

    const createBranchBuilder = (branchIndex: number) =>
      new SingleNodeBuilder<S, N, Aliases, EdgeAliases, T>(
        this._ast.withAliasOffset(branchIndex * ALIAS_OFFSET_PER_BRANCH),
        this._schema,
        this._aliases,
        this._edgeAliases,
        this._executor,
      )

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
  // TRAVERSAL
  // ===========================================================================

  to<E extends OutgoingEdges<S, N>, EA extends string | undefined = undefined>(
    edge: E,
    options?: TraversalOptions<S, E> & { edgeAs?: EA },
  ): EdgeOutboundCardinality<S, E> extends 'one'
    ? SingleNodeBuilder<
        S,
        EdgeTargetsFrom<S, E, N>,
        Aliases,
        EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases,
        T
      >
    : EdgeOutboundCardinality<S, E> extends 'optional'
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

    if (cardinality === 'one') {
      return new SingleNodeBuilder(
        ast,
        this._schema,
        this._aliases,
        newEdgeAliases,
        this._executor,
      ) as any
    }
    if (cardinality === 'optional') {
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

  toOptional<E extends OutgoingEdges<S, N>>(
    edge: E,
    options?: TraversalOptions<S, E>,
  ): OptionalNodeBuilder<S, EdgeTargetsFrom<S, E, N>, Aliases, EdgeAliases, T> {
    const { ast } = buildOutTraversal(this._ast, this._schema, edge as string, {
      where: options?.where as Record<string, unknown>,
      optional: true,
    })
    return new OptionalNodeBuilder(
      ast,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    ) as any
  }

  from<E extends IncomingEdges<S, N>, EA extends string | undefined = undefined>(
    edge: E,
    options?: TraversalOptions<S, E> & { edgeAs?: EA },
  ): EdgeInboundCardinality<S, E> extends 'one'
    ? SingleNodeBuilder<
        S,
        EdgeSourcesTo<S, E, N>,
        Aliases,
        EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases,
        T
      >
    : EdgeInboundCardinality<S, E> extends 'optional'
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

    if (cardinality === 'one') {
      return new SingleNodeBuilder(
        ast,
        this._schema,
        this._aliases,
        newEdgeAliases,
        this._executor,
      ) as any
    }
    if (cardinality === 'optional') {
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

  fromOptional<E extends IncomingEdges<S, N>>(
    edge: E,
    options?: TraversalOptions<S, E>,
  ): OptionalNodeBuilder<S, EdgeSourcesTo<S, E, N>, Aliases, EdgeAliases, T> {
    const { ast } = buildInTraversal(this._ast, this._schema, edge as string, {
      where: options?.where as Record<string, unknown>,
      optional: true,
    })
    return new OptionalNodeBuilder(
      ast,
      this._schema,
      this._aliases,
      this._edgeAliases,
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
    throw new Error('toAny() not yet implemented on SingleNodeBuilder')
  }

  fromAny<Edges extends readonly IncomingEdges<S, N>[]>(
    _edges: Edges,
    _options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeSources<S, N, Edges>, Aliases, EdgeAliases, T> {
    throw new Error('fromAny() not yet implemented on SingleNodeBuilder')
  }

  viaAny<Edges extends readonly (OutgoingEdges<S, N> & IncomingEdges<S, N>)[]>(
    _edges: Edges,
    _options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeBidirectional<S, N, Edges>, Aliases, EdgeAliases, T> {
    throw new Error('viaAny() not yet implemented on SingleNodeBuilder')
  }

  // ===========================================================================
  // HIERARCHY (single-specific)
  // ===========================================================================

  root<E extends EdgeTypes<S> | undefined = undefined>(
    edge?: E,
  ): SingleNodeBuilder<S, HierarchyParent<S, N, E>, Aliases, EdgeAliases, T> {
    const newAst = hierarchy.addRoot(this._ast, this._schema, edge)
    return new SingleNodeBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  parent<E extends EdgeTypes<S> | undefined = undefined>(
    edge?: E,
  ):
    | SingleNodeBuilder<S, HierarchyParent<S, N, E>, Aliases, EdgeAliases, T>
    | OptionalNodeBuilder<S, HierarchyParent<S, N, E>, Aliases, EdgeAliases, T> {
    const { ast: newAst, cardinality } = hierarchy.addParent(this._ast, this._schema, edge)
    if (cardinality === 'optional') {
      return new OptionalNodeBuilder(
        newAst,
        this._schema,
        this._aliases,
        this._edgeAliases,
        this._executor,
      )
    }
    return new SingleNodeBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  depth(_edge?: EdgeTypes<S>): Promise<number> {
    throw new Error('depth() not yet implemented')
  }

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  async execute(): Promise<ResolveNode<T, N & string>> {
    if (!this._executor) {
      throw new ExecutionError('Query execution not available: no queryExecutor provided in config')
    }

    const compiled = this.compile()
    const results = await this._executor.run<Record<string, unknown>>(
      compiled.cypher,
      compiled.params,
      this._ast,
    )

    if (results.length === 0) {
      throw new CardinalityError('one', 0)
    }
    if (results.length > 1) {
      throw new CardinalityError('one', results.length)
    }

    return extractNodeFromRecord(
      results[0]!,
      this._schema,
      this.currentLabel as string,
    ) as ResolveNode<T, N & string>
  }

  async executeOrNull(): Promise<ResolveNode<T, N & string> | null> {
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

export interface SingleNodeSelector<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  K extends keyof NodeProps<S, N>,
> {
  execute(): Promise<Pick<NodeProps<S, N>, K>>
  executeOrNull(): Promise<Pick<NodeProps<S, N>, K> | null>
  compile(): import('../compiler').CompiledQuery
  toCypher(): string
}
