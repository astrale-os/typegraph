/**
 * Optional Node Builder
 *
 * Represents a query that resolves to ZERO or ONE node.
 * Used for optional relationships (cardinality: 'optional').
 */

import { BaseBuilder, type QueryFragment } from "./base"
import type { TraversalOptions, WhereBuilder } from "./traits"
import type { QueryAST } from "../ast"
import type { ComparisonOperator, WhereCondition } from "../ast"
import type {
  AnySchema,
  NodeLabels,
  NodeProps,
  OutgoingEdges,
  IncomingEdges,
  EdgeTargetsFrom,
  EdgeSourcesTo,
} from "../schema"
import type {
  AliasMap,
  EdgeAliasMap,
  MultiEdgeTargets,
  MultiEdgeSources,
  MultiEdgeBidirectional,
  EdgeOutboundCardinality,
  EdgeInboundCardinality,
} from "../schema/inference"

// Forward declarations
import type { SingleNodeBuilder } from "./single-node"
import type { CollectionBuilder, ExtractCollectSpecs } from "./collection"
import type { ReturningBuilder } from "./returning"
import type { QueryExecutor } from "./entry"
import { extractNodeFromRecord } from "../utils"
import { ExecutionError } from "../errors"

/**
 * Builder for queries that return zero or one node.
 *
 * @template S - Schema type
 * @template N - Current node label
 * @template Aliases - Map of registered user aliases
 * @template EdgeAliases - Map of registered edge aliases
 */
