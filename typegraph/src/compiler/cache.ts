/**
 * Compiler Cache
 *
 * Module-level caching for CypherCompiler instances.
 * Uses WeakMap for automatic garbage collection when schemas are no longer referenced.
 */

import type { AnySchema } from '@astrale/typegraph-core'
import { CypherCompiler } from './cypher'
import type { CompilerOptions } from './types'

/**
 * Cache for compiler instances, keyed by schema reference.
 * WeakMap ensures compilers are GC'd when their schema is no longer used.
 */
const compilerCache = new WeakMap<AnySchema, CypherCompiler>()

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
export function getCompiler(schema: AnySchema, options?: CompilerOptions): CypherCompiler {
  let compiler = compilerCache.get(schema)
  if (!compiler) {
    compiler = new CypherCompiler(schema, options)
    compilerCache.set(schema, compiler)
  }
  return compiler
}
