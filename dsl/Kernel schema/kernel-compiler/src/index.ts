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
export { parse } from './parser.js'
export { lower } from './lower.js'
export { resolve, createBuiltinScope } from './resolver.js'
export { validate } from './validator.js'
export type { ValidateOptions } from './validator.js'
export { serialize } from './serializer.js'

// Types
export type { Token, Span, Trivia, TokenKind, TriviaKind } from './tokens.js'
export type { CstNode, CstChild, SchemaNode } from './cst.js'
export type { Schema, Declaration } from './ast.js'
export type { SchemaIR, ClassDef, NodeDef, EdgeDef, TypeRef, ValueNode } from './ir.js'
export type { ResolvedSchema, Symbol, SymbolKind } from './resolver.js'
export { DiagnosticBag, DiagnosticCodes } from './diagnostics.js'
export type { Diagnostic, Severity } from './diagnostics.js'

// Kernel prelude (separate entry — consumer opt-in)
export { KERNEL_PRELUDE } from './kernel-prelude.js'