export class OptionalNodeBuilder<
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

  /**
   * Assign a user-friendly alias to the current node.
   */
  as<A extends string>(
    alias: A,
  ): OptionalNodeBuilder<S, N, Aliases & { [K in A]: N }, EdgeAliases> {
    const newAst = this._ast.addUserAlias(alias)
    return new OptionalNodeBuilder(
      newAst,
      this._schema,
      { ...this._aliases, [alias]: this.currentLabel } as Aliases & { [K in A]: N },
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Specify which aliased nodes and edges to return.
   */
  returning<
    const Args extends Array<string | Record<string, { collect: string; distinct?: boolean }>>,
  >(
    ...aliasesOrSpecs: Args
  ): ReturningBuilder<S, Aliases, EdgeAliases, ExtractCollectSpecs<Args>> {
    const nodeAliases: string[] = []
    const edgeAliases: string[] = []
    let collectSpecs: Record<string, { collect: string; distinct?: boolean }> = {}

    for (const item of aliasesOrSpecs) {
      if (typeof item === "string") {
        if (item in this._aliases) {
          nodeAliases.push(item)
        } else if (item in this._edgeAliases) {
          edgeAliases.push(item)
        }
      } else if (typeof item === "object" && item !== null) {
        collectSpecs = { ...collectSpecs, ...item }
      }
    }

    const collectAliases: Record<string, { sourceAlias: string; distinct?: boolean }> | undefined =
      Object.keys(collectSpecs).length > 0
        ? Object.fromEntries(
            Object.entries(collectSpecs).map(([resultAlias, spec]) => [
              resultAlias,
              { sourceAlias: spec.collect, distinct: spec.distinct },
            ]),
          )
        : undefined

    const newAst = this._ast.setMultiNodeProjection(nodeAliases, edgeAliases, collectAliases)

    const { ReturningBuilder } = require("./returning")
    return new ReturningBuilder(
      newAst,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
      collectSpecs as ExtractCollectSpecs<Args>,
    )
  }

  // ===========================================================================
  // OPTIONAL HANDLING
  // ===========================================================================

  /**
   * Assert that this optional node exists, converting to SingleNodeBuilder.
   * Will throw at runtime if the node doesn't exist.
   */
  required(): SingleNodeBuilder<S, N, Aliases, EdgeAliases> {
    const { SingleNodeBuilder } = require("./single-node")
    return new SingleNodeBuilder(
      this._ast,
      this._schema,
      this._aliases,
      this._edgeAliases,
      this._executor,
    )
  }

  /**
   * Map the optional node to a value, with a default if not present.
   */
  async map<T>(mapper: (node: NodeProps<S, N>) => T, defaultValue: T): Promise<T> {
    const result = await this.execute()
    return result ? mapper(result) : defaultValue
  }

  /**
   * Provide a default value if the node doesn't exist.
   */
  orElse(_defaultValue: NodeProps<S, N>): SingleNodeBuilder<S, N, Aliases, EdgeAliases> {
    throw new Error("Not implemented")
  }

  // ===========================================================================
  // TRAVERSAL
  // ===========================================================================

  /**
   * Traverse an edge in its declared direction (from → to).
   * Returns OptionalNodeBuilder for "one" or "optional" cardinality, CollectionBuilder for "many".
   */
  to<E extends OutgoingEdges<S, N>, EA extends string | undefined = undefined>(
    _edge: E,
    _options?: TraversalOptions<S, E> & { edgeAs?: EA },
  ): EdgeOutboundCardinality<S, E> extends "one"
    ? OptionalNodeBuilder<
        S,
        EdgeTargetsFrom<S, E, N>,
        Aliases,
        EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases
      >
    : EdgeOutboundCardinality<S, E> extends "optional"
      ? OptionalNodeBuilder<
          S,
          EdgeTargetsFrom<S, E, N>,
          Aliases,
          EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases
        >
      : CollectionBuilder<
          S,
          EdgeTargetsFrom<S, E, N>,
          Aliases,
          EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases
        > {
    throw new Error("Not implemented")
  }

  /**
   * Traverse an edge in reverse direction (to → from).
   * Returns OptionalNodeBuilder for "one" or "optional" cardinality, CollectionBuilder for "many".
   */
  from<E extends IncomingEdges<S, N>, EA extends string | undefined = undefined>(
    _edge: E,
    _options?: TraversalOptions<S, E> & { edgeAs?: EA },
  ): EdgeInboundCardinality<S, E> extends "one"
    ? OptionalNodeBuilder<
        S,
        EdgeSourcesTo<S, E, N>,
        Aliases,
        EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases
      >
    : EdgeInboundCardinality<S, E> extends "optional"
      ? OptionalNodeBuilder<
          S,
          EdgeSourcesTo<S, E, N>,
          Aliases,
          EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases
        >
      : CollectionBuilder<
          S,
          EdgeSourcesTo<S, E, N>,
          Aliases,
          EA extends string ? EdgeAliases & { [K in EA]: E } : EdgeAliases
        > {
    throw new Error("Not implemented")
  }

  /**
   * Traverse an edge in both directions.
   */
  via<E extends OutgoingEdges<S, N> & IncomingEdges<S, N>>(
    _edge: E,
    _options?: TraversalOptions<S, E>,
  ): CollectionBuilder<S, EdgeTargetsFrom<S, E, N> | EdgeSourcesTo<S, E, N>, Aliases, EdgeAliases> {
    throw new Error("Not implemented")
  }

  // ===========================================================================
  // MULTI-EDGE TRAVERSAL
  // ===========================================================================

  /**
   * Traverse any of multiple edges in their declared direction.
   */
  toAny<Edges extends readonly OutgoingEdges<S, N>[]>(
    _edges: Edges,
    _options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeTargets<S, N, Edges>, Aliases, EdgeAliases> {
    throw new Error("Not implemented")
  }

  /**
   * Traverse any of multiple edges in reverse direction.
   */
  fromAny<Edges extends readonly IncomingEdges<S, N>[]>(
    _edges: Edges,
    _options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeSources<S, N, Edges>, Aliases, EdgeAliases> {
    throw new Error("Not implemented")
  }

  /**
   * Traverse any of multiple edges in both directions.
   */
  viaAny<Edges extends readonly (OutgoingEdges<S, N> & IncomingEdges<S, N>)[]>(
    _edges: Edges,
    _options?: TraversalOptions<S, Edges[number]>,
  ): CollectionBuilder<S, MultiEdgeBidirectional<S, N, Edges>, Aliases, EdgeAliases> {
    throw new Error("Not implemented")
  }

  // ===========================================================================
  // FILTERING
  // ===========================================================================

  /**
   * Filter by property value.
   */
  where<K extends keyof NodeProps<S, N> & string>(
    _field: K,
    _operator: ComparisonOperator,
    _value?: NodeProps<S, N>[K] | NodeProps<S, N>[K][],
  ): OptionalNodeBuilder<S, N, Aliases, EdgeAliases> {
    throw new Error("Not implemented")
  }

  /**
   * Filter using complex conditions.
   */
  whereComplex(
    _builder: (w: WhereBuilder<S, N>) => WhereCondition,
  ): OptionalNodeBuilder<S, N, Aliases, EdgeAliases> {
    throw new Error("Not implemented")
  }

  // ===========================================================================
  // COMPOSITION
  // ===========================================================================

  /**
   * Apply a reusable query fragment.
   */
  pipe<NOut extends NodeLabels<S>, BOut extends BaseBuilder<S, NOut>>(
    fragment: QueryFragment<S, N, NOut, OptionalNodeBuilder<S, N, Aliases, EdgeAliases>, BOut>,
  ): BOut {
    return fragment(this)
  }

  // ===========================================================================
  // PROJECTION
  // ===========================================================================

  /**
   * Select specific fields to return.
   */
  select<K extends keyof NodeProps<S, N> & string>(..._fields: K[]): OptionalNodeSelector<S, N, K> {
    throw new Error("Not implemented")
  }

  // ===========================================================================
  // EXECUTION
  // ===========================================================================

  async execute(): Promise<NodeProps<S, N> | null> {
    if (!this._executor) {
      throw new ExecutionError("Query execution not available: no queryExecutor provided in config")
    }

    const compiled = this.compile()
    const results = await this._executor.run<Record<string, unknown>>(
      compiled.cypher,
      compiled.params,
      this._ast,
    )

    if (results.length === 0) {
      return null
    }

    return extractNodeFromRecord(results[0]!) as NodeProps<S, N>
  }

  async exists(): Promise<boolean> {
    if (!this._executor) {
      throw new ExecutionError("Query execution not available: no queryExecutor provided in config")
    }

    const compiled = this.compile()
    const results = await this._executor.run<Record<string, unknown>>(
      compiled.cypher,
      compiled.params,
      this._ast,
    )

    return results.length > 0
  }
}

// ===========================================================================
// SELECTOR INTERFACE
// ===========================================================================

export interface OptionalNodeSelector<
  S extends AnySchema,
  N extends NodeLabels<S>,
  K extends keyof NodeProps<S, N>,
> {
  execute(): Promise<Pick<NodeProps<S, N>, K> | null>
  exists(): Promise<boolean>
  compile(): import("../compiler").CompiledQuery
  toCypher(): string
}
