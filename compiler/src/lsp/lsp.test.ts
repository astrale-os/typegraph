// src/lsp/lsp.test.ts
import { describe, it, expect } from 'vitest'
import { LineMap } from '../linemap.js'
import { Workspace } from './workspace.js'
import { provideHover } from './hover.js'
import { provideDefinition } from './definition.js'
import { provideCompletion } from './completion.js'
import { provideDocumentSymbols } from './symbols.js'
import { provideSemanticTokens } from './semantic-tokens.js'
import { KERNEL_PRELUDE } from '../kernel-prelude.js'

// ─── LineMap ─────────────────────────────────────────────────

describe('LineMap', () => {
  const source = 'hello\nworld\nfoo bar'
  const lm = new LineMap(source)

  it('counts lines', () => {
    expect(lm.lineCount).toBe(3)
  })

  it('maps offset to position (line 0)', () => {
    expect(lm.positionAt(0)).toEqual({ line: 0, col: 0 })
    expect(lm.positionAt(4)).toEqual({ line: 0, col: 4 })
  })

  it('maps offset to position (line 1)', () => {
    expect(lm.positionAt(6)).toEqual({ line: 1, col: 0 })
    expect(lm.positionAt(10)).toEqual({ line: 1, col: 4 })
  })

  it('maps offset to position (line 2)', () => {
    expect(lm.positionAt(12)).toEqual({ line: 2, col: 0 })
  })

  it('maps position back to offset', () => {
    expect(lm.offsetAt(0, 0)).toBe(0)
    expect(lm.offsetAt(1, 0)).toBe(6)
    expect(lm.offsetAt(2, 4)).toBe(16)
  })

  it('gets line text', () => {
    expect(lm.lineText(0)).toBe('hello')
    expect(lm.lineText(1)).toBe('world')
    expect(lm.lineText(2)).toBe('foo bar')
  })

  it('handles empty source', () => {
    const empty = new LineMap('')
    expect(empty.lineCount).toBe(1)
    expect(empty.positionAt(0)).toEqual({ line: 0, col: 0 })
  })
})

// ─── Workspace ───────────────────────────────────────────────

const SAMPLE = `
extend "https://kernel.astrale.ai/v1" { Identity }

type Email = String [format: email]

interface Timestamped {
  created_at: Timestamp [readonly] = now(),
  updated_at: Timestamp?
}

class User: Identity, Timestamped {
  username: String [unique],
  email: Email [unique]
}

class follows(follower: User, followee: User) [no_self, unique]
`

describe('Workspace', () => {
  const ws = new Workspace(KERNEL_PRELUDE)
  const uri = 'file:///test/schema.krl'

  it('compiles on update and returns diagnostics', () => {
    const diags = ws.update(uri, SAMPLE, 1)
    // Should compile clean
    expect(diags.filter((d) => d.severity === 1)).toHaveLength(0) // no errors
  })

  it('stores document state', () => {
    const state = ws.get(uri)
    expect(state).toBeDefined()
    expect(state!.tokenIndex.length).toBeGreaterThan(0)
  })

  it('finds tokens at offset', () => {
    const state = ws.get(uri)!
    // "User" should be findable
    const userIdx = SAMPLE.indexOf('class User')
    const token = ws.tokenAt(state, userIdx + 6) // middle of "User"
    expect(token).not.toBeNull()
    expect(token!.text).toBe('User')
  })

  it('finds symbols at offset', () => {
    const state = ws.get(uri)!
    const userIdx = SAMPLE.indexOf('class User')
    const symbol = ws.symbolAt(state, userIdx + 6)
    expect(symbol).not.toBeNull()
    expect(symbol!.name).toBe('User')
    expect(symbol!.symbolKind).toBe('Class')
  })

  it('reports errors on bad source', () => {
    const diags = ws.update('file:///bad.krl', 'class Foo: Unknown {}', 1)
    expect(diags.some((d) => d.severity === 1)).toBe(true) // has errors
  })

  it('cleans up on remove', () => {
    ws.remove('file:///bad.krl')
    expect(ws.get('file:///bad.krl')).toBeUndefined()
  })
})

// ─── Hover ───────────────────────────────────────────────────

describe('Hover', () => {
  const ws = new Workspace(KERNEL_PRELUDE)
  const uri = 'file:///test/hover.krl'
  ws.update(uri, SAMPLE, 1)

  it('provides hover for class name', () => {
    const state = ws.get(uri)!
    const idx = SAMPLE.indexOf('class User')
    const hover = provideHover(ws, state, idx + 6)
    expect(hover).not.toBeNull()
    expect((hover!.contents as any).value).toContain('class User')
  })

  it('provides hover for type reference', () => {
    const state = ws.get(uri)!
    // Find "Email" in attribute position
    const emailAttr = SAMPLE.indexOf('email: Email')
    const hover = provideHover(ws, state, emailAttr + 7) // in "Email"
    expect(hover).not.toBeNull()
    expect((hover!.contents as any).value).toContain('type Email')
  })

  it('provides hover for builtin scalar', () => {
    const state = ws.get(uri)!
    const strIdx = SAMPLE.indexOf('username: String')
    const hover = provideHover(ws, state, strIdx + 10) // in "String"
    expect(hover).not.toBeNull()
    expect((hover!.contents as any).value).toContain('scalar String')
  })

  it('returns null for non-symbol positions', () => {
    const state = ws.get(uri)!
    // Offset 0 is a newline — no token
    const hover = provideHover(ws, state, 0)
    expect(hover).toBeNull()
  })
})

