/**
 * Mutation Compilation Pipeline
 *
 * Applies transformation passes to MutationOps before Cypher compilation.
 * Passes can expand one op into many (1:N) for reification, instance model, etc.
 */

import type { SchemaShape } from '../../schema'
import type { MutationOp } from './types'

/**
 * A single mutation AST transformation pass.
 * Returns one op (1:1) or an array (1:N expansion).
 */
export interface MutationCompilationPass {
  readonly name: string
  transform(op: MutationOp, schema: SchemaShape): MutationOp | MutationOp[]
}

/**
 * Runs a sequence of compilation passes on mutation ops.
 * Each pass flatMaps over the current op array, allowing 1:N expansion.
 */
export class MutationCompilationPipeline {
  private readonly passes: MutationCompilationPass[]

  constructor(passes?: MutationCompilationPass[]) {
    this.passes = passes ?? []
  }

  run(op: MutationOp, schema: SchemaShape): MutationOp[]
  run(ops: MutationOp[], schema: SchemaShape): MutationOp[]
  run(input: MutationOp | MutationOp[], schema: SchemaShape): MutationOp[] {
    let ops = Array.isArray(input) ? input : [input]

    for (const pass of this.passes) {
      ops = ops.flatMap((op) => {
        const result = pass.transform(op, schema)
        return Array.isArray(result) ? result : [result]
      })
    }

    return ops
  }

  addPass(pass: MutationCompilationPass): void {
    this.passes.push(pass)
  }
}
