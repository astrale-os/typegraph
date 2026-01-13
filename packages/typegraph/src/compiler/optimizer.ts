/**
 * Query Optimizer
 *
 * Applies optimization passes to the AST before compilation.
 */

import { type QueryAST } from '../ast'
import type { SchemaDefinition } from '../schema'

/**
 * Optimization pass interface.
 */
export interface OptimizationPass {
  name: string
  transform(ast: QueryAST, schema: SchemaDefinition): QueryAST
}

/**
 * Query optimizer that applies multiple passes.
 */
export class QueryOptimizer {
  private readonly passes: OptimizationPass[]

  constructor(passes?: OptimizationPass[]) {
    this.passes = passes ?? [
      new MergeWhereClausesPass(),
      new PushDownFiltersPass(),
      new EliminateRedundantDistinctPass(),
      new ReorderMatchesPass(),
    ]
  }

  optimize(ast: QueryAST, schema: SchemaDefinition): QueryAST {
    let result = ast
    for (const pass of this.passes) {
      result = pass.transform(result, schema)
    }
    return result
  }

  addPass(pass: OptimizationPass): void {
    this.passes.push(pass)
  }
}

/**
 * Merge consecutive WHERE clauses into one.
 *
 * Before: MATCH (n) WHERE n.a = 1 WHERE n.b = 2
 * After:  MATCH (n) WHERE n.a = 1 AND n.b = 2
 */
class MergeWhereClausesPass implements OptimizationPass {
  name = 'MergeWhereClauses'

  transform(_ast: QueryAST, _schema: SchemaDefinition): QueryAST {
    throw new Error('Not implemented')
  }
}

/**
 * Push filters as close to the MATCH as possible.
 *
 * This reduces the number of intermediate results.
 */
class PushDownFiltersPass implements OptimizationPass {
  name = 'PushDownFilters'

  transform(_ast: QueryAST, _schema: SchemaDefinition): QueryAST {
    throw new Error('Not implemented')
  }
}

/**
 * Remove DISTINCT when it's not needed.
 *
 * For example, when selecting by unique ID.
 */
class EliminateRedundantDistinctPass implements OptimizationPass {
  name = 'EliminateRedundantDistinct'

  transform(_ast: QueryAST, _schema: SchemaDefinition): QueryAST {
    throw new Error('Not implemented')
  }
}

/**
 * Reorder MATCH clauses for optimal execution.
 *
 * Put the most selective matches first.
 */
class ReorderMatchesPass implements OptimizationPass {
  name = 'ReorderMatches'

  transform(_ast: QueryAST, _schema: SchemaDefinition): QueryAST {
    throw new Error('Not implemented')
  }
}
