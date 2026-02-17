/**
 * Typed Returning Builder
 *
 * A wrapper that provides properly typed execute() for .return() queries.
 * Uses composition instead of mutation - wraps a ReturningBuilder and transforms results.
 */

import type { CompiledQuery } from './compiler'
import type { ReturnSpec } from './proxy'
import { transformReturnResult } from './proxy'
import type { ReturningBuilder, CollectSpec } from './returning'
import type { SchemaShape } from '../schema'
import type { AliasMap, EdgeAliasMap, TypedReturnQuery } from '../inference'
import { ExecutionError } from '../errors'
import type { QueryExecutor } from './types'
import { deserializeDateFields } from '../utils'

/**
 * A query builder with a typed execute() method.
 *
 * Created by .return() - wraps the underlying query and transforms results
 * according to the return specification.
 *
 * Implements TypedReturnQuery<T> interface for clean API contracts.
 *
 * @template T - The inferred return type from the .return() callback
 *
 * @example
 * ```typescript
 * const query = graph.node('user').as('u')
 *   .return(q => ({ name: q.u.name, email: q.u.email }))
 *
 * // query is TypedReturningBuilder<{ name: string, email: string }>
 * const results = await query.execute()
 * // results is Array<{ name: string, email: string }>
 * ```
 */
export class TypedReturningBuilder<T> implements TypedReturnQuery<T> {
  private readonly _innerBuilder: ReturningBuilder<
    SchemaShape,
    AliasMap<SchemaShape>,
    EdgeAliasMap<SchemaShape>,
    CollectSpec
  >
  private readonly _returnSpec: ReturnSpec
  private readonly _returnResult: Record<string, unknown>
  private readonly _executor: QueryExecutor | null

  constructor(
    innerBuilder: ReturningBuilder<
      SchemaShape,
      AliasMap<SchemaShape>,
      EdgeAliasMap<SchemaShape>,
      CollectSpec
    >,
    returnSpec: ReturnSpec,
    returnResult: Record<string, unknown>,
    executor: QueryExecutor | null,
  ) {
    this._innerBuilder = innerBuilder
    this._returnSpec = returnSpec
    this._returnResult = returnResult
    this._executor = executor
  }

  /**
   * Execute the query and return typed results.
   *
   * @returns Array of results matching the .return() callback shape
   */
  async execute(): Promise<Array<T>> {
    if (!this._executor) {
      throw new ExecutionError('Query execution not available: no queryExecutor provided in config')
    }

    const compiled = this.compile()
    const rawResults = await this._executor.run<Record<string, unknown>>(
      compiled.cypher,
      compiled.params,
      // AST is internal to the inner builder
      (this._innerBuilder as any)._ast,
    )

    const schema = this._innerBuilder.schema
    const aliases = this._innerBuilder.aliases

    return rawResults.map((row) => {
      const result = transformReturnResult(row, this._returnSpec, this._returnResult)

      // Deserialize date fields in full node references
      for (const [outputKey, field] of this._returnSpec.nodeFields) {
        const label = aliases[field.alias]
        if (label && typeof result[outputKey] === 'object' && result[outputKey] !== null) {
          result[outputKey] = deserializeDateFields(
            schema,
            label as string,
            result[outputKey] as Record<string, unknown>,
          )
        }
      }

      // Per-property date deserialization deferred to codegen validators

      // Deserialize collected arrays of nodes
      for (const [outputKey, field] of this._returnSpec.collectFields) {
        const label = aliases[field.alias]
        if (label && Array.isArray(result[outputKey])) {
          result[outputKey] = (result[outputKey] as Record<string, unknown>[]).map((item) =>
            deserializeDateFields(schema, label as string, item),
          )
        }
      }

      return result as T
    })
  }

  /**
   * Compile the query to Cypher without executing.
   */
  compile(): CompiledQuery {
    return this._innerBuilder.compile()
  }

  /**
   * Get the Cypher query string without parameters.
   */
  toCypher(): string {
    return this._innerBuilder.toCypher()
  }
}
