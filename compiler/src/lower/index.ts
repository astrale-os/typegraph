// lower/index.ts
// ============================================================
// Lowering Pass — CST → AST
//
// Transforms the lossless CST into a clean semantic AST:
//   - Strips trivia and punctuation
//   - Splits ClassDeclNode → NodeDecl (node) or EdgeDecl (edge)
//   - Classifies uniform Modifier CST nodes into typed AST variants
//   - Resolves string literal values (strips quotes, unescapes)
//   - Converts number literal text to numbers
// ============================================================

import { type Schema, type Declaration } from '../ast/index'
import { type SchemaNode } from '../cst/index'
import { spanOf } from '../cst/index'
import { DiagnosticBag } from '../diagnostics'
import { lowerDeclaration } from './declarations'

export interface LowerResult {
  ast: Schema
  diagnostics: DiagnosticBag
}

export function lower(cst: SchemaNode, diagnostics?: DiagnosticBag): LowerResult {
  const bag = diagnostics ?? new DiagnosticBag()
  const ctx: LoweringContext = { diagnostics: bag }
  const ast = lowerSchema(ctx, cst)
  return { ast, diagnostics: bag }
}

// ─── Lowering Context ───────────────────────────────────────

export interface LoweringContext {
  readonly diagnostics: DiagnosticBag
}

// --- Schema ---

function lowerSchema(ctx: LoweringContext, cst: SchemaNode): Schema {
  const declarations: Declaration[] = []
  for (const d of cst.declarations) {
    const lowered = lowerDeclaration(ctx, d)
    if (lowered) declarations.push(lowered)
  }
  return {
    declarations,
    span: spanOf(cst),
  }
}
