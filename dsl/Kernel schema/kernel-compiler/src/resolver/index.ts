// resolver/index.ts
// ============================================================
// Resolver — AST → Resolved Schema
//
// Builds a symbol table from declarations, resolves all type
// name references to their definitions, and reports unknown
// types and duplicate names.
//
// Bootstrapping:
//   1. Prelude scalars are injected first (String, Int, etc.)
//   2. The prelude source is parsed and resolved against scalars
//   3. User schemas are resolved against prelude + scalars
// ============================================================

export type { ResolvedSchema, ResolveResult, Symbol, SymbolKind } from './scope.js'
export { resolve, createBuiltinScope } from './scope.js'
