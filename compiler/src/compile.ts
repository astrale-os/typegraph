// src/compile.ts
// ============================================================
// Compile — Full Pipeline
//
// Source → Lex → Parse → Lower → Resolve → Validate → Serialize
//
// This is the main entry point for the compiler. It creates
// a builtin scope from scalars, then compiles user source
// against it. External types are resolved via the SchemaRegistry
// when `extend` declarations are encountered.
// ============================================================

import { lex } from './lexer'
import { parse } from './parser/index'
import { lower } from './lower/index'
import { resolve, createBuiltinScope, type ResolvedSchema } from './resolver/index'
import { validate } from './validator/index'
import { serialize, type SerializeOptions } from './serializer/index'
import { type Prelude, DEFAULT_PRELUDE } from './prelude'
import { type SchemaRegistry, EMPTY_REGISTRY } from './registry'
import type { SchemaIR } from './ir/index'
import { DiagnosticBag } from './diagnostics'
import type { SchemaNode } from './cst/index'
import type { Schema as AstSchema } from './ast/index'

export interface CompileResult {
  /** The IR output. Null if there were errors preventing serialization. */
  ir: SchemaIR | null
  diagnostics: DiagnosticBag
  /** Intermediate artifacts for tooling (LSP, etc.) */
  artifacts: {
    cst: SchemaNode
    ast: AstSchema
    resolved: ResolvedSchema
  } | null
}

export interface CompileOptions extends SerializeOptions {
  /** Prelude to bootstrap against. Defaults to DEFAULT_PRELUDE. */
  prelude?: Prelude
  /** Schema registry for resolving extend declarations. */
  registry?: SchemaRegistry
  /** Pre-built base scope (scalar symbols). For LSP caching. */
  // oxlint-disable-next-line no-explicit-any
  baseScope?: Map<string, any>
  /** Skip IR serialization (used by LSP — only needs artifacts). */
  skipSerialization?: boolean
  /** Absolute path of the source file. Used to resolve relative extend URIs. */
  sourceUri?: string
}

/**
 * Compile a schema source string to IR.
 *
 * Bootstrapping sequence:
 *   1. Inject prelude scalars into empty scope
 *   2. Parse and resolve user source (extend declarations query the registry)
 *   3. Validate
 *   4. Serialize to IR
 */
export function compile(source: string, options?: CompileOptions): CompileResult {
  const diagnostics = new DiagnosticBag()
  const prelude = options?.prelude ?? DEFAULT_PRELUDE
  const registry = options?.registry ?? EMPTY_REGISTRY
  const scope = options?.baseScope ?? createBuiltinScope(prelude.scalars)

  // Compile user source
  const result = compilePhases(source, scope, diagnostics, registry, options?.sourceUri)
  if (!result) {
    return { ir: null, diagnostics, artifacts: null }
  }

  // Validate
  validate(result.resolved, diagnostics, {
    scalars: prelude.scalars,
    defaultFunctions: prelude.defaultFunctions,
  })

  // Serialize (unless skipped or errors)
  const ir =
    options?.skipSerialization || diagnostics.hasErrors()
      ? null
      : serialize(result.resolved, options)

  return {
    ir,
    diagnostics,
    artifacts: {
      cst: result.cst,
      ast: result.ast,
      resolved: result.resolved,
    },
  }
}

/** Run lex → parse → lower → resolve. */
function compilePhases(
  source: string,
  // oxlint-disable-next-line no-explicit-any
  baseScope: Map<string, any>,
  diagnostics: DiagnosticBag,
  registry: SchemaRegistry,
  sourceUri?: string,
) {
  const { tokens } = lex(source, diagnostics)
  const { cst } = parse(tokens, diagnostics)
  const { ast } = lower(cst, diagnostics)
  const { schema: resolved } = resolve(ast, baseScope, diagnostics, registry, sourceUri)

  return { cst, ast, resolved }
}
