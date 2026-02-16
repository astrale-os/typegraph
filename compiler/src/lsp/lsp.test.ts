// src/lsp/lsp.test.ts
import { describe, it, expect } from 'vitest'
import { LineMap } from '../linemap'
import { Workspace } from './workspace'
import { provideHover } from './hover'
import { provideDefinition } from './definition'
import { provideCompletion } from './completion'
import { provideDocumentSymbols } from './symbols'
import { provideSemanticTokens, SEMANTIC_TOKEN_TYPES } from './semantic-tokens'
import { KERNEL_PRELUDE } from '../prelude'
import { buildKernelRegistry } from '../kernel-prelude'
import { SymbolKind } from 'vscode-languageserver-types'

const kernelRegistry = buildKernelRegistry()

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
  const ws = new Workspace(KERNEL_PRELUDE, kernelRegistry)
  const uri = 'file:///test/schema.gsl'

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
    const diags = ws.update('file:///bad.gsl', 'class Foo: Unknown {}', 1)
    expect(diags.some((d) => d.severity === 1)).toBe(true) // has errors
  })

  it('cleans up on remove', () => {
    ws.remove('file:///bad.gsl')
    expect(ws.get('file:///bad.gsl')).toBeUndefined()
  })
})

// ─── Hover ───────────────────────────────────────────────────

