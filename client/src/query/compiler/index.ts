/**
 * Query Compiler Module
 *
 * Transforms AST into database-specific query strings.
 */

// Provider interface
export type { QueryCompilerProvider, QueryCompilerFactory } from './provider'

// Cypher compiler (default)
export { CypherCompiler, createCypherCompiler } from './cypher'

// Compiler cache + pipeline
export { getCompiler, getQueryPipeline } from './cache'

// Compilation pipeline
export { CompilationPipeline } from './optimizer'
export type { CompilationPass } from './optimizer'

// Query compilation passes
export { InstanceModelPass, ReifyEdgesPass } from './passes'

// Types
export type { CompiledQuery, CompilerOptions } from './types'
