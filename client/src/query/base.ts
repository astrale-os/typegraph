/**
 * Base Query Builder
 *
 * Shared foundation for all builder types.
 */

import { type QueryAST } from './ast'
import { getCompiler, getQueryPipeline } from './compiler'
import type { CompiledQuery } from './compiler'
import type { SchemaShape } from '../schema'
import type { NodeLabels } from '../inference'

// =============================================================================
// QUERY FRAGMENT (For composition/reuse)
// =============================================================================

/**
 * A reusable query fragment that can be applied to a builder.
 *
 * @example
 * ```typescript
 * const activeUsers: QueryFragment<Schema, 'user', 'user', CollectionBuilder, CollectionBuilder> =
 *   (builder) => builder.where('status', 'eq', 'active');
 *
 * graph.node('user').pipe(activeUsers).execute();
 * ```
 */
export type QueryFragment<
  S extends SchemaShape,
  NIn extends NodeLabels<S>,
  NOut extends NodeLabels<S>,
  BIn extends BaseBuilder<S, NIn>,
  BOut extends BaseBuilder<S, NOut>,
> = (builder: BIn) => BOut

// =============================================================================
// BASE BUILDER
// =============================================================================

/**
 * Base class for all query builders.
 * Provides compilation and schema access.
 */
export abstract class BaseBuilder<S extends SchemaShape, N extends NodeLabels<S>> {
  protected readonly _ast: QueryAST
  protected readonly _schema: S

  constructor(ast: QueryAST, schema: S) {
    this._ast = ast
    this._schema = schema
  }

  /** Access the underlying AST (for advanced use cases) */
  get ast(): QueryAST {
    return this._ast
  }

  /** Get the current node label in the query chain */
  protected get currentLabel(): N {
    return this._ast.currentLabel as N
  }

  /** Access the schema */
  protected get schema(): S {
    return this._schema
  }

  /** Run pipeline + compile on the given AST (defaults to this._ast) */
  protected _compile(ast: QueryAST = this._ast): CompiledQuery {
    const pipeline = getQueryPipeline(this._schema)
    const transformedAst = pipeline.run(ast, this._schema)
    return getCompiler(this._schema).compile(transformedAst)
  }

  /** Compile the query to Cypher */
  compile(): CompiledQuery {
    return this._compile()
  }

  /** Get the compiled Cypher string */
  toCypher(): string {
    return this.compile().cypher
  }

  /** Get the compiled parameters */
  toParams(): Record<string, unknown> {
    return this.compile().params
  }

  /** Execute the query (must be implemented by subclasses) */
  abstract execute(): Promise<unknown>
}