describe('Hover', () => {
  const ws = new Workspace(KERNEL_PRELUDE, kernelRegistry)
  const uri = 'file:///test/hover.gsl'
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
  const ws = new Workspace(KERNEL_PRELUDE, kernelRegistry)
  const uri = 'file:///test/def.gsl'
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
  const ws = new Workspace(KERNEL_PRELUDE, kernelRegistry)
  const uri = 'file:///test/comp.gsl'
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
  const ws = new Workspace(KERNEL_PRELUDE, kernelRegistry)
  const uri = 'file:///test/sym.gsl'
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
  const ws = new Workspace(KERNEL_PRELUDE, kernelRegistry)
  const uri = 'file:///test/sem.gsl'
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

// ─── Method-Aware LSP Tests ─────────────────────────────────

const METHODS_SAMPLE = `
interface Auditable {
  fn audit(reason: String): Boolean
}

class User: Auditable {
  username: String,
  fn greet(greeting: String): String,
  fn friends(): User[],
  fn nickname(): String?,
  fn audit(reason: String): Boolean
}

class follows(source: User, target: User) {
  fn weight(): Int
}
`

describe('Methods — Hover', () => {
  const ws = new Workspace(KERNEL_PRELUDE, kernelRegistry)
  const uri = 'file:///test/methods-hover.gsl'
  ws.update(uri, METHODS_SAMPLE, 1)

  it('shows method signatures in class hover', () => {
    const state = ws.get(uri)!
    const idx = METHODS_SAMPLE.indexOf('class User')
    const hover = provideHover(ws, state, idx + 6) // in "User"
    expect(hover).not.toBeNull()
    const value = (hover!.contents as any).value as string
    expect(value).toContain('fn greet(greeting: String): String')
    expect(value).toContain('fn friends(): User[]')
    expect(value).toContain('fn nickname(): String?')
    expect(value).toContain('fn audit(reason: String): Boolean')
  })

  it('shows method signatures in interface hover', () => {
    const state = ws.get(uri)!
    const idx = METHODS_SAMPLE.indexOf('interface Auditable')
    const hover = provideHover(ws, state, idx + 10) // in "Auditable"
    expect(hover).not.toBeNull()
    const value = (hover!.contents as any).value as string
    expect(value).toContain('fn audit(reason: String): Boolean')
  })

  it('shows method signatures in edge hover', () => {
    const state = ws.get(uri)!
    const idx = METHODS_SAMPLE.indexOf('class follows')
    const hover = provideHover(ws, state, idx + 6) // in "follows"
    expect(hover).not.toBeNull()
    const value = (hover!.contents as any).value as string
    expect(value).toContain('fn weight(): Int')
  })
})

describe('Methods — Document Symbols', () => {
  const ws = new Workspace(KERNEL_PRELUDE, kernelRegistry)
  const uri = 'file:///test/methods-symbols.gsl'
  ws.update(uri, METHODS_SAMPLE, 1)

  it('includes methods as children of class', () => {
    const state = ws.get(uri)!
    const symbols = provideDocumentSymbols(state)
    const user = symbols.find((s) => s.name === 'User')!
    expect(user.children).toBeDefined()
    const childNames = user.children!.map((c) => c.name)
    expect(childNames).toContain('username')
    expect(childNames).toContain('greet')
    expect(childNames).toContain('friends')
    expect(childNames).toContain('nickname')
    expect(childNames).toContain('audit')
  })

  it('marks methods with SymbolKind.Method', () => {
    const state = ws.get(uri)!
    const symbols = provideDocumentSymbols(state)
    const user = symbols.find((s) => s.name === 'User')!
    const greet = user.children!.find((c) => c.name === 'greet')!
    expect(greet.kind).toBe(SymbolKind.Method)
  })

  it('shows correct method detail strings', () => {
    const state = ws.get(uri)!
    const symbols = provideDocumentSymbols(state)
    const user = symbols.find((s) => s.name === 'User')!
    const greet = user.children!.find((c) => c.name === 'greet')!
    expect(greet.detail).toBe('(greeting): String')
    const friends = user.children!.find((c) => c.name === 'friends')!
    expect(friends.detail).toBe('(): User[]')
    const nickname = user.children!.find((c) => c.name === 'nickname')!
    expect(nickname.detail).toBe('(): String?')
  })

  it('includes methods as children of interface', () => {
    const state = ws.get(uri)!
    const symbols = provideDocumentSymbols(state)
    const auditable = symbols.find((s) => s.name === 'Auditable')!
    expect(auditable.children).toBeDefined()
    const audit = auditable.children!.find((c) => c.name === 'audit')!
    expect(audit.kind).toBe(SymbolKind.Method)
    expect(audit.detail).toBe('(reason): Boolean')
  })

  it('includes methods as children of edge', () => {
    const state = ws.get(uri)!
    const symbols = provideDocumentSymbols(state)
    const follows = symbols.find((s) => s.name === 'follows')!
    expect(follows.children).toBeDefined()
    const weight = follows.children!.find((c) => c.name === 'weight')!
    expect(weight.kind).toBe(SymbolKind.Method)
    expect(weight.detail).toBe('(): Int')
  })
})

describe('Methods — Completion', () => {
  const ws = new Workspace(KERNEL_PRELUDE, kernelRegistry)
  const uri = 'file:///test/methods-comp.gsl'
  ws.update(uri, METHODS_SAMPLE, 1)

  it('offers fn keyword inside body', () => {
    const state = ws.get(uri)!
    // Position cursor inside the User class body after an attribute
    const idx = METHODS_SAMPLE.indexOf('username: String,') + 'username: String,'.length + 1
    const items = provideCompletion(ws, state, idx)
    expect(items.some((i) => i.label === 'fn')).toBe(true)
  })

  it('fn completion is a snippet with placeholders', () => {
    const state = ws.get(uri)!
    const idx = METHODS_SAMPLE.indexOf('username: String,') + 'username: String,'.length + 1
    const items = provideCompletion(ws, state, idx)
    const fn = items.find((i) => i.label === 'fn')!
    expect(fn.insertText).toContain('${1:name}')
    expect(fn.insertText).toContain('${3:ReturnType}')
    expect(fn.insertTextFormat).toBe(2) // InsertTextFormat.Snippet
  })

  it('also offers type completions inside body', () => {
    const state = ws.get(uri)!
    const idx = METHODS_SAMPLE.indexOf('username: String,') + 'username: String,'.length + 1
    const items = provideCompletion(ws, state, idx)
    expect(items.some((i) => i.label === 'String')).toBe(true)
  })
})

describe('Methods — Semantic Tokens', () => {
  const ws = new Workspace(KERNEL_PRELUDE, kernelRegistry)
  const uri = 'file:///test/methods-sem.gsl'
  ws.update(uri, METHODS_SAMPLE, 1)

  it('classifies fn as keyword', () => {
    const state = ws.get(uri)!
    const data = provideSemanticTokens(state)
    const keywordTypeIdx = SEMANTIC_TOKEN_TYPES.indexOf('keyword')

    // Decode token data to find fn tokens
    const tokens = state.tokenIndex
    const lineMap = state.lineMap

    let prevLine = 0
    let prevChar = 0
    let fnIsKeyword = false

    for (let i = 0; i < data.length; i += 5) {
      const deltaLine = data[i]
      const deltaChar = data[i + 1]
      const length = data[i + 2]
      const typeIdx = data[i + 3]

      const line = prevLine + deltaLine
      const char = deltaLine === 0 ? prevChar + deltaChar : deltaChar

      // Find the corresponding text at this position
      const offset = lineMap.offsetAt(line, char)
      const text = METHODS_SAMPLE.slice(offset, offset + length)

      if (text === 'fn' && typeIdx === keywordTypeIdx) {
        fnIsKeyword = true
        break
      }

      prevLine = line
      prevChar = char
    }

    expect(fnIsKeyword).toBe(true)
  })
})
