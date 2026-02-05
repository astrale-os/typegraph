/**
 * Node Query Builder (Abstract Base)
 *
 * Shared foundation for CollectionBuilder, SingleNodeBuilder, and OptionalNodeBuilder.
 * Contains all logic that is identical across the three builder types:
 * filtering, label filtering, hierarchy, reachable, projection, composition.
 *
 * Subclasses implement _derive() for immutable builder chaining and execute()
 * for their specific cardinality semantics.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { BaseBuilder, type QueryFragment } from './base'
import {
  createWhereBuilder,
  type WhereBuilder,
  type ReachableOptions,
  type HierarchyTraversalOptions,
  type EdgeFilterOptions,
} from './traits'
import { buildBiTraversal } from './traversal'
import * as hierarchy from './hierarchy'
import type { QueryAST } from '@astrale/typegraph-core'
import type {
  ComparisonOperator,
  WhereCondition,
  ComparisonCondition,
  ExistsCondition,
  ConnectedToCondition,
} from '@astrale/typegraph-core'
import type {
  AnySchema,
  NodeLabels,
  NodeProps,
  OutgoingEdges,
  IncomingEdges,
  EdgeTypes,
  EdgeTargetsFrom,
  EdgeSourcesTo,
} from '@astrale/typegraph-core'
import type {
  AliasMap,
  EdgeAliasMap,
  HierarchyChildren,
  AncestorResult,
  QueryContext,
  InferReturnType,
  TypedReturnQuery,
} from '@astrale/typegraph-core'
import { ExecutionError } from '@astrale/typegraph-core'

import type { QueryExecutor } from './types'
import { ReturningBuilder } from './returning'
import { TypedReturningBuilder } from './typed-returning'
import { createQueryContext, parseReturnSpec, type AliasInfo, type EdgeAliasInfo } from './proxy'

// Circular dependency resolution: CollectionBuilder extends NodeQueryBuilder,
// but NodeQueryBuilder methods return CollectionBuilder. CollectionBuilder
// registers itself here at module initialization time via _registerCollectionBuilder().
import type { CollectionBuilder as CollectionBuilderType } from './collection'

let _CollectionBuilderCtor: any = null

/** @internal Called by collection.ts to register itself for circular dependency resolution. */
export function _registerCollectionBuilder(ctor: any) {
  _CollectionBuilderCtor = ctor
}

function getCollectionBuilder(): typeof import('./collection').CollectionBuilder {
  if (!_CollectionBuilderCtor) {
    throw new Error('CollectionBuilder not registered. This is an internal initialization error.')
  }
  return _CollectionBuilderCtor
}

// =============================================================================
// ABSTRACT BASE CLASS
// =============================================================================

/**
 * Abstract base for all node query builders.
 *
 * Provides shared state (aliases, edge aliases, executor) and all methods
 * whose implementation is identical across Collection, Single, and Optional.
 *
 * The `_derive(ast)` abstract method enables polymorphic `this` returns:
 * each subclass creates a new instance of itself, preserving type identity.
 */
export abstract class NodeQueryBuilder<
  S extends AnySchema,
  N extends NodeLabels<S>,
  Aliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
