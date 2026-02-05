/**
 * Collection Builder
 *
 * Represents a query that resolves to MULTIPLE nodes.
 */

import { BaseBuilder, type QueryFragment } from './base'
import {
  buildEdgeWhere,
  createWhereBuilder,
  type TraversalOptions,
  type ReachableOptions,
  type WhereBuilder,
  type HierarchyTraversalOptions,
} from './traits'
import * as shared from './shared'
import type { QueryAST } from '@astrale/typegraph-core'
import { getCompiler } from '../compiler'
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
  MultiEdgeTargets,
  MultiEdgeSources,
  MultiEdgeBidirectional,
  HierarchyChildren,
  AncestorResult,
  QueryContext,
  InferReturnType,
  TypedReturnQuery,
} from '@astrale/typegraph-core'

// Forward declarations
import { GroupedBuilder } from './grouped'
import { TypedReturningBuilder } from './typed-returning'
import type { QueryExecutor } from './types'
import { extractNodeFromRecord, convertNeo4jValue } from '../utils'
import { ExecutionError } from '@astrale/typegraph-core'
import { createQueryContext, parseReturnSpec, type AliasInfo, type EdgeAliasInfo } from './proxy'

// Direct imports - using index to avoid circular dependency issues at runtime
import { SingleNodeBuilder } from './single-node'
import { type OptionalNodeBuilder } from './optional-node'
import { ReturningBuilder } from './returning'

/**
 * Builder for queries that return multiple nodes.
 *
 * @template S - Schema type
 * @template N - Current node label
 * @template Aliases - Map of registered user aliases
 * @template EdgeAliases - Map of registered edge aliases
 */
