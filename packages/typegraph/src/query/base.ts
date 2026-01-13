/**
 * Base Query Builder
 *
 * Shared foundation for all builder types.
 */

import { type QueryAST } from '../ast'
import { CypherCompiler } from '../compiler'
import type { CompiledQuery } from '../compiler'
import type { AnySchema, NodeLabels } from '../schema'

// Re-export shared types from traits
export type {
  EdgeFilterOptions,
  TraversalOptions,
  HierarchyTraversalOptions,
  ReachableOptions,
  WhereBuilder,
  EdgePropertyCondition,
} from './traits'

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
  S extends AnySchema,
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
export abstract class BaseBuilder<S extends AnySchema, N extends NodeLabels<S>> {
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

  /** Compile the query to Cypher */
  compile(): CompiledQuery {
    const compiler = new CypherCompiler(this._schema)
    return compiler.compile(this._ast)
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
