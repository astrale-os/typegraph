// src/compile.ts
// ============================================================
// Compile — Full Pipeline
//
// Source → Lex → Parse → Lower → Resolve → Validate → Serialize
//
// This is the main entry point for the compiler. It handles
// the bootstrapping sequence (prelude scalars → prelude source
// → user code) and produces the IR JSON.
// ============================================================

import { lex } from './lexer'
import { parse } from './parser/index'
import { lower } from './lower/index'
import { resolve, createBuiltinScope, type ResolvedSchema } from './resolver/index'
import { validate } from './validator/index'
import { serialize, type SerializeOptions } from './serializer/index'
import { type Prelude, DEFAULT_PRELUDE } from './prelude'
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
  /** Pre-built base scope (skips prelude parsing). For LSP caching. */
  baseScope?: Map<string, any>
  /** Skip IR serialization (used by LSP — only needs artifacts). */
  skipSerialization?: boolean
}

/**
 * Compile a schema source string to IR.
 *
 * Bootstrapping sequence:
 *   1. Inject prelude scalars into empty scope
 *   2. Parse and resolve prelude source (if any)
 *   3. Parse and resolve user source against that scope
 *   4. Validate
 *   5. Serialize to IR
 */
export function compile(source: string, options?: CompileOptions): CompileResult {
  const diagnostics = new DiagnosticBag()
  const prelude = options?.prelude ?? DEFAULT_PRELUDE

  // Step 0: Resolve base scope
  let scope: Map<string, any>

  if (options?.baseScope) {
    scope = options.baseScope
  } else {
    scope = createBuiltinScope(prelude.scalars)

    // Step 1-2: Bootstrap prelude source (if any)
    if (prelude.source) {
      const preludeResult = compilePhases(prelude.source, scope, diagnostics)
      if (!preludeResult || diagnostics.hasErrors()) {
        return { ir: null, diagnostics, artifacts: null }
      }
      scope = preludeResult.resolved.symbols
    }
  }

  // Step 3-5: Compile user source
  const result = compilePhases(source, scope, diagnostics)
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

/** Run lex → parse → lower → resolve. Returns null on fatal parse errors. */
function compilePhases(source: string, baseScope: Map<string, any>, diagnostics: DiagnosticBag) {
  const { tokens } = lex(source, diagnostics)
  const { cst } = parse(tokens, diagnostics)
  const { ast } = lower(cst, diagnostics)
  const { schema: resolved } = resolve(ast, baseScope, diagnostics)

  return { cst, ast, resolved }
}
