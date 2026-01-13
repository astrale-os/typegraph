/**
 * Query Compiler Provider Interface
 *
 * Abstraction layer for query compilation.
 * Allows plugging different query languages (Cypher, Gremlin, SQL, etc.)
 */

import type { QueryAST } from '../ast'
import type { SchemaDefinition } from '../schema'
import type { CompiledQuery, CompilerOptions } from './types'

// =============================================================================
// COMPILER PROVIDER INTERFACE
// =============================================================================

/**
 * Interface for compiling AST to database-specific queries.
 * Implement this to support different query languages.
 */
export interface QueryCompilerProvider {
  /** Unique name for this compiler (e.g., 'cypher', 'gremlin', 'sql') */
  readonly name: string

  /**
   * Compile an AST into a database-specific query.
   *
   * @param ast - The query AST to compile
   * @param schema - The graph schema definition
   * @param options - Compiler options
   * @returns Compiled query with query string and parameters
   */
  compile(ast: QueryAST, schema: SchemaDefinition, options?: CompilerOptions): CompiledQuery
}

/**
 * Factory function type for creating compiler instances.
 */
export type QueryCompilerFactory = (
  schema: SchemaDefinition,
  options?: CompilerOptions,
) => QueryCompilerProvider
