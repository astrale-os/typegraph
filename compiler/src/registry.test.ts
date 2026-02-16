// src/registry.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { resolve, join } from 'path'
import { isLocalPath, resolveExtendUri, LazyFileRegistry, MapSchemaRegistry } from './registry'
import { compile } from './compile'
import { KERNEL_PRELUDE } from './prelude'
import { buildKernelRegistry } from './kernel-prelude'
import { createLazyFileRegistry } from './file-resolver'

// ─── isLocalPath ─────────────────────────────────────────────

describe('isLocalPath', () => {
  it('returns true for relative ./ paths', () => {
    expect(isLocalPath('./types.gsl')).toBe(true)
    expect(isLocalPath('./nested/types.gsl')).toBe(true)
  })

  it('returns true for relative ../ paths', () => {
    expect(isLocalPath('../types.gsl')).toBe(true)
    expect(isLocalPath('../../shared/types.gsl')).toBe(true)
  })

  it('returns true for file:// URIs', () => {
    expect(isLocalPath('file:///home/user/types.gsl')).toBe(true)
  })

  it('returns false for https:// URIs', () => {
    expect(isLocalPath('https://kernel.astrale.ai/v1')).toBe(false)
  })

  it('returns false for bare names', () => {
    expect(isLocalPath('types.gsl')).toBe(false)
  })
})

// ─── resolveExtendUri ────────────────────────────────────────

describe('resolveExtendUri', () => {
  it('resolves relative path against source dir', () => {
    const result = resolveExtendUri('./types.gsl', '/home/user/project/main.gsl')
    expect(result).toBe(resolve('/home/user/project/types.gsl'))
  })

  it('resolves ../ path against source dir', () => {
    const result = resolveExtendUri('../shared/types.gsl', '/home/user/project/src/main.gsl')
    expect(result).toBe(resolve('/home/user/project/shared/types.gsl'))
  })

  it('converts file:// URI to absolute path', () => {
    const result = resolveExtendUri('file:///home/user/types.gsl')
    expect(result).toBe('/home/user/types.gsl')
  })

  it('passes https:// URIs through unchanged', () => {
    const uri = 'https://kernel.astrale.ai/v1'
    expect(resolveExtendUri(uri)).toBe(uri)
    expect(resolveExtendUri(uri, '/some/file.gsl')).toBe(uri)
  })

  it('returns relative path as-is when no sourceUri', () => {
    expect(resolveExtendUri('./types.gsl')).toBe('./types.gsl')
  })
})

// ─── LazyFileRegistry ────────────────────────────────────────

describe('LazyFileRegistry', () => {
  it('delegates to base registry for pre-registered schemas', () => {
    const base = new MapSchemaRegistry()
    const fakeSchema = { symbols: new Map([['Foo', { name: 'Foo', symbolKind: 'Class' as const, declaration: null, span: null }]]), declarations: [], references: new Map() }
    base.register('https://example.com/v1', fakeSchema)

    const registry = new LazyFileRegistry(() => null, base)
    expect(registry.get('https://example.com/v1')).toBe(fakeSchema)
    expect(registry.lookupSymbol('https://example.com/v1', 'Foo')).toEqual(fakeSchema.symbols.get('Foo'))
  })

  it('calls compileFn for local paths', () => {
    let called = false
    const fakeSchema = { symbols: new Map(), declarations: [], references: new Map() }
    const registry = new LazyFileRegistry((path) => {
      called = true
      expect(path).toBe('./types.gsl')
      return fakeSchema
    })

    registry.get('./types.gsl')
    expect(called).toBe(true)
  })

  it('caches compiled schemas', () => {
    let callCount = 0
    const fakeSchema = { symbols: new Map(), declarations: [], references: new Map() }
    const registry = new LazyFileRegistry(() => {
      callCount++
      return fakeSchema
    })

    registry.get('./types.gsl')
    registry.get('./types.gsl')
    expect(callCount).toBe(1)
  })

  it('detects cycles and returns null', () => {
    const registry = new LazyFileRegistry((path) => {
      // Simulate cycle: trying to look up itself during compilation
      return registry.get(path)
    })

    const result = registry.get('./cycle.gsl')
    expect(result).toBeNull()
  })

  it('does not call compileFn for non-local URIs', () => {
    let called = false
    const registry = new LazyFileRegistry(() => {
      called = true
      return null
    })

    registry.get('https://unknown.example.com/v1')
    expect(called).toBe(false)
  })
})

