// src/index.ts
// ============================================================
// Public API
// ============================================================

// Main entry point
export { compile } from './compile.js'
export type { CompileResult, CompileOptions } from './compile.js'

// Prelude
export { DEFAULT_PRELUDE } from './prelude.js'
export type { Prelude } from './prelude.js'

// Individual phases
export { lex } from './lexer.js'
export { parse } from './parser/index.js'
export { lower } from './lower/index.js'
export { resolve, createBuiltinScope } from './resolver/index.js'
export { validate } from './validator/index.js'
export type { ValidateOptions } from './validator/index.js'
export { serialize } from './serializer/index.js'

// Types
export type { Token, Span, Trivia, TokenKind, TriviaKind } from './tokens.js'
export type { CstNode, CstChild, SchemaNode } from './cst/index.js'
export type { Schema, Declaration } from './ast/index.js'
export type { SchemaIR, ClassDef, NodeDef, EdgeDef, TypeRef, ValueNode } from './ir/index.js'
export type { ResolvedSchema, Symbol, SymbolKind } from './resolver/index.js'
export { DiagnosticBag, DiagnosticCodes } from './diagnostics.js'
export type { Diagnostic, Severity } from './diagnostics.js'

// AST Visitor infrastructure
export { walkSchema, walkDeclaration, walkAttribute, walkTypeExpr, AstWalker } from './ast/index.js'
export type { AstVisitor } from './ast/index.js'

// Kernel prelude (separate entry — consumer opt-in)
export { KERNEL_PRELUDE } from './kernel-prelude.js'