// ─── Go-to-Definition ────────────────────────────────────────

describe('Definition', () => {
  const ws = new Workspace(KERNEL_PRELUDE)
  const uri = 'file:///test/def.krl'
  ws.update(uri, SAMPLE, 1)

  it('navigates to class declaration', () => {
    const state = ws.get(uri)!
    // "User" in "follower: User" → should go to "class User"
    const refIdx = SAMPLE.indexOf('follower: User')
    const loc = provideDefinition(ws, state, refIdx + 10) // in "User" ref
    expect(loc).not.toBeNull()
    // Should point to the declaration
    expect(loc!.uri).toBe(uri)
  })

  it('returns null for builtins', () => {
    const state = ws.get(uri)!
    const strIdx = SAMPLE.indexOf('username: String')
    const loc = provideDefinition(ws, state, strIdx + 10) // "String"
    // Builtins have no source location
    expect(loc).toBeNull()
  })
})

// ─── Completion ──────────────────────────────────────────────

describe('Completion', () => {
  const ws = new Workspace(KERNEL_PRELUDE)
  const uri = 'file:///test/comp.krl'
  ws.update(uri, SAMPLE, 1)

  it('offers type completions after colon', () => {
    const state = ws.get(uri)!
    // After "email: " cursor
    const idx = SAMPLE.indexOf('email: Email') + 7
    const items = provideCompletion(ws, state, idx)
    expect(items.length).toBeGreaterThan(0)
    // Should include both builtins and user types
    expect(items.some((i) => i.label === 'String')).toBe(true)
    expect(items.some((i) => i.label === 'Email')).toBe(true)
  })

  it('offers modifier completions inside brackets', () => {
    const state = ws.get(uri)!
    // Inside [unique, |]
    const idx = SAMPLE.indexOf('[unique') + 1
    const items = provideCompletion(ws, state, idx)
    expect(items.some((i) => i.label === 'unique')).toBe(true)
    expect(items.some((i) => i.label === 'readonly')).toBe(true)
  })

  it('offers declaration keywords at top level', () => {
    const state = ws.get(uri)!
    // End of file
    const items = provideCompletion(ws, state, SAMPLE.length)
    expect(items.some((i) => i.label === 'class')).toBe(true)
    expect(items.some((i) => i.label === 'interface')).toBe(true)
  })
})

// ─── Document Symbols ────────────────────────────────────────

describe('Document Symbols', () => {
  const ws = new Workspace(KERNEL_PRELUDE)
  const uri = 'file:///test/sym.krl'
  ws.update(uri, SAMPLE, 1)

  it('returns symbols for all declarations', () => {
    const state = ws.get(uri)!
    const symbols = provideDocumentSymbols(state)

    const names = symbols.map((s) => s.name)
    expect(names).toContain('Email')
    expect(names).toContain('Timestamped')
    expect(names).toContain('User')
    expect(names).toContain('follows')
  })

  it('nests attributes as children', () => {
    const state = ws.get(uri)!
    const symbols = provideDocumentSymbols(state)
    const user = symbols.find((s) => s.name === 'User')!
    expect(user.children).toBeDefined()
    expect(user.children!.length).toBe(2)
    expect(user.children!.map((c) => c.name)).toContain('username')
    expect(user.children!.map((c) => c.name)).toContain('email')
  })

  it('shows edge details', () => {
    const state = ws.get(uri)!
    const symbols = provideDocumentSymbols(state)
    const follows = symbols.find((s) => s.name === 'follows')!
    expect(follows.detail).toContain('edge')
    expect(follows.detail).toContain('follower')
  })
})

// ─── Semantic Tokens ─────────────────────────────────────────

describe('Semantic Tokens', () => {
  const ws = new Workspace(KERNEL_PRELUDE)
  const uri = 'file:///test/sem.krl'
  ws.update(uri, SAMPLE, 1)

  it('produces non-empty token data', () => {
    const state = ws.get(uri)!
    const data = provideSemanticTokens(state)
    expect(data.length).toBeGreaterThan(0)
    // Data should be multiple of 5 (deltaLine, deltaChar, length, type, modifiers)
    expect(data.length % 5).toBe(0)
  })

  it('classifies tokens correctly', () => {
    const state = ws.get(uri)!
    const data = provideSemanticTokens(state)
    // Should have classified many tokens
    expect(data.length / 5).toBeGreaterThan(10)
  })
})