export class CollectionBuilder<
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

  // ===========================================================================
  // ALIASING
  // ===========================================================================

  as<A extends string>(alias: A): CollectionBuilder<S, N, Aliases & { [K in A]: N }, EdgeAliases> {
    const newAst = this._ast.addUserAlias(alias)
    return new CollectionBuilder(
      newAst,
      this._schema,
      { ...this._aliases, [alias]: this.currentLabel } as Aliases & { [K in A]: N },
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Define the return shape using a typed callback.
   * The return type is inferred from the callback's return expression.
   *
   * This is the preferred way to specify return values as it provides:
   * - Full IDE autocomplete for node properties
   * - Compile-time validation of alias references
   * - Typed `collect()` aggregations
   *
   * @param selector - Callback receiving query context with typed alias proxies
   * @returns A ReturningBuilder with inferred return type
   *
   * @example
   * ```typescript
   * // Return full nodes and specific properties
   * .return(q => ({
   *   author: q.u,           // Full User node
   *   postTitle: q.p.title   // Just the string property
   * }))
   *
   * // With collect aggregation
   * .return(q => ({
   *   author: q.u,
   *   posts: collect(q.p)    // Post[]
   * }))
   * ```
   */
  return<R extends Record<string, unknown>>(
    selector: (q: QueryContext<S, Aliases, Record<string, never>, EdgeAliases>) => R,
  ): TypedReturnQuery<InferReturnType<R>> {
    // Build alias info maps for the proxy
    const nodeAliasInfo = new Map<string, AliasInfo>()
    const optionalAliasInfo = new Map<string, AliasInfo>()
    const edgeAliasInfo = new Map<string, EdgeAliasInfo>()

    // Get internal aliases from AST
    const astAliases = this._ast.userAliases

    // Build node alias info
    for (const [userAlias, label] of Object.entries(this._aliases)) {
      const internalAlias = astAliases.get(userAlias) ?? userAlias
      nodeAliasInfo.set(userAlias, {
        userAlias,
        internalAlias,
        label: label as string,
        isOptional: false,
      })
    }

    // Build edge alias info
    for (const [userAlias, edgeType] of Object.entries(this._edgeAliases)) {
      const internalAlias = astAliases.get(userAlias) ?? userAlias
      edgeAliasInfo.set(userAlias, {
        userAlias,
        internalAlias,
        edgeType: edgeType as string,
        isOptional: false,
      })
    }

    // Create the query context proxy
    const context = createQueryContext<S, Aliases, Record<string, never>, EdgeAliases>(
      nodeAliasInfo,
      optionalAliasInfo,
      edgeAliasInfo,
    )

    // Execute the selector to get the return spec
    const returnResult = selector(context)

    // Parse the return specification
    const returnSpec = parseReturnSpec(returnResult)

    // Build AST projection from the return spec
    const nodeAliasNames = [...returnSpec.nodeFields.values()].map((f) => f.alias)
    const edgeAliasNames = [...returnSpec.edgeFields.values()].map((f) => f.alias)
    const collectAliases: Record<string, { sourceAlias: string; distinct?: boolean }> = {}

    // Add property fields as node aliases (they need the node in the result)
    for (const field of returnSpec.propertyFields.values()) {
      if (!nodeAliasNames.includes(field.alias)) {
        nodeAliasNames.push(field.alias)
      }
    }

    // Add collect fields
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

    // Create the inner builder for query compilation
    const innerBuilder = new ReturningBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
      {} as Record<string, never>,
    )

    // Return a typed wrapper that transforms results
    return new TypedReturningBuilder<InferReturnType<R>>(
      innerBuilder as any,
      returnSpec,
      returnResult,
      this._executor,
    )
  }

  // ===========================================================================
  // FORK (Fan-out Pattern)
  // ===========================================================================

  /**
   * Create multiple independent traversals from the current node.
   * Each branch callback receives a fresh builder starting at this node.
   * Aliases from all branches are merged and can be used in returning().
   *
   * @example
   * ```typescript
   * const query = await graph
   *   .node('message').as('msg')
   *   .fork(
   *     q => q.toOptional('REPLY_TO').as('replyTo'),
   *     q => q.from('REACTION').as('reaction'),
   *   )
   *   .return(q => ({
   *     msg: q.msg,
   *     replyTo: q.replyTo,
   *     reactions: collect(q.reaction),
   *   }))
   * const results = await query.execute()
   * ```
   */
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
      q: CollectionBuilder<S, N, Aliases, EdgeAliases>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B1, E1>
      | CollectionBuilder<S, NodeLabels<S>, B1, E1>
      | OptionalNodeBuilder<S, NodeLabels<S>, B1, E1>,
    branch2?: (
      q: CollectionBuilder<S, N, Aliases, EdgeAliases>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B2, E2>
      | CollectionBuilder<S, NodeLabels<S>, B2, E2>
      | OptionalNodeBuilder<S, NodeLabels<S>, B2, E2>,
    branch3?: (
      q: CollectionBuilder<S, N, Aliases, EdgeAliases>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B3, E3>
      | CollectionBuilder<S, NodeLabels<S>, B3, E3>
      | OptionalNodeBuilder<S, NodeLabels<S>, B3, E3>,
    branch4?: (
      q: CollectionBuilder<S, N, Aliases, EdgeAliases>,
    ) =>
      | SingleNodeBuilder<S, NodeLabels<S>, B4, E4>
      | CollectionBuilder<S, NodeLabels<S>, B4, E4>
      | OptionalNodeBuilder<S, NodeLabels<S>, B4, E4>,
  ): CollectionBuilder<S, N, Aliases & B1 & B2 & B3 & B4, EdgeAliases & E1 & E2 & E3 & E4> {
    // Create a fresh builder for each branch starting at current node
    // Each branch gets an offset alias counter to ensure unique aliases
    // We estimate each branch might use up to 10 aliases (generous estimate)
    const ALIAS_OFFSET_PER_BRANCH = 10

    const createBranchBuilder = (branchIndex: number) =>
      new CollectionBuilder<S, N, Aliases, EdgeAliases>(
        this._ast.withAliasOffset(branchIndex * ALIAS_OFFSET_PER_BRANCH),
        this._schema,
        this._aliases,
        this._edgeAliases,
        this._executor,
      )

    // Execute each branch callback - use BaseBuilder to avoid deep type instantiation
    const branches: BaseBuilder<S, NodeLabels<S>>[] = [
      branch1(createBranchBuilder(0)) as BaseBuilder<S, NodeLabels<S>>,
    ]
    if (branch2) branches.push(branch2(createBranchBuilder(1)) as BaseBuilder<S, NodeLabels<S>>)
    if (branch3) branches.push(branch3(createBranchBuilder(2)) as BaseBuilder<S, NodeLabels<S>>)
    if (branch4) branches.push(branch4(createBranchBuilder(3)) as BaseBuilder<S, NodeLabels<S>>)

    // Extract ASTs from branches
    const branchAsts = branches.map((b) => b.ast)

    // Add fork step to AST
    const newAst = this._ast.addFork(branchAsts)

    // Merge aliases from all branches
    let mergedAliases = { ...this._aliases } as Aliases & B1 & B2 & B3 & B4
    let mergedEdgeAliases = { ...this._edgeAliases } as EdgeAliases & E1 & E2 & E3 & E4

    for (const branch of branches) {
      const branchBuilder = branch as unknown as {
        _aliases?: AliasMap<S>
        _edgeAliases?: EdgeAliasMap<S>
      }
      if (branchBuilder._aliases) {
        mergedAliases = { ...mergedAliases, ...branchBuilder._aliases }
      }
      if (branchBuilder._edgeAliases) {
        mergedEdgeAliases = { ...mergedEdgeAliases, ...branchBuilder._edgeAliases }
      }
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

  byId(id: string): SingleNodeBuilder<S, N, Aliases, EdgeAliases> {
    const condition: ComparisonCondition = {
      type: 'comparison',
      field: 'id',
      operator: 'eq',
      value: id,
      target: this._ast.currentAlias,
    }
    const newAst = this._ast.addWhere([condition]).setProjectionType('node')
    return new SingleNodeBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  first(): SingleNodeBuilder<S, N, Aliases, EdgeAliases> {
    const newAst = this._ast.addLimit(1).setProjectionType('node')
    return new SingleNodeBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  take(count: number): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const newAst = this._ast.addLimit(count)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
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
    EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases
  > {
    const edgeDef = this._schema.edges[edge]
    const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]
    const opts = options

    const newAst = this._ast.addTraversal({
      edges: [edge as string],
      direction: 'out',
      toLabels,
      optional: false,
      cardinality: edgeDef.cardinality.outbound,
      edgeWhere: buildEdgeWhere(opts?.where),
      edgeUserAlias: opts?.edgeAs,
      variableLength: opts?.depth
        ? { min: opts.depth.min ?? 1, max: opts.depth.max, uniqueness: 'nodes' }
        : undefined,
    })

    const newEdgeAliases = opts?.edgeAs
      ? ({ ...this._edgeAliases, [opts.edgeAs]: edge } as EA extends string
          ? EdgeAliases & { [K in EA]: E }
          : EdgeAliases)
      : (this._edgeAliases as EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases)

    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      newEdgeAliases,
      this._executor,
    )
  }

  toOptional<E extends OutgoingEdges<S, N>>(
    edge: E,
    options?: TraversalOptions<S, E>,
  ): CollectionBuilder<S, EdgeTargetsFrom<S, E, N>, Aliases, EdgeAliases> {
    const edgeDef = this._schema.edges[edge]
    const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]
    const opts = options

    const newAst = this._ast.addTraversal({
      edges: [edge as string],
      direction: 'out',
      toLabels,
      optional: true,
      cardinality: 'optional',
      edgeWhere: buildEdgeWhere(opts?.where),
    })

    return new CollectionBuilder(
      newAst,
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
    EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases
  > {
    const edgeDef = this._schema.edges[edge]
    const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
    const opts = options

    const newAst = this._ast.addTraversal({
      edges: [edge as string],
      direction: 'in',
      toLabels: fromLabels,
      optional: false,
      cardinality: edgeDef.cardinality.inbound,
      edgeWhere: buildEdgeWhere(opts?.where),
      edgeUserAlias: opts?.edgeAs,
    })

    const newEdgeAliases = opts?.edgeAs
      ? ({ ...this._edgeAliases, [opts.edgeAs]: edge } as EA extends string
          ? EdgeAliases & { [K in EA]: E }
          : EdgeAliases)
      : (this._edgeAliases as EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases)

    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      newEdgeAliases,
      this._executor,
    )
  }

  fromOptional<E extends IncomingEdges<S, N>>(
    edge: E,
    options?: TraversalOptions<S, E>,
  ): CollectionBuilder<S, EdgeSourcesTo<S, E, N>, Aliases, EdgeAliases> {
    const edgeDef = this._schema.edges[edge]
    const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
    const opts = options

    const newAst = this._ast.addTraversal({
      edges: [edge as string],
      direction: 'in',
      toLabels: fromLabels,
      optional: true,
      cardinality: 'optional',
      edgeWhere: buildEdgeWhere(opts?.where),
    })

    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  via<E extends OutgoingEdges<S, N> & IncomingEdges<S, N>>(
    edge: E,
    options?: TraversalOptions<S, E>,
  ): CollectionBuilder<S, EdgeTargetsFrom<S, E, N> | EdgeSourcesTo<S, E, N>, Aliases, EdgeAliases> {
    const edgeDef = this._schema.edges[edge]
    const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]
    const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
    const allLabels = [...new Set([...toLabels, ...fromLabels])]
    const opts = options

    const newAst = this._ast.addTraversal({
      edges: [edge as string],
      direction: 'both',
      toLabels: allLabels,
      optional: false,
      cardinality: 'many',
      edgeWhere: buildEdgeWhere(opts?.where),
    })

    return new CollectionBuilder(
      newAst,
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
  ): CollectionBuilder<S, MultiEdgeTargets<S, N, Edges>, Aliases, EdgeAliases> {
    const allLabels: string[] = []
    for (const edge of edges) {
      const edgeDef = this._schema.edges[edge]
      const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]
      allLabels.push(...toLabels)
    }
    const opts = options

    const newAst = this._ast.addTraversal({
      edges: edges as unknown as string[],
      direction: 'out',
      toLabels: [...new Set(allLabels)],
      optional: false,
      cardinality: 'mixed',
      edgeWhere: buildEdgeWhere(opts?.where),
    })

    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  fromAny<Edges extends readonly IncomingEdges<S, N>[]>(
    edges: Edges,
    options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeSources<S, N, Edges>, Aliases, EdgeAliases> {
    const allLabels: string[] = []
    for (const edge of edges) {
      const edgeDef = this._schema.edges[edge]
      const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
      allLabels.push(...fromLabels)
    }
    const opts = options

    const newAst = this._ast.addTraversal({
      edges: edges as unknown as string[],
      direction: 'in',
      toLabels: [...new Set(allLabels)],
      optional: false,
      cardinality: 'mixed',
      edgeWhere: buildEdgeWhere(opts?.where),
    })

    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  viaAny<Edges extends readonly (OutgoingEdges<S, N> & IncomingEdges<S, N>)[]>(
    edges: Edges,
    options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeBidirectional<S, N, Edges>, Aliases, EdgeAliases> {
    const allLabels: string[] = []
    for (const edge of edges) {
      const edgeDef = this._schema.edges[edge]
      const toLabels = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]
      const fromLabels = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
      allLabels.push(...toLabels, ...fromLabels)
    }
    const opts = options

    const newAst = this._ast.addTraversal({
      edges: edges as unknown as string[],
      direction: 'both',
      toLabels: [...new Set(allLabels)],
      optional: false,
      cardinality: 'mixed',
      edgeWhere: buildEdgeWhere(opts?.where),
    })

    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  // ===========================================================================
  // TRANSITIVE CLOSURE
  // ===========================================================================

  reachable<Edges extends EdgeTypes<S> | readonly EdgeTypes<S>[]>(
    edges: Edges,
    options?: ReachableOptions,
  ): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const newAst = shared.addReachable(this._ast, edges, options)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Get each node in the collection and all nodes reachable via any path through the specified edges.
   * Depth 0 = the node itself, 1+ = reachable nodes.
   * Results include a `_depth` field.
   */
  selfAndReachable<Edges extends EdgeTypes<S> | readonly EdgeTypes<S>[]>(
    edges: Edges,
    options?: ReachableOptions,
  ): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const newAst = shared.addSelfAndReachable(this._ast, edges, options)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  // ===========================================================================
  // HIERARCHY TRAVERSAL
  // ===========================================================================

  /**
   * Get all ancestor nodes up the hierarchy tree.
   * Returns all node types that can be parents of the current node type.
   * When `untilKind` is specified, filters to only that node kind.
   */
  ancestors<
    E extends EdgeTypes<S> | undefined = undefined,
    K extends NodeLabels<S> | undefined = undefined,
  >(
    edgeOrOptions?: E | (HierarchyTraversalOptions & { untilKind?: K }),
    options?: HierarchyTraversalOptions & { untilKind?: K },
  ): CollectionBuilder<S, AncestorResult<S, N, E, K>, Aliases, EdgeAliases> {
    const newAst = shared.addAncestors(this._ast, this._schema, edgeOrOptions, options)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Get each node in the collection and all its ancestors, with depth information.
   * Depth 0 = the node itself, 1 = parent, 2 = grandparent, etc.
   * Results include a `_depth` field.
   * When `untilKind` is specified, filters ancestors to only that node kind.
   */
  selfAndAncestors<
    E extends EdgeTypes<S> | undefined = undefined,
    K extends NodeLabels<S> | undefined = undefined,
  >(
    edgeOrOptions?: E | (HierarchyTraversalOptions & { untilKind?: K }),
    options?: HierarchyTraversalOptions & { untilKind?: K },
  ): CollectionBuilder<S, AncestorResult<S, N, E, K> | N, Aliases, EdgeAliases> {
    const newAst = shared.addSelfAndAncestors(this._ast, this._schema, edgeOrOptions, options)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  descendants<E extends EdgeTypes<S> | undefined = undefined>(
    edgeOrOptions?: E | HierarchyTraversalOptions,
    options?: HierarchyTraversalOptions,
  ): CollectionBuilder<S, HierarchyChildren<S, N, E>, Aliases, EdgeAliases> {
    const newAst = shared.addDescendants(this._ast, this._schema, edgeOrOptions, options)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  siblings(edge?: EdgeTypes<S>): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const newAst = shared.addSiblings(this._ast, this._schema, edge)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  children<E extends EdgeTypes<S> | undefined = undefined>(
    edge?: E,
  ): CollectionBuilder<S, HierarchyChildren<S, N, E>, Aliases, EdgeAliases> {
    const newAst = shared.addChildren(this._ast, this._schema, edge)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  // ===========================================================================
  // FILTERING
  // ===========================================================================

  where<K extends keyof NodeProps<S, N> & string>(
    field: K,
    operator: ComparisonOperator,
    value?: NodeProps<S, N>[K] | NodeProps<S, N>[K][],
  ): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const condition: ComparisonCondition = {
      type: 'comparison',
      field,
      operator,
      value,
      target: this._ast.currentAlias,
    }
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  whereComplex(
    builder: (w: WhereBuilder<S, N>) => WhereCondition,
  ): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const whereBuilder = createWhereBuilder<S, N>(this._ast.currentAlias)
    const condition = builder(whereBuilder)
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  hasEdge<E extends OutgoingEdges<S, N> | IncomingEdges<S, N>>(
    edge: E,
    direction: 'out' | 'in' | 'both' = 'out',
  ): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const condition: ExistsCondition = {
      type: 'exists',
      edge: edge as string,
      direction,
      target: this._ast.currentAlias,
      negated: false,
    }
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  hasNoEdge<E extends OutgoingEdges<S, N> | IncomingEdges<S, N>>(
    edge: E,
    direction: 'out' | 'in' | 'both' = 'out',
  ): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const condition: ExistsCondition = {
      type: 'exists',
      edge: edge as string,
      direction,
      target: this._ast.currentAlias,
      negated: true,
    }
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  // ---------------------------------------------------------------------------
  // LABEL FILTERING (Multi-Label Support)
  // ---------------------------------------------------------------------------

  /**
   * Filter to nodes that have ALL specified labels.
   */
  withLabels(...labels: string[]): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    if (labels.length === 0) return this

    const condition = {
      type: 'label' as const,
      labels,
      mode: 'all' as const,
      negated: false,
      target: this._ast.currentAlias,
    }
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Filter to nodes that have ANY of the specified labels.
   */
  withAnyLabel(...labels: string[]): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    if (labels.length === 0) return this

    const condition = {
      type: 'label' as const,
      labels,
      mode: 'any' as const,
      negated: false,
      target: this._ast.currentAlias,
    }
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Filter to nodes that do NOT have the specified label.
   */
  withoutLabel(label: string): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const condition = {
      type: 'label' as const,
      labels: [label],
      mode: 'all' as const,
      negated: true,
      target: this._ast.currentAlias,
    }
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Filter to nodes that do NOT have ANY of the specified labels.
   */
  withoutAnyLabel(...labels: string[]): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    if (labels.length === 0) return this

    const condition = {
      type: 'label' as const,
      labels,
      mode: 'any' as const,
      negated: true,
      target: this._ast.currentAlias,
    }
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Filter to nodes that have ALL specified labels.
   * Alias for `withLabels()`.
   */
  withAllLabels(...labels: string[]): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    return this.withLabels(...labels)
  }

  /**
   * Filter to nodes that do NOT have ALL of the specified labels.
   */
  withoutAllLabels(...labels: string[]): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    if (labels.length === 0) return this

    const condition = {
      type: 'label' as const,
      labels,
      mode: 'all' as const,
      negated: true,
      target: this._ast.currentAlias,
    }
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Filter to nodes that have an outgoing edge to a specific node ID.
   *
   * @example
   * ```typescript
   * // Find all apps defined by a specific definition
   * graph.node('application').whereConnectedTo('definedBy', definitionId)
   *
   * // Find all modules of a specific type
   * graph.node('module').whereConnectedTo('ofType', typeId)
   * ```
   */
  whereConnectedTo<E extends OutgoingEdges<S, N>>(
    edge: E,
    targetId: string,
  ): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const condition: ConnectedToCondition = {
      type: 'connectedTo',
      edge: edge as string,
      direction: 'out',
      nodeId: targetId,
      target: this._ast.currentAlias,
    }
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Filter to nodes that have an incoming edge from a specific node ID.
   *
   * @example
   * ```typescript
   * // Find all types implemented by a specific app
   * graph.node('type').whereConnectedFrom('implementedBy', appId)
   * ```
   */
  whereConnectedFrom<E extends IncomingEdges<S, N>>(
    edge: E,
    sourceId: string,
  ): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const condition: ConnectedToCondition = {
      type: 'connectedTo',
      edge: edge as string,
      direction: 'in',
      nodeId: sourceId,
      target: this._ast.currentAlias,
    }
    const newAst = this._ast.addWhere([condition])
    return new CollectionBuilder(
      newAst,
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
  ): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const newAst = this._ast.addOrderBy([{ field, direction, target: this._ast.currentAlias }])
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  orderByMultiple(
    fields: Array<{ field: keyof NodeProps<S, N> & string; direction: 'ASC' | 'DESC' }>,
  ): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const orderFields = fields.map((f) => ({
      field: f.field,
      direction: f.direction,
      target: this._ast.currentAlias,
    }))
    const newAst = this._ast.addOrderBy(orderFields)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  limit(count: number): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const newAst = this._ast.addLimit(count)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  skip(count: number): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const newAst = this._ast.addSkip(count)
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  paginate(options: {
    page: number
    pageSize: number
  }): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const offset = (options.page - 1) * options.pageSize
    return this.skip(offset).limit(options.pageSize)
  }

  after(_cursor: string): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    throw new Error('Cursor pagination not yet implemented')
  }

  before(_cursor: string): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    throw new Error('Cursor pagination not yet implemented')
  }

  distinct(): CollectionBuilder<S, N, Aliases, EdgeAliases> {
    const newAst = this._ast.addDistinct()
    return new CollectionBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
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
    const compiled = this.compileAst(newAst)
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
  // COMPOSITION
  // ===========================================================================

  pipe<NOut extends NodeLabels<S>, BOut extends BaseBuilder<S, NOut>>(
    fragment: QueryFragment<S, N, NOut, CollectionBuilder<S, N, Aliases, EdgeAliases>, BOut>,
  ): BOut {
    return fragment(this)
  }

  // ===========================================================================
  // PROJECTION
  // ===========================================================================

  select<K extends keyof NodeProps<S, N> & string>(..._fields: K[]): CollectionSelector<S, N, K> {
    throw new Error('Select not yet implemented')
  }

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  async execute(): Promise<NodeProps<S, N>[]> {
    if (!this._executor) {
      throw new ExecutionError('Query execution not available: no queryExecutor provided in config')
    }

    const compiled = this.compile()
    const results = await this._executor.run<Record<string, unknown>>(
      compiled.cypher,
      compiled.params,
      this._ast,
    )

    // Transform results - extract node properties and deserialize date fields
    return results.map((record) =>
      extractNodeFromRecord(record, this._schema, this.currentLabel as string) as NodeProps<S, N>,
    )
  }

  async executeWithMeta(): Promise<{
    data: NodeProps<S, N>[]
    meta: { count: number; hasMore: boolean }
  }> {
    const data = await this.execute()
    return {
      data,
      meta: {
        count: data.length,
        hasMore: false, // Would need additional query to determine
      },
    }
  }

  async executeWithCursor(): Promise<{
    data: NodeProps<S, N>[]
    pageInfo: {
      hasNextPage: boolean
      hasPreviousPage: boolean
      startCursor: string | null
      endCursor: string | null
    }
  }> {
    throw new Error('Cursor pagination not yet implemented')
  }

  stream(): AsyncIterable<NodeProps<S, N>> {
    throw new Error('Streaming not yet implemented')
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private compileAst(ast: QueryAST) {
    return getCompiler(this._schema).compile(ast)
  }
}

// ===========================================================================
// SELECTOR INTERFACE
// ===========================================================================

export interface CollectionSelector<
  S extends AnySchema,
  N extends NodeLabels<S>,
  K extends keyof NodeProps<S, N>,
> {
  orderBy(field: K, direction?: 'ASC' | 'DESC'): CollectionSelector<S, N, K>
  limit(count: number): CollectionSelector<S, N, K>
  skip(count: number): CollectionSelector<S, N, K>
  execute(): Promise<Pick<NodeProps<S, N>, K>[]>
  stream(): AsyncIterable<Pick<NodeProps<S, N>, K>>
  compile(): import('../compiler').CompiledQuery
  toCypher(): string
}
