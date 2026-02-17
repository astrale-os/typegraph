/**
 * Compilation Pipeline
 *
 * Applies transformation passes to the AST before compilation.
 * Passes include lowering (e.g. edge reification), optimization, and rewrites.
 */

import { type QueryAST } from '../ast'
import type { SchemaShape } from '../../schema'

/**
 * A single AST transformation pass.
 * Covers lowering, optimization, and rewriting.
 */
export interface CompilationPass {
  name: string
  transform(ast: QueryAST, schema: SchemaShape): QueryAST
}

/**
 * Runs a sequence of compilation passes on the AST.
 */
export class CompilationPipeline {
  private readonly passes: CompilationPass[]

  constructor(passes?: CompilationPass[]) {
    this.passes = passes ?? [
      new MergeWhereClausesPass(),
      new PushDownFiltersPass(),
      new EliminateRedundantDistinctPass(),
      new ReorderMatchesPass(),
    ]
  }

  run(ast: QueryAST, schema: SchemaShape): QueryAST {
    let result = ast
    for (const pass of this.passes) {
      result = pass.transform(result, schema)
    }
    return result
  }

  addPass(pass: CompilationPass): void {
    this.passes.push(pass)
  }
}

/**
 * Merge consecutive WHERE clauses into one.
 *
 * Before: MATCH (n) WHERE n.a = 1 WHERE n.b = 2
 * After:  MATCH (n) WHERE n.a = 1 AND n.b = 2
 */
class MergeWhereClausesPass implements CompilationPass {
  name = 'MergeWhereClauses'

  transform(_ast: QueryAST, _schema: SchemaShape): QueryAST {
    throw new Error('Not implemented')
  }
}

/**
 * Push filters as close to the MATCH as possible.
 *
 * This reduces the number of intermediate results.
 */
class PushDownFiltersPass implements CompilationPass {
  name = 'PushDownFilters'

  transform(_ast: QueryAST, _schema: SchemaShape): QueryAST {
    throw new Error('Not implemented')
  }
}

/**
 * Remove DISTINCT when it's not needed.
 *
 * For example, when selecting by unique ID.
 */
class EliminateRedundantDistinctPass implements CompilationPass {
  name = 'EliminateRedundantDistinct'

  transform(_ast: QueryAST, _schema: SchemaShape): QueryAST {
    throw new Error('Not implemented')
  }
}

/**
 * Reorder MATCH clauses for optimal execution.
 *
 * Put the most selective matches first.
 */
class ReorderMatchesPass implements CompilationPass {
  name = 'ReorderMatches'

  transform(_ast: QueryAST, _schema: SchemaShape): QueryAST {
    throw new Error('Not implemented')
  }
}
