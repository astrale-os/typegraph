// src/tokens.ts
// ============================================================
// The Lexer's Output Contract
//
// The lexer produces a flat stream of tokens. Every byte of the
// source is accounted for — either as a token's text or as
// trivia (whitespace/comments) attached to a token.
//
// Keywords are NOT reserved. The lexer emits them as `Ident`.
// The parser recognizes keywords contextually. This means
// `acyclic`, `cascade`, `format`, etc. are valid identifiers
// in non-keyword positions.
// ============================================================

// --- Span ---

/** Byte offset range in source. 0-indexed. */
export interface Span {
  /** Byte offset of first character. */
  start: number
  /** Byte offset one past last character. */
  end: number
}

/** Trivia: whitespace or comment preceding a token. */
export interface Trivia {
  kind: TriviaKind
  text: string
  span: Span
}

export type TriviaKind = 'Whitespace' | 'Comment'

// --- Token ---

export interface Token {
  kind: TokenKind
  /** Raw source text of the token. */
  text: string
  span: Span
  /** Leading trivia (whitespace/comments before this token). */
  leadingTrivia: Trivia[]
}

/**
 * Token kinds.
 *
 * The lexer does NOT distinguish keywords from identifiers.
 * `class`, `interface`, `type`, `extend`, `true`, `false`, `null`,
 * `edge`, `any` are all emitted as `Ident`. The parser checks
 * the text to recognize them contextually.
 *
 * This keeps the lexer trivial and avoids reserving words that
 * users might want as attribute or parameter names.
 */
export type TokenKind =
  // Atoms
  | 'Ident' // [a-zA-Z_][a-zA-Z0-9_]*
  | 'StringLit' // "..."
  | 'NumberLit' // 123, 0.5

  // Punctuation
  | 'LParen' // (
  | 'RParen' // )
  | 'LBrace' // {
  | 'RBrace' // }
  | 'LBracket' // [
  | 'RBracket' // ]
  | 'LAngle' // <
  | 'RAngle' // >
  | 'Colon' // :
  | 'Comma' // ,
  | 'Eq' // =
  | 'Pipe' // |
  | 'Question' // ?
  | 'Arrow' // ->
  | 'DotDot' // ..
  | 'Star' // *
  | 'GtEq' // >=
  | 'LtEq' // <=

  // Control
  | 'EOF'

// --- Helpers ---

/** Check if a token's text matches a contextual keyword. */
export function isKeyword(token: Token, keyword: string): boolean {
  return token.kind === 'Ident' && token.text === keyword
}

/** The set of contextual keywords the parser recognizes. */
export const CONTEXTUAL_KEYWORDS = [
  // Declaration keywords
  'type',
  'interface',
  'class',
  'extend',
  'fn',
  // Literals
  'true',
  'false',
  'null',
  // Type expressions
  'edge',
  'any',
  // Flag modifiers
  'no_self',
  'acyclic',
  'unique',
  'symmetric',
  'readonly',
  'indexed',
  // KV modifier keys
  'format',
  'match',
  'in',
  'length',
  // Lifecycle
  'on_kill_source',
  'on_kill_target',
  'cascade',
  'unlink',
  'prevent',
  // Sort direction
  'asc',
  'desc',
] as const
