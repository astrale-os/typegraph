// src/index.ts
// ============================================================
// Public API
// ============================================================

// Main entry point
export { compile } from './compile'
export type { CompileResult, CompileOptions } from './compile'

// Prelude
export { DEFAULT_PRELUDE } from './prelude'
export type { Prelude } from './prelude'

// Individual phases
export { lex } from './lexer'
export { parse } from './parser/index'
export { lower } from './lower/index'
export { resolve, createBuiltinScope } from './resolver/index'
export { validate } from './validator/index'
export type { ValidateOptions } from './validator/index'
export { serialize } from './serializer/index'

// Types
export type { Token, Span, Trivia, TokenKind, TriviaKind } from './tokens'
export type { CstNode, CstChild, SchemaNode } from './cst/index'
export type { Schema, Declaration } from './ast/index'
export type {
  SchemaIR, ClassDef, NodeDef, EdgeDef,
  IRAttribute, Endpoint, EdgeConstraints, ValueConstraints, AttributeModifiers,
  TypeRef, ValueNode, Cardinality, LifecycleAction,
  Extension, TypeAlias,
} from './ir/index'
export type { ResolvedSchema, Symbol, SymbolKind } from './resolver/index'
export { DiagnosticBag, DiagnosticCodes } from './diagnostics'
export type { Diagnostic, Severity } from './diagnostics'

// AST Visitor infrastructure
export { walkSchema, walkDeclaration, walkAttribute, walkTypeExpr, AstWalker } from './ast/index'
export type { AstVisitor } from './ast/index'

// Kernel prelude (separate entry — consumer opt-in)
export { KERNEL_PRELUDE } from './kernel-prelude'