// ─── Integration: extend from local file ─────────────────────

describe('Local file extend (integration)', () => {
  const tmpDir = resolve(__dirname, '__test_tmp_registry__')

  beforeAll(() => {
    mkdirSync(tmpDir, { recursive: true })
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('compiles a schema that extends a local .gsl file', () => {
    // Write the dependency file
    writeFileSync(
      join(tmpDir, 'types.gsl'),
      `interface Auditable {
  created_at: Timestamp
}`,
      'utf-8',
    )

    // Write the main file
    const mainPath = join(tmpDir, 'main.gsl')
    writeFileSync(
      mainPath,
      `extend "https://kernel.astrale.ai/v1" { Node, Identity }
extend "./types.gsl" { Auditable }

class User: Identity, Auditable {
  name: String
}`,
      'utf-8',
    )

    const registry = createLazyFileRegistry(buildKernelRegistry(), KERNEL_PRELUDE)
    const { diagnostics, artifacts } = compile(
      `extend "https://kernel.astrale.ai/v1" { Node, Identity }
extend "./types.gsl" { Auditable }

class User: Identity, Auditable {
  name: String
}`,
      { prelude: KERNEL_PRELUDE, registry, sourceUri: mainPath },
    )

    expect(diagnostics.hasErrors()).toBe(false)
    const auditable = artifacts?.resolved.symbols.get('Auditable')
    expect(auditable).toBeDefined()
    expect(auditable!.symbolKind).toBe('Interface')
    // The declaration should come from the local file, not a stub
    expect(auditable!.declaration).not.toBeNull()
  })

  it('reports error for missing symbol in local file', () => {
    writeFileSync(
      join(tmpDir, 'empty.gsl'),
      `-- empty schema, no declarations`,
      'utf-8',
    )

    const mainPath = join(tmpDir, 'main2.gsl')
    const registry = createLazyFileRegistry(buildKernelRegistry(), KERNEL_PRELUDE)
    const { diagnostics } = compile(
      `extend "./empty.gsl" { NonExistent }`,
      { prelude: KERNEL_PRELUDE, registry, sourceUri: mainPath },
    )

    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.message.includes('NonExistent'))).toBe(true)
  })

  it('handles nested extend chains', () => {
    writeFileSync(
      join(tmpDir, 'base.gsl'),
      `interface Base {
  id: String
}`,
      'utf-8',
    )

    writeFileSync(
      join(tmpDir, 'middle.gsl'),
      `extend "./base.gsl" { Base }

interface Middle: Base {
  name: String
}`,
      'utf-8',
    )

    const mainPath = join(tmpDir, 'chain.gsl')
    const registry = createLazyFileRegistry(buildKernelRegistry(), KERNEL_PRELUDE)
    const { diagnostics, artifacts } = compile(
      `extend "https://kernel.astrale.ai/v1" { Node }
extend "./middle.gsl" { Middle }

class Entity: Node, Middle {
  email: String
}`,
      { prelude: KERNEL_PRELUDE, registry, sourceUri: mainPath },
    )

    expect(diagnostics.hasErrors()).toBe(false)
    expect(artifacts?.resolved.symbols.get('Middle')).toBeDefined()
  })

  it('gracefully handles missing local file', () => {
    const mainPath = join(tmpDir, 'missing.gsl')
    const registry = createLazyFileRegistry(buildKernelRegistry(), KERNEL_PRELUDE)
    const { diagnostics } = compile(
      `extend "./nonexistent.gsl" { Foo }`,
      { prelude: KERNEL_PRELUDE, registry, sourceUri: mainPath },
    )

    // Should fall back to stub (no schema found for the URI)
    expect(diagnostics.hasErrors()).toBe(false)
    // Foo should exist as a stub
  })
})
