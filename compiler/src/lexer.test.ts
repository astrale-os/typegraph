import { readFileSync } from 'fs'
import { resolve as pathResolve, dirname } from 'path'
import { fileURLToPath } from 'url'
// src/lexer.test.ts
import { describe, it, expect } from 'vitest'

import { lex } from './lexer'

const KERNEL_SCHEMA_SOURCE = readFileSync(
  pathResolve(dirname(fileURLToPath(import.meta.url)), '..', 'kernel.gsl'),
  'utf-8',
)

/** Helper: lex and return just the non-EOF token kinds + text pairs. */
function tokens(source: string): [string, string][] {
  const { tokens } = lex(source)
  return tokens.filter((t) => t.kind !== 'EOF').map((t) => [t.kind, t.text])
}

/** Helper: lex and return non-EOF token kinds only. */
function kinds(source: string): string[] {
  return tokens(source).map(([k]) => k)
}

describe('Lexer', () => {
  // --- Basic tokens ---

  it('lexes identifiers', () => {
    expect(tokens('foo bar_baz _x A1')).toEqual([
      ['Ident', 'foo'],
      ['Ident', 'bar_baz'],
      ['Ident', '_x'],
      ['Ident', 'A1'],
    ])
  })

  it('lexes contextual keywords as Ident', () => {
    expect(tokens('class interface type extend')).toEqual([
      ['Ident', 'class'],
      ['Ident', 'interface'],
      ['Ident', 'type'],
      ['Ident', 'extend'],
    ])
  })

  it('lexes integer literals', () => {
    expect(tokens('0 42 1000')).toEqual([
      ['NumberLit', '0'],
      ['NumberLit', '42'],
      ['NumberLit', '1000'],
    ])
  })

  it('lexes decimal literals', () => {
    expect(tokens('3.14 0.5')).toEqual([
      ['NumberLit', '3.14'],
      ['NumberLit', '0.5'],
    ])
  })

  it('lexes string literals', () => {
    expect(tokens('"hello" "world"')).toEqual([
      ['StringLit', '"hello"'],
      ['StringLit', '"world"'],
    ])
  })

  it('lexes strings with escape sequences', () => {
    expect(tokens('"say \\"hi\\""')).toEqual([['StringLit', '"say \\"hi\\""']])
  })

  it('lexes all punctuation', () => {
    expect(tokens('( ) { } [ ] < > : , = | ? *')).toEqual([
      ['LParen', '('],
      ['RParen', ')'],
      ['LBrace', '{'],
      ['RBrace', '}'],
      ['LBracket', '['],
      ['RBracket', ']'],
      ['LAngle', '<'],
      ['RAngle', '>'],
      ['Colon', ':'],
      ['Comma', ','],
      ['Eq', '='],
      ['Pipe', '|'],
      ['Question', '?'],
      ['Star', '*'],
    ])
  })

  it('lexes multi-character operators', () => {
    expect(tokens('-> .. >= <=')).toEqual([
      ['Arrow', '->'],
      ['DotDot', '..'],
      ['GtEq', '>='],
      ['LtEq', '<='],
    ])
  })

  // --- DotDot vs decimal ambiguity ---

  it('distinguishes N..M from decimal', () => {
    // 0..1 should be NumberLit(0) DotDot NumberLit(1)
    expect(tokens('0..1')).toEqual([
      ['NumberLit', '0'],
      ['DotDot', '..'],
      ['NumberLit', '1'],
    ])
  })

  it('distinguishes 0..* from decimal', () => {
    expect(tokens('0..*')).toEqual([
      ['NumberLit', '0'],
      ['DotDot', '..'],
      ['Star', '*'],
    ])
  })

  it('lexes decimal followed by dotdot', () => {
    // 3.14 is a decimal; 1..2 is range
    expect(tokens('3.14 1..2')).toEqual([
      ['NumberLit', '3.14'],
      ['NumberLit', '1'],
      ['DotDot', '..'],
      ['NumberLit', '2'],
    ])
  })

  // --- Trivia ---

  it('attaches whitespace as leading trivia', () => {
    const { tokens: toks } = lex('  foo')
    const foo = toks[0]
    expect(foo.kind).toBe('Ident')
    expect(foo.leadingTrivia).toHaveLength(1)
    expect(foo.leadingTrivia[0].kind).toBe('Whitespace')
    expect(foo.leadingTrivia[0].text).toBe('  ')
  })

  it('attaches comments as leading trivia', () => {
    const { tokens: toks } = lex('-- this is a comment\nfoo')
    const foo = toks[0]
    expect(foo.kind).toBe('Ident')
    expect(foo.leadingTrivia).toHaveLength(1)
    expect(foo.leadingTrivia[0].kind).toBe('Comment')
    expect(foo.leadingTrivia[0].text).toBe('-- this is a comment\n')
  })

  it('attaches multiple trivia items', () => {
    const { tokens: toks } = lex('  -- comment\n  foo')
    const foo = toks[0]
    expect(foo.leadingTrivia).toHaveLength(3) // ws, comment, ws
    expect(foo.leadingTrivia[0].kind).toBe('Whitespace')
    expect(foo.leadingTrivia[1].kind).toBe('Comment')
    expect(foo.leadingTrivia[2].kind).toBe('Whitespace')
  })

  it('attaches trailing trivia to EOF', () => {
    const { tokens: toks } = lex('foo  -- trailing\n  ')
    const eof = toks[toks.length - 1]
    expect(eof.kind).toBe('EOF')
    expect(eof.leadingTrivia.length).toBeGreaterThan(0)
  })

  // --- Spans ---

  it('tracks byte offsets correctly', () => {
    const { tokens: toks } = lex('class User')
    // "class" starts at 0, ends at 5
    expect(toks[0].span).toEqual({ start: 0, end: 5 })
    // "User" starts at 6, ends at 10
    expect(toks[1].span).toEqual({ start: 6, end: 10 })
  })

  // --- Edge cases ---

  it('lexes empty source', () => {
    const { tokens: toks } = lex('')
    expect(toks).toHaveLength(1)
    expect(toks[0].kind).toBe('EOF')
  })

  it('lexes only whitespace and comments', () => {
    const { tokens: toks } = lex('  -- just a comment\n  ')
    expect(toks).toHaveLength(1)
    expect(toks[0].kind).toBe('EOF')
    expect(toks[0].leadingTrivia.length).toBeGreaterThan(0)
  })

  // --- Error recovery ---

  it('reports and skips unexpected characters', () => {
    const { tokens: toks, diagnostics } = lex('foo @ bar')
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('@')
    // Recovery: still produces foo and bar tokens
    const nonEof = toks.filter((t) => t.kind !== 'EOF')
    expect(nonEof.map((t) => t.text)).toEqual(['foo', 'bar'])
  })

  it('reports unterminated string at newline', () => {
    const { diagnostics } = lex('"hello\nworld"')
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors()[0].code).toBe('L002')
  })

  it('reports unterminated string at EOF', () => {
    const { diagnostics } = lex('"hello')
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors()[0].code).toBe('L002')
  })

  // --- Realistic fragments ---

  it('lexes a class declaration', () => {
    expect(kinds('class User: Identity { username: String [unique] }')).toEqual([
      'Ident', // class
      'Ident', // User
      'Colon',
      'Ident', // Identity
      'LBrace',
      'Ident', // username
      'Colon',
      'Ident', // String
      'LBracket',
      'Ident', // unique
      'RBracket',
      'RBrace',
    ])
  })

  it('lexes an edge declaration', () => {
    expect(
      kinds('class follows(follower: User, followee: User) [no_self, follower -> 0..5000]'),
    ).toEqual([
      'Ident', // class
      'Ident', // follows
      'LParen',
      'Ident', // follower
      'Colon',
      'Ident', // User
      'Comma',
      'Ident', // followee
      'Colon',
      'Ident', // User
      'RParen',
      'LBracket',
      'Ident', // no_self
      'Comma',
      'Ident', // follower
      'Arrow', // ->
      'NumberLit', // 0
      'DotDot', // ..
      'NumberLit', // 5000
      'RBracket',
    ])
  })

  it('lexes a type alias', () => {
    expect(kinds('type Email = String [format: email]')).toEqual([
      'Ident', // type
      'Ident', // Email
      'Eq',
      'Ident', // String
      'LBracket',
      'Ident', // format
      'Colon',
      'Ident', // email
      'RBracket',
    ])
  })

  it('lexes an extend declaration', () => {
    expect(kinds('extend "https://kernel.astrale.ai/v1" { Identity }')).toEqual([
      'Ident', // extend
      'StringLit', // "https://..."
      'LBrace',
      'Ident', // Identity
      'RBrace',
    ])
  })

  it('lexes edge<any>', () => {
    expect(kinds('edge<any>')).toEqual([
      'Ident', // edge
      'LAngle',
      'Ident', // any
      'RAngle',
    ])
  })

  it('lexes a default value with function call', () => {
    expect(kinds('created_at: Timestamp = now()')).toEqual([
      'Ident', // created_at
      'Colon',
      'Ident', // Timestamp
      'Eq',
      'Ident', // now
      'LParen',
      'RParen',
    ])
  })

  it('lexes nullable union type', () => {
    expect(kinds('Post | Comment?')).toEqual([
      'Ident', // Post
      'Pipe',
      'Ident', // Comment
      'Question',
    ])
  })

  it('lexes in modifier with string list', () => {
    expect(kinds('in: ["free", "pro"]')).toEqual([
      'Ident', // in
      'Colon',
      'LBracket',
      'StringLit', // "free"
      'Comma',
      'StringLit', // "pro"
      'RBracket',
    ])
  })

  it('lexes lifecycle modifier', () => {
    expect(kinds('on_kill_target: cascade')).toEqual([
      'Ident', // on_kill_target
      'Colon',
      'Ident', // cascade
    ])
  })

  it('lexes >= and <= range modifiers', () => {
    expect(kinds('>= 0, <= 100')).toEqual(['GtEq', 'NumberLit', 'Comma', 'LtEq', 'NumberLit'])
  })

  // --- The kernel prelude ---

  it('lexes the entire kernel prelude without errors', () => {
    const { tokens: toks, diagnostics } = lex(KERNEL_SCHEMA_SOURCE)
    expect(diagnostics.hasErrors()).toBe(false)
    // Should end with EOF
    expect(toks[toks.length - 1].kind).toBe('EOF')
    // Should have a reasonable number of tokens
    expect(toks.length).toBeGreaterThan(50)
  })
})