> extends BaseBuilder<S, N> {
  protected readonly _aliases: Aliases
  protected readonly _edgeAliases: EdgeAliases
  protected readonly _executor: QueryExecutor | null

  constructor(
    ast: QueryAST,
    schema: S,
    aliases: Aliases = {} as Aliases,
    edgeAliases: EdgeAliases = {} as EdgeAliases,
    executor: QueryExecutor | null = null,
  ) {
    super(ast, schema)
    this._aliases = aliases
    this._edgeAliases = edgeAliases
    this._executor = executor
  }

  /**
   * Create a new instance of the same builder type with an updated AST.
   * Each subclass implements this to return its own concrete type.
   */
  protected abstract _derive(ast: QueryAST): this

  // ===========================================================================
  // HELPERS (for subclass use)
  // ===========================================================================

  /**
   * Shared body for `as()`. Returns the updated AST and aliases.
   * Subclasses wrap the result in their own constructor since the
   * Aliases generic parameter changes.
   */
  protected _addAlias<A extends string>(
    alias: A,
  ): { ast: QueryAST; aliases: Aliases & { [K in A]: N } } {
    return {
      ast: this._ast.addUserAlias(alias),
      aliases: { ...this._aliases, [alias]: this.currentLabel } as Aliases & { [K in A]: N },
    }
  }

  /**
   * Create a CollectionBuilder from the current state.
   * Used by traversal/hierarchy methods that always return collections.
   */
  protected _collection<NN extends NodeLabels<S>>(
    ast: QueryAST,
    aliases?: AliasMap<S>,
    edgeAliases?: EdgeAliasMap<S>,
  ): CollectionBuilderType<S, NN, Aliases, EdgeAliases> {
    const CB = getCollectionBuilder()
    return new CB(
      ast,
      this._schema,
      aliases ?? this._aliases,
      edgeAliases ?? this._edgeAliases,
      this._executor,
    ) as any
  }

  // ===========================================================================
  // FILTERING
  // ===========================================================================

  where<K extends keyof NodeProps<S, N> & string>(
    field: K,
    operator: ComparisonOperator,
    value?: NodeProps<S, N>[K] | NodeProps<S, N>[K][],
  ): this {
    const condition: ComparisonCondition = {
      type: 'comparison',
      field,
      operator,
      value,
      target: this._ast.currentAlias,
    }
    return this._derive(this._ast.addWhere([condition]))
  }

  whereComplex(builder: (w: WhereBuilder<S, N>) => WhereCondition): this {
    const whereBuilder = createWhereBuilder<S, N>(this._ast.currentAlias)
    const condition = builder(whereBuilder)
    return this._derive(this._ast.addWhere([condition]))
  }

  hasEdge<E extends OutgoingEdges<S, N> | IncomingEdges<S, N>>(
    edge: E,
    direction: 'out' | 'in' | 'both' = 'out',
  ): this {
    const condition: ExistsCondition = {
      type: 'exists',
      edge: edge as string,
      direction,
      target: this._ast.currentAlias,
      negated: false,
    }
    return this._derive(this._ast.addWhere([condition]))
  }

  hasNoEdge<E extends OutgoingEdges<S, N> | IncomingEdges<S, N>>(
    edge: E,
    direction: 'out' | 'in' | 'both' = 'out',
  ): this {
    const condition: ExistsCondition = {
      type: 'exists',
      edge: edge as string,
      direction,
      target: this._ast.currentAlias,
      negated: true,
    }
    return this._derive(this._ast.addWhere([condition]))
  }

  whereConnectedTo<E extends OutgoingEdges<S, N>>(edge: E, targetId: string): this {
    const condition: ConnectedToCondition = {
      type: 'connectedTo',
      edge: edge as string,
      direction: 'out',
      nodeId: targetId,
      target: this._ast.currentAlias,
    }
    return this._derive(this._ast.addWhere([condition]))
  }

  whereConnectedFrom<E extends IncomingEdges<S, N>>(edge: E, sourceId: string): this {
    const condition: ConnectedToCondition = {
      type: 'connectedTo',
      edge: edge as string,
      direction: 'in',
      nodeId: sourceId,
      target: this._ast.currentAlias,
    }
    return this._derive(this._ast.addWhere([condition]))
  }

  // ===========================================================================
  // LABEL FILTERING
  // ===========================================================================

  withLabels(...labels: string[]): this {
    if (labels.length === 0) return this
    const condition = {
      type: 'label' as const,
      labels,
      mode: 'all' as const,
      negated: false,
      target: this._ast.currentAlias,
    }
    return this._derive(this._ast.addWhere([condition]))
  }

  withAnyLabel(...labels: string[]): this {
    if (labels.length === 0) return this
    const condition = {
      type: 'label' as const,
      labels,
      mode: 'any' as const,
      negated: false,
      target: this._ast.currentAlias,
    }
    return this._derive(this._ast.addWhere([condition]))
  }

  withoutLabel(label: string): this {
    const condition = {
      type: 'label' as const,
      labels: [label],
      mode: 'all' as const,
      negated: true,
      target: this._ast.currentAlias,
    }
    return this._derive(this._ast.addWhere([condition]))
  }

  withoutAnyLabel(...labels: string[]): this {
    if (labels.length === 0) return this
    const condition = {
      type: 'label' as const,
      labels,
      mode: 'any' as const,
      negated: true,
      target: this._ast.currentAlias,
    }
    return this._derive(this._ast.addWhere([condition]))
  }

  withAllLabels(...labels: string[]): this {
    return this.withLabels(...labels)
  }

  withoutAllLabels(...labels: string[]): this {
    if (labels.length === 0) return this
    const condition = {
      type: 'label' as const,
      labels,
      mode: 'all' as const,
      negated: true,
      target: this._ast.currentAlias,
    }
    return this._derive(this._ast.addWhere([condition]))
  }

  // ===========================================================================
  // TRAVERSAL (bidirectional — always returns CollectionBuilder)
  // ===========================================================================

  via<E extends OutgoingEdges<S, N> & IncomingEdges<S, N>>(
    edge: E,
    options?: EdgeFilterOptions<S, E>,
  ): CollectionBuilderType<S, EdgeTargetsFrom<S, E, N> | EdgeSourcesTo<S, E, N>, Aliases, EdgeAliases> {
    const result = buildBiTraversal(this._ast, this._schema, edge as string, {
      where: options?.where as Record<string, unknown>,
    })
    return this._collection(result.ast)
  }

  // ===========================================================================
  // HIERARCHY TRAVERSAL (all return CollectionBuilder)
  // ===========================================================================

  ancestors<
    E extends EdgeTypes<S> | undefined = undefined,
    K extends NodeLabels<S> | undefined = undefined,
  >(
    edgeOrOptions?: E | (HierarchyTraversalOptions & { untilKind?: K }),
    options?: HierarchyTraversalOptions & { untilKind?: K },
  ): CollectionBuilderType<S, AncestorResult<S, N, E, K>, Aliases, EdgeAliases> {
    const newAst = hierarchy.addAncestors(this._ast, this._schema, edgeOrOptions, options)
    return this._collection(newAst)
  }

  selfAndAncestors<
    E extends EdgeTypes<S> | undefined = undefined,
    K extends NodeLabels<S> | undefined = undefined,
  >(
    edgeOrOptions?: E | (HierarchyTraversalOptions & { untilKind?: K }),
    options?: HierarchyTraversalOptions & { untilKind?: K },
  ): CollectionBuilderType<S, AncestorResult<S, N, E, K> | N, Aliases, EdgeAliases> {
    const newAst = hierarchy.addSelfAndAncestors(this._ast, this._schema, edgeOrOptions, options)
    return this._collection(newAst)
  }

  descendants<E extends EdgeTypes<S> | undefined = undefined>(
    edgeOrOptions?: E | HierarchyTraversalOptions,
    options?: HierarchyTraversalOptions,
  ): CollectionBuilderType<S, HierarchyChildren<S, N, E>, Aliases, EdgeAliases> {
    const newAst = hierarchy.addDescendants(this._ast, this._schema, edgeOrOptions, options)
    return this._collection(newAst)
  }

  siblings(edge?: EdgeTypes<S>): CollectionBuilderType<S, N, Aliases, EdgeAliases> {
    const newAst = hierarchy.addSiblings(this._ast, this._schema, edge)
    return this._collection(newAst)
  }

  children<E extends EdgeTypes<S> | undefined = undefined>(
    edge?: E,
  ): CollectionBuilderType<S, HierarchyChildren<S, N, E>, Aliases, EdgeAliases> {
    const newAst = hierarchy.addChildren(this._ast, this._schema, edge)
    return this._collection(newAst)
  }

  // ===========================================================================
  // TRANSITIVE CLOSURE (returns CollectionBuilder)
  // ===========================================================================

  reachable<Edges extends EdgeTypes<S> | readonly EdgeTypes<S>[]>(
    edges: Edges,
    options?: ReachableOptions,
  ): CollectionBuilderType<S, N, Aliases, EdgeAliases> {
    const newAst = hierarchy.addReachable(this._ast, edges, options)
    return this._collection(newAst)
  }

  selfAndReachable<Edges extends EdgeTypes<S> | readonly EdgeTypes<S>[]>(
    edges: Edges,
    options?: ReachableOptions,
  ): CollectionBuilderType<S, N, Aliases, EdgeAliases> {
    const newAst = hierarchy.addSelfAndReachable(this._ast, edges, options)
    return this._collection(newAst)
  }

  // ===========================================================================
  // PROJECTION (.return)
  // ===========================================================================

  return<R extends Record<string, unknown>>(
    selector: (q: QueryContext<S, Aliases, Record<string, never>, EdgeAliases>) => R,
  ): TypedReturnQuery<InferReturnType<R>> {
    const nodeAliasInfo = new Map<string, AliasInfo>()
    const optionalAliasInfo = new Map<string, AliasInfo>()
    const edgeAliasInfo = new Map<string, EdgeAliasInfo>()
    const astAliases = this._ast.userAliases

    for (const [userAlias, label] of Object.entries(this._aliases)) {
      const internalAlias = astAliases.get(userAlias) ?? userAlias
      nodeAliasInfo.set(userAlias, {
        userAlias,
        internalAlias,
        label: label as string,
        isOptional: false,
      })
    }

    for (const [userAlias, edgeType] of Object.entries(this._edgeAliases)) {
      const internalAlias = astAliases.get(userAlias) ?? userAlias
      edgeAliasInfo.set(userAlias, {
        userAlias,
        internalAlias,
        edgeType: edgeType as string,
        isOptional: false,
      })
    }

    const context = createQueryContext<S, Aliases, Record<string, never>, EdgeAliases>(
      nodeAliasInfo,
      optionalAliasInfo,
      edgeAliasInfo,
    )

    const returnResult = selector(context)
    const returnSpec = parseReturnSpec(returnResult)

    const nodeAliasNames = [...returnSpec.nodeFields.values()].map((f) => f.alias)
    const edgeAliasNames = [...returnSpec.edgeFields.values()].map((f) => f.alias)
    const collectAliases: Record<string, { sourceAlias: string; distinct?: boolean }> = {}

    for (const field of returnSpec.propertyFields.values()) {
      if (!nodeAliasNames.includes(field.alias)) {
        nodeAliasNames.push(field.alias)
      }
    }

    for (const [outputKey, field] of returnSpec.collectFields) {
      collectAliases[outputKey] = {
        sourceAlias: field.alias,
        distinct: field.distinct,
      }
    }

    const newAst = this._ast.setMultiNodeProjection(
      nodeAliasNames,
      edgeAliasNames,
      Object.keys(collectAliases).length > 0 ? collectAliases : undefined,
    )

    const innerBuilder = new ReturningBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
      {} as Record<string, never>,
    )

    return new TypedReturningBuilder<InferReturnType<R>>(
      innerBuilder as any,
      returnSpec,
      returnResult,
      this._executor,
    )
  }

  // ===========================================================================
  // COMPOSITION
  // ===========================================================================

  pipe<NOut extends NodeLabels<S>, BOut extends BaseBuilder<S, NOut>>(
    fragment: QueryFragment<S, N, NOut, this, BOut>,
  ): BOut {
    return fragment(this)
  }

  // ===========================================================================
  // EXECUTION HELPERS
  // ===========================================================================

  async exists(): Promise<boolean> {
    if (!this._executor) {
      throw new ExecutionError('Query execution not available: no queryExecutor provided in config')
    }
    const compiled = this.compile()
    const results = await this._executor.run<Record<string, unknown>>(
      compiled.cypher,
      compiled.params,
      this._ast,
    )
    return results.length > 0
  }

  // ===========================================================================
  // STUB
  // ===========================================================================

  select<K extends keyof NodeProps<S, N> & string>(..._fields: K[]): unknown {
    throw new Error('Select not yet implemented')
  }
}
