// src/lsp/workspace.ts
// ============================================================
// Workspace — Per-Document Compilation Cache
//
// Manages open documents, triggers recompilation on change,
// and exposes the latest compilation artifacts for all
// feature providers (hover, definition, completion, etc.)
// ============================================================

import {
  TextDocument,
  type TextDocumentContentChangeEvent,
} from 'vscode-languageserver-textdocument'
import { type Diagnostic as LspDiagnostic, DiagnosticSeverity } from 'vscode-languageserver-types'
import { fileURLToPath } from 'url'
import { compile, type CompileResult } from '../compile'
import { type DiagnosticBag } from '../diagnostics'
import { LineMap } from '../linemap'
import { type Declaration } from '../ast/index'
import { type Symbol, createBuiltinScope } from '../resolver/index'
import { type Token } from '../tokens'
import { isToken, isNode, type CstNode } from '../cst/index'
import { type Prelude, DEFAULT_PRELUDE } from '../prelude'
import { type SchemaRegistry, EMPTY_REGISTRY } from '../registry'

export interface DocumentState {
  document: TextDocument
  lineMap: LineMap
  result: CompileResult
  /** All tokens in source order, for offset-based lookup. */
  tokenIndex: Token[]
}

export class Workspace {
  private documents = new Map<string, DocumentState>()
  private prelude: Prelude
  private registry: SchemaRegistry
  private builtinScope: Map<string, Symbol> | null = null

  constructor(prelude?: Prelude, registry?: SchemaRegistry) {
    this.prelude = prelude ?? DEFAULT_PRELUDE
    this.registry = registry ?? EMPTY_REGISTRY
  }

  /** Build the scalar-only scope once and cache it. */
  private getBuiltinScope(): Map<string, Symbol> {
    if (this.builtinScope) return this.builtinScope
    this.builtinScope = createBuiltinScope(this.prelude.scalars)
    return this.builtinScope
  }

  /** Compile user source against cached builtin scope + registry. */
  private compileDocument(text: string, sourceUri?: string): CompileResult {
    return compile(text, {
      prelude: this.prelude,
      registry: this.registry,
      baseScope: this.getBuiltinScope(),
      skipSerialization: true,
      sourceUri,
    })
  }

  /** Update or create document state. Returns LSP diagnostics. */
  update(uri: string, text: string, version: number): LspDiagnostic[] {
    const document = TextDocument.create(uri, 'gsl', version, text)
    const lineMap = new LineMap(text)
    const sourceUri = uri.startsWith('file://') ? fileURLToPath(uri) : undefined
    const result = this.compileDocument(text, sourceUri)

    // Build token index from CST
    const tokenIndex: Token[] = []
    if (result.artifacts?.cst) {
      collectTokens(result.artifacts.cst, tokenIndex)
      tokenIndex.sort((a, b) => a.span.start - b.span.start)
    }

    this.documents.set(uri, { document, lineMap, result, tokenIndex })

    return toLspDiagnostics(result.diagnostics, lineMap)
  }

  remove(uri: string): void {
    this.documents.delete(uri)
  }

  /**
   * Apply incremental content changes and return the updated full text.
   * The document is kept in sync so that feature providers can read
   * the latest text even before the debounced recompile fires.
   */
  applyChanges(
    uri: string,
    changes: TextDocumentContentChangeEvent[],
    version: number,
  ): string | null {
    const existing = this.documents.get(uri)
    if (!existing) return null

    let doc = existing.document
    doc = TextDocument.update(doc, changes, version)
    existing.document = doc

    return doc.getText()
  }

  get(uri: string): DocumentState | undefined {
    return this.documents.get(uri)
  }

  /** Find the token at a given byte offset. */
  tokenAt(state: DocumentState, offset: number): Token | null {
    const tokens = state.tokenIndex
    // Binary search
    let low = 0
    let high = tokens.length - 1
    while (low <= high) {
      const mid = (low + high) >> 1
      const t = tokens[mid]
      if (offset < t.span.start) {
        high = mid - 1
      } else if (offset >= t.span.end) {
        low = mid + 1
      } else {
        return t
      }
    }
    return null
  }

  /** Find the symbol at a given byte offset (via reference map). */
  symbolAt(state: DocumentState, offset: number): Symbol | null {
    const token = this.tokenAt(state, offset)
    if (!token) return null
    const resolved = state.result.artifacts?.resolved
    if (!resolved) return null

    // Check reference map (type references resolved during compilation)
    const ref = resolved.references.get(token.span.start)
    if (ref) return ref

    // Check if the token itself is a declaration name
    const sym = resolved.symbols.get(token.text)
    if (sym && sym.span && sym.span.start === token.span.start) return sym

    return null
  }

  /** Find the AST declaration for a given name. */
  declarationFor(state: DocumentState, name: string): Declaration | null {
    const resolved = state.result.artifacts?.resolved
    if (!resolved) return null
    const sym = resolved.symbols.get(name)
    return sym?.declaration ?? null
  }
}

// ─── Helpers ─────────────────────────────────────────────────

function collectTokens(node: CstNode, out: Token[]): void {
  for (const child of node.children) {
    if (isToken(child)) {
      if (child.kind !== 'EOF') {
        out.push(child)
      }
    } else if (isNode(child)) {
      collectTokens(child, out)
    }
  }
}

function toLspDiagnostics(bag: DiagnosticBag, lineMap: LineMap): LspDiagnostic[] {
  const result: LspDiagnostic[] = []
  const all = bag.getAll()

  for (const diag of all) {
    const start = lineMap.positionAt(diag.span.start)
    const end = lineMap.positionAt(diag.span.end)

    result.push({
      range: {
        start: { line: start.line, character: start.col },
        end: { line: end.line, character: Math.max(end.col, start.col + 1) },
      },
      severity:
        diag.severity === 'error'
          ? DiagnosticSeverity.Error
          : diag.severity === 'warning'
            ? DiagnosticSeverity.Warning
            : DiagnosticSeverity.Information,
      code: diag.code,
      source: 'gsl',
      message: diag.message,
    })
  }

  return result
}
