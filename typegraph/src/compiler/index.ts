/**
 * Compiler Module
 *
 * Transforms AST into database-specific query strings.
 */

// Provider interface
export type { QueryCompilerProvider, QueryCompilerFactory } from './provider'

// Cypher compiler (default)
export { CypherCompiler, createCypherCompiler } from './cypher'

// Compiler cache
export { getCompiler } from './cache'

// Compilation pipeline
export { CompilationPipeline } from './optimizer'
export type { CompilationPass } from './optimizer'

// Types
export type { CompiledQuery, CompilerOptions } from './types'
