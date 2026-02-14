// parser/index.ts
// ============================================================
// Parser — Token Stream → Lossless CST
//
// Hand-rolled recursive descent. One token of lookahead.
// Produces a lossless CST: every token (including punctuation)
// is a child of some CST node.
//
// Error recovery uses panic mode: on unexpected tokens, skip
// forward to a synchronization point (declaration keywords,
// closing braces/brackets) and continue parsing.
// ============================================================

import { type Token, type TokenKind, isKeyword } from '../tokens'
import { type CstChild, type SchemaNode, type DeclarationNode } from '../cst/index'
import { DiagnosticBag, DiagnosticCodes } from '../diagnostics'
import { parseDeclaration } from './declarations'

export interface ParseResult {
  cst: SchemaNode
  diagnostics: DiagnosticBag
}

export function parse(tokens: Token[], diagnostics?: DiagnosticBag): ParseResult {
  const bag = diagnostics ?? new DiagnosticBag()
  const parser = new Parser(tokens, bag)
  const cst = parser.parseSchema()
  return { cst, diagnostics: bag }
}

// --- Sync tokens for error recovery ---

const DECL_KEYWORDS = ['class', 'interface', 'type', 'extend']

export function isDeclStart(token: Token): boolean {
  return token.kind === 'Ident' && DECL_KEYWORDS.includes(token.text)
}

// ─── Parser Context ─────────────────────────────────────────
// Shared interface so sub-modules can operate on the parser
// without circular class references.

export interface ParserContext {
  current(): Token
  peek(offset?: number): Token
  advance(): Token
  at(kind: TokenKind): boolean
  atKeyword(keyword: string): boolean
  expect(kind: TokenKind): Token
  expectKeyword(keyword: string): Token
  expectIdent(): Token
  skipToSync(): Token[]
  readonly diagnostics: DiagnosticBag
}

// ────────────────────────────────────────────────────────────

export class Parser implements ParserContext {
  private tokens: Token[]
  private pos: number = 0
  readonly diagnostics: DiagnosticBag

  constructor(tokens: Token[], diagnostics: DiagnosticBag) {
    this.tokens = tokens
    this.diagnostics = diagnostics
  }

  // --- Token access ---

  current(): Token {
    return this.tokens[this.pos]
  }

  peek(offset: number = 0): Token {
    const idx = this.pos + offset
    return idx < this.tokens.length ? this.tokens[idx] : this.tokens[this.tokens.length - 1] // EOF
  }

  advance(): Token {
    const token = this.current()
    if (token.kind !== 'EOF') {
      this.pos++
    }
    return token
  }

  at(kind: TokenKind): boolean {
    return this.current().kind === kind
  }

  atKeyword(keyword: string): boolean {
    return isKeyword(this.current(), keyword)
  }

  /** Consume a token of the expected kind, or report error and return a synthetic token. */
  expect(kind: TokenKind): Token {
    if (this.at(kind)) {
      return this.advance()
    }
    const cur = this.current()
    this.diagnostics.error(
      cur.span,
      DiagnosticCodes.P_EXPECTED_TOKEN,
      `Expected ${kind}, got ${cur.kind}${cur.kind === 'Ident' ? ` '${cur.text}'` : ''}`,
    )
    // Return a synthetic zero-width token at current position
    return {
      kind,
      text: '',
      span: { start: cur.span.start, end: cur.span.start },
      leadingTrivia: [],
    }
  }

  /** Consume an Ident with specific text, or report error. */
  expectKeyword(keyword: string): Token {
    if (this.atKeyword(keyword)) {
      return this.advance()
    }
    const cur = this.current()
    this.diagnostics.error(
      cur.span,
      DiagnosticCodes.P_EXPECTED_TOKEN,
      `Expected '${keyword}', got ${cur.kind}${cur.kind === 'Ident' ? ` '${cur.text}'` : ''}`,
    )
    return {
      kind: 'Ident',
      text: keyword,
      span: { start: cur.span.start, end: cur.span.start },
      leadingTrivia: [],
    }
  }

  expectIdent(): Token {
    if (this.at('Ident')) {
      return this.advance()
    }
    const cur = this.current()
    this.diagnostics.error(
      cur.span,
      DiagnosticCodes.P_EXPECTED_TOKEN,
      `Expected identifier, got ${cur.kind}`,
    )
    return {
      kind: 'Ident',
      text: '<missing>',
      span: { start: cur.span.start, end: cur.span.start },
      leadingTrivia: [],
    }
  }

  // --- Error recovery ---

  /**
   * Panic mode: skip tokens until we hit a synchronization point.
   * Returns the skipped tokens (so they can be added to children
   * for lossless representation).
   */
  skipToSync(): Token[] {
    const skipped: Token[] = []
    while (!this.at('EOF')) {
      if (isDeclStart(this.current())) break
      if (this.at('RBrace') || this.at('RBracket') || this.at('RParen')) break
      skipped.push(this.advance())
    }
    return skipped
  }

  // --- Schema (top-level) ---

  parseSchema(): SchemaNode {
    const children: CstChild[] = []
    const declarations: DeclarationNode[] = []

    while (!this.at('EOF')) {
      const decl = parseDeclaration(this)
      if (decl) {
        declarations.push(decl)
        children.push(decl)
      } else {
        // Recovery: skip to next declaration start
        const skipped = this.skipToSync()
        if (skipped.length === 0 && !this.at('EOF')) {
          // skipToSync stopped at a stray closing delimiter (], }, ))
          // at the top level — force-skip it to avoid an infinite loop.
          children.push(this.advance())
        } else {
          children.push(...skipped)
        }
      }
    }

    const eof = this.advance() // EOF token
    children.push(eof)

    return {
      kind: 'Schema',
      children,
      declarations,
      eof,
    }
  }
}
