/**
 * Compiler Cache
 *
 * Module-level caching for CypherCompiler and CompilationPipeline instances.
 * Uses WeakMap for automatic garbage collection when schemas are no longer referenced.
 */

import type { SchemaShape } from '../../schema'
import { CypherCompiler } from './cypher'
import { CompilationPipeline, type CompilationPass } from './optimizer'
import { InstanceModelPass } from './passes/instance-model-pass'
import { ReifyEdgesPass } from './passes/reify-edges-pass'
import type { CompilerOptions } from './types'

/**
 * Cache for compiler instances, keyed by schema reference.
 * WeakMap ensures compilers are GC'd when their schema is no longer used.
 */
const compilerCache = new WeakMap<SchemaShape, CypherCompiler>()

/**
 * Cache for pipeline instances, keyed by schema reference.
 */
const pipelineCache = new WeakMap<SchemaShape, CompilationPipeline>()

/**
 * Get or create a cached CypherCompiler for the given schema.
 *
 * The compiler is safe to reuse because it resets all ephemeral state
 * at the start of each compile() call.
 *
 * @param schema - The schema to get a compiler for
 * @param options - Compiler options (only used on first creation)
 * @returns Cached or newly created compiler instance
 */
export function getCompiler(schema: SchemaShape, options?: CompilerOptions): CypherCompiler {
  let compiler = compilerCache.get(schema)
  if (!compiler) {
    compiler = new CypherCompiler(schema, options)
    compilerCache.set(schema, compiler)
  }
  return compiler
}

/**
 * Get or create a cached CompilationPipeline for the given schema.
 *
 * Includes lowering passes (InstanceModel, ReifyEdges) based on schema config,
 * followed by optimization passes.
 */
export function getQueryPipeline(schema: SchemaShape): CompilationPipeline {
  let pipeline = pipelineCache.get(schema)
  if (!pipeline) {
    const passes: CompilationPass[] = []

    // Lowering passes (order matters: InstanceModel before ReifyEdges)
    if (schema.instanceModel?.enabled) {
      passes.push(new InstanceModelPass(schema.instanceModel))
    }
    if (schema.reifyEdges || Object.values(schema.edges).some((e) => e.reified)) {
      passes.push(new ReifyEdgesPass())
    }

    // Optimization passes would go here (when implemented)

    pipeline = new CompilationPipeline(passes)
    pipelineCache.set(schema, pipeline)
  }
  return pipeline
}

/**
 * Invalidate the cached CompilationPipeline for a schema.
 * Call after extending a schema that may have changed reifyEdges or instanceModel.
 */
export function invalidatePipelineCache(schema: SchemaShape): void {
  pipelineCache.delete(schema)
}

/**
 * Invalidate the cached CypherCompiler for a schema.
 * Call after extending a schema so the compiler reconstructs on next use.
 */
export function invalidateCompilerCache(schema: SchemaShape): void {
  compilerCache.delete(schema)
}
