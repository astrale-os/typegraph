/**
 * Returning Builder
 *
 * Handles queries that return multiple aliased nodes.
 * Created by calling `.returning()` on other builders.
 */

import type { QueryAST } from '../ast'
import type { CompiledQuery } from '../compiler'
import { CypherCompiler } from '../compiler'
import type { AnySchema, NodeLabels, NodeProps } from '../schema'
import type {
  AliasMap,
  AliasMapToReturnType,
  EdgeAliasMap,
  EdgeAliasMapToReturnType,
} from '../schema/inference'
import type { QueryExecutor } from './entry'
import { transformMultiAliasResults } from '../utils'
import { ExecutionError } from '../errors'

/**
 * Type for collect specifications.
 * Maps result alias to source alias configuration.
 */
export type CollectSpec = Record<string, { collect: string; distinct?: boolean }>

/**
 * Infer the return type for collected aliases.
 * Each collected alias becomes an array of the source node type.
 */
export type CollectSpecToReturnType<
  S extends AnySchema,
  Aliases extends AliasMap<S>,
  C extends CollectSpec,
> = {
  [K in keyof C]: C[K] extends { collect: infer Source }
    ? Source extends keyof Aliases
      ? Array<NodeProps<S, Aliases[Source] & NodeLabels<S>>>
      : unknown[]
    : never
}

/**
 * Builder for queries that return multiple nodes and/or edges via aliases.
 *
 * This is created by calling `.returning('alias1', 'alias2', ...)` on any builder
 * after registering aliases with `.as()`.
 *
 * @template S - Schema type
 * @template Aliases - Map of alias names to their node labels
 * @template EdgeAliases - Map of edge alias names to their edge types
 * @template CollectAliases - Map of collect result aliases to their specs
 *
 * @example
 * ```typescript
 * const results = await graph
 *   .node('message').as('msg')
 *   .fork(
 *     q => q.toOptional('REPLY_TO').as('replyTo'),
 *     q => q.from('REACTION').as('reaction'),
 *   )
 *   .returning('msg', 'replyTo', { reactions: { collect: 'reaction' } })
 *   .execute();
 *
 * // Type: Array<{ msg: Message, replyTo: Message | null, reactions: Reaction[] }>
 * ```
 */
export class ReturningBuilder<
  S extends AnySchema,
  Aliases extends AliasMap<S>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
  CollectAliases extends CollectSpec = Record<string, never>,
> {
  private readonly _ast: QueryAST
  private readonly _schema: S
  private readonly _aliases: Aliases
  private readonly _edgeAliases: EdgeAliases
  private readonly _executor: QueryExecutor | null
  private readonly _collectSpecs: CollectAliases

  constructor(
    ast: QueryAST,
    schema: S,
    aliases: Aliases,
    edgeAliases: EdgeAliases = {} as EdgeAliases,
    executor: QueryExecutor | null = null,
    collectSpecs: CollectAliases = {} as CollectAliases,
  ) {
    this._ast = ast
    this._schema = schema
    this._aliases = aliases
    this._edgeAliases = edgeAliases
    this._executor = executor
    this._collectSpecs = collectSpecs
  }

  get ast(): QueryAST {
    return this._ast
  }

  get aliases(): Aliases {
    return this._aliases
  }

  get edgeAliases(): EdgeAliases {
    return this._edgeAliases
  }

  get collectSpecs(): CollectAliases {
    return this._collectSpecs
  }

  /**
   * Add additional node or edge aliases to the return statement.
   * Allows progressive building of return statement.
   */
  andAlso<NewAliases extends string>(
    ..._aliases: NewAliases[]
  ): ReturningBuilder<S, Aliases, EdgeAliases, CollectAliases> {
    throw new Error('Not implemented')
  }

  orderBy<
    A extends keyof Aliases & string,
    K extends keyof NodeProps<S, Aliases[A] & NodeLabels<S>> & string,
  >(
    _alias: A,
    _field: K,
    _direction: 'ASC' | 'DESC' = 'ASC',
  ): ReturningBuilder<S, Aliases, EdgeAliases, CollectAliases> {
    throw new Error('Not implemented')
  }

  limit(_count: number): ReturningBuilder<S, Aliases, EdgeAliases, CollectAliases> {
    throw new Error('Not implemented')
  }

  skip(_count: number): ReturningBuilder<S, Aliases, EdgeAliases, CollectAliases> {
    throw new Error('Not implemented')
  }

  paginate(_options: {
    page: number
    pageSize: number
  }): ReturningBuilder<S, Aliases, EdgeAliases, CollectAliases> {
    throw new Error('Not implemented')
  }

  distinct(): ReturningBuilder<S, Aliases, EdgeAliases, CollectAliases> {
    throw new Error('Not implemented')
  }

  compile(): CompiledQuery {
    const compiler = new CypherCompiler(this._schema)
    return compiler.compile(this._ast)
  }

  toCypher(): string {
    return this.compile().cypher
  }

  toParams(): Record<string, unknown> {
    return this.compile().params
  }

  async execute(): Promise<
    Array<
      AliasMapToReturnType<S, Aliases> &
        EdgeAliasMapToReturnType<S, EdgeAliases> &
        CollectSpecToReturnType<S, Aliases, CollectAliases>
    >
  > {
    if (!this._executor) {
      throw new ExecutionError('Query execution not available: no queryExecutor provided in config')
    }

    const compiled = this.compile()
    const results = await this._executor.run<Record<string, unknown>>(
      compiled.cypher,
      compiled.params,
      this._ast,
    )

    // Get all aliases to return (including collect result aliases)
    const allAliases = [
      ...Object.keys(this._aliases),
      ...Object.keys(this._edgeAliases),
      ...Object.keys(this._collectSpecs),
    ]

    return transformMultiAliasResults(results, allAliases) as Array<
      AliasMapToReturnType<S, Aliases> &
        EdgeAliasMapToReturnType<S, EdgeAliases> &
        CollectSpecToReturnType<S, Aliases, CollectAliases>
    >
  }

  async executeWithMeta(): Promise<{
    data: Array<
      AliasMapToReturnType<S, Aliases> &
        EdgeAliasMapToReturnType<S, EdgeAliases> &
        CollectSpecToReturnType<S, Aliases, CollectAliases>
    >
    meta: {
      count: number
      hasMore: boolean
    }
  }> {
    const data = await this.execute()
    return {
      data,
      meta: {
        count: data.length,
        hasMore: false,
      },
    }
  }

  stream(): AsyncIterable<
    AliasMapToReturnType<S, Aliases> &
      EdgeAliasMapToReturnType<S, EdgeAliases> &
      CollectSpecToReturnType<S, Aliases, CollectAliases>
  > {
    throw new Error('Streaming not yet implemented')
  }

  async count(): Promise<number> {
    const data = await this.execute()
    return data.length
  }
}
