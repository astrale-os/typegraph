// src/lexer.ts
// ============================================================
// Lexer — Source String → Token Stream
//
// Single-pass, no lookahead beyond 2 characters.
// Trivia (whitespace, comments) is collected and attached as
// leadingTrivia on the next non-trivia token.
//
// No reserved keywords. Everything that matches [a-zA-Z_][a-zA-Z0-9_]*
// is emitted as Ident. The parser distinguishes keywords contextually.
// ============================================================

import type { Token, TokenKind, Trivia, TriviaKind } from './tokens'
import { DiagnosticBag, DiagnosticCodes } from './diagnostics'

export interface LexResult {
  tokens: Token[]
  diagnostics: DiagnosticBag
}

export function lex(source: string, diagnostics?: DiagnosticBag): LexResult {
  const bag = diagnostics ?? new DiagnosticBag()
  const lexer = new Lexer(source, bag)
  const tokens = lexer.tokenize()
  return { tokens, diagnostics: bag }
}

// ────────────────────────────────────────────────────────────

class Lexer {
  private source: string
  private pos: number = 0
  private diagnostics: DiagnosticBag

  constructor(source: string, diagnostics: DiagnosticBag) {
    this.source = source
    this.diagnostics = diagnostics
  }

  tokenize(): Token[] {
    const tokens: Token[] = []

    while (true) {
      const trivia = this.readTrivia()
      const token = this.readToken()
      token.leadingTrivia = trivia
      tokens.push(token)

      if (token.kind === 'EOF') break
    }

    return tokens
  }

  // --- Trivia ---

  private readTrivia(): Trivia[] {
    const trivia: Trivia[] = []

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]

      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        trivia.push(this.readWhitespace())
      } else if (ch === '-' && this.peek(1) === '-') {
        trivia.push(this.readComment())
      } else {
        break
      }
    }

    return trivia
  }

  private readWhitespace(): Trivia {
    const start = this.pos
    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.pos++
      } else {
        break
      }
    }
    return this.trivia('Whitespace', start)
  }

  private readComment(): Trivia {
    const start = this.pos
    // Skip the --
    this.pos += 2
    while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
      this.pos++
    }
    // Include the newline in the comment trivia if present
    if (this.pos < this.source.length && this.source[this.pos] === '\n') {
      this.pos++
    }
    return this.trivia('Comment', start)
  }

  // --- Tokens ---

  private readToken(): Token {
    if (this.pos >= this.source.length) {
      return this.token('EOF', this.pos, this.pos)
    }

    const start = this.pos
    const ch = this.source[this.pos]

    // Identifiers and contextual keywords
    if (isIdentStart(ch)) {
      return this.readIdent()
    }

    // Numbers
    if (isDigit(ch)) {
      return this.readNumber()
    }

    // Strings
    if (ch === '"') {
      return this.readString()
    }

    // Two-character tokens (check before single-character)
    const next = this.peek(1)

    if (ch === '-' && next === '>') {
      this.pos += 2
      return this.token('Arrow', start, this.pos)
    }

    if (ch === '.' && next === '.') {
      this.pos += 2
      return this.token('DotDot', start, this.pos)
    }

    if (ch === '>' && next === '=') {
      this.pos += 2
      return this.token('GtEq', start, this.pos)
    }

    if (ch === '<' && next === '=') {
      this.pos += 2
      return this.token('LtEq', start, this.pos)
    }

    // Single-character tokens
    this.pos++
    switch (ch) {
      case '(':
        return this.token('LParen', start, this.pos)
      case ')':
        return this.token('RParen', start, this.pos)
      case '{':
        return this.token('LBrace', start, this.pos)
      case '}':
        return this.token('RBrace', start, this.pos)
      case '[':
        return this.token('LBracket', start, this.pos)
      case ']':
        return this.token('RBracket', start, this.pos)
      case '<':
        return this.token('LAngle', start, this.pos)
      case '>':
        return this.token('RAngle', start, this.pos)
      case ':':
        return this.token('Colon', start, this.pos)
      case ',':
        return this.token('Comma', start, this.pos)
      case '=':
        return this.token('Eq', start, this.pos)
      case '|':
        return this.token('Pipe', start, this.pos)
      case '?':
        return this.token('Question', start, this.pos)
      case '*':
        return this.token('Star', start, this.pos)
      default: {
        this.diagnostics.error(
          { start, end: this.pos },
          DiagnosticCodes.L_UNEXPECTED_CHAR,
          `Unexpected character: '${ch}'`,
        )
        // Recovery: skip the character, consume any trivia, and retry.
        // Trivia after the bad character is discarded (not attached to
        // any token's leadingTrivia — the caller will collect fresh
        // trivia for the next real token).
        this.readTrivia()
        return this.readToken()
      }
    }
  }

  private readIdent(): Token {
    const start = this.pos
    while (this.pos < this.source.length && isIdentContinue(this.source[this.pos])) {
      this.pos++
    }
    return this.token('Ident', start, this.pos)
  }

  private readNumber(): Token {
    const start = this.pos
    while (this.pos < this.source.length && isDigit(this.source[this.pos])) {
      this.pos++
    }
    // Decimal part
    if (
      this.pos < this.source.length &&
      this.source[this.pos] === '.' &&
      this.peek(1) !== '.' // Don't consume `.` if it's `..`
    ) {
      this.pos++ // skip the .
      while (this.pos < this.source.length && isDigit(this.source[this.pos])) {
        this.pos++
      }
    }
    return this.token('NumberLit', start, this.pos)
  }

  private readString(): Token {
    const start = this.pos
    this.pos++ // skip opening "

    while (this.pos < this.source.length) {
      const ch = this.source[this.pos]

      if (ch === '\\') {
        // Escape sequence — skip next char
        this.pos += 2
        continue
      }

      if (ch === '"') {
        this.pos++ // skip closing "
        return this.token('StringLit', start, this.pos)
      }

      if (ch === '\n') {
        // Unterminated string at newline
        this.diagnostics.error(
          { start, end: this.pos },
          DiagnosticCodes.L_UNTERMINATED_STRING,
          'Unterminated string literal',
        )
        return this.token('StringLit', start, this.pos)
      }

      this.pos++
    }

    // Unterminated string at EOF
    this.diagnostics.error(
      { start, end: this.pos },
      DiagnosticCodes.L_UNTERMINATED_STRING,
      'Unterminated string literal',
    )
    return this.token('StringLit', start, this.pos)
  }

  // --- Helpers ---

  private peek(offset: number): string | undefined {
    const idx = this.pos + offset
    return idx < this.source.length ? this.source[idx] : undefined
  }

  private token(kind: TokenKind, start: number, end: number): Token {
    return {
      kind,
      text: this.source.slice(start, end),
      span: { start, end },
      leadingTrivia: [],
    }
  }

  private trivia(kind: TriviaKind, start: number): Trivia {
    return {
      kind,
      text: this.source.slice(start, this.pos),
      span: { start, end: this.pos },
    }
  }
}

// --- Character classification ---

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
}

function isIdentContinue(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch)
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}
