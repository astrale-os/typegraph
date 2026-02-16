// src/value-types.test.ts
// ============================================================
// Compiler tests for KRL value type declarations.
// ============================================================

import { describe, it, expect } from 'vitest'
import { lex } from './lexer'
import { parse } from './parser/index'
import { lower } from './lower/index'
import { compile } from './compile'
import { KERNEL_PRELUDE } from './prelude'
import { buildKernelRegistry } from './kernel-prelude'

const kernelRegistry = buildKernelRegistry()
import { type TypeAliasDeclNode, type ValueTypeDeclNode } from './cst/index'
import { type TypeAliasDecl, type ValueTypeDecl, type NodeDecl } from './ast/index'
import { type SchemaIR, type NodeDef, type ValueTypeDef } from './ir/index'
import { DiagnosticBag, DiagnosticCodes } from './diagnostics'

// ─── Helpers ────────────────────────────────────────────────

function parseSource(source: string) {
  const bag = new DiagnosticBag()
  const { tokens } = lex(source, bag)
  const { cst, diagnostics } = parse(tokens, bag)
  return { cst, diagnostics }
}

function decls(source: string) {
  const { cst, diagnostics } = parseSource(source)
  expect(diagnostics.hasErrors()).toBe(false)
  return cst.declarations
}

function compileWithKernel(source: string) {
  return compile(source, { prelude: KERNEL_PRELUDE, registry: kernelRegistry })
}

function nodes(ir: SchemaIR): NodeDef[] {
  return ir.classes.filter((c): c is NodeDef => c.type === 'node')
}
function findNode(ir: SchemaIR, name: string): NodeDef {
  return nodes(ir).find((n) => n.name === name)!
}
function findValueType(ir: SchemaIR, name: string): ValueTypeDef {
  return ir.value_types.find((v) => v.name === name)!
}

// ─── Parser Tests ───────────────────────────────────────────

describe('Parser — Value Types', () => {
  it('parses a basic value type', () => {
    const [d] = decls(`type Coords = { lat: Float, lng: Float }`)
    expect(d.kind).toBe('ValueTypeDecl')
    const vt = d as ValueTypeDeclNode
    expect(vt.name.text).toBe('Coords')
    expect(vt.fields).toHaveLength(2)
    expect(vt.fields[0].name.text).toBe('lat')
    expect(vt.fields[1].name.text).toBe('lng')
  })

  it('parses a value type with nullable field', () => {
    const [d] = decls(`type Addr = { city: String, zip: String? }`)
    const vt = d as ValueTypeDeclNode
    expect(vt.fields[1].nullable).not.toBeNull()
  })

  it('parses a value type with list field', () => {
    const [d] = decls(`type Data = { tags: String[] }`)
    const vt = d as ValueTypeDeclNode
    expect(vt.fields[0].listSuffix).not.toBeNull()
  })

  it('parses a value type with default value', () => {
    const [d] = decls(`type Config = { retries: Int = 3 }`)
    const vt = d as ValueTypeDeclNode
    expect(vt.fields[0].defaultValue).not.toBeNull()
  })

  it('parses an empty value type', () => {
    const [d] = decls(`type Empty = {}`)
    const vt = d as ValueTypeDeclNode
    expect(vt.fields).toHaveLength(0)
  })

  it('parses value type alongside scalar alias', () => {
    const ds = decls(`
      type Email = String
      type Coords = { lat: Float, lng: Float }
    `)
    expect(ds).toHaveLength(2)
    expect(ds[0].kind).toBe('TypeAliasDecl')
    expect(ds[1].kind).toBe('ValueTypeDecl')
  })

  it('still parses scalar type alias correctly', () => {
    const [d] = decls(`type Email = String`)
    expect(d.kind).toBe('TypeAliasDecl')
    const alias = d as TypeAliasDeclNode
    expect(alias.name.text).toBe('Email')
  })
})

// ─── Lowering Tests ─────────────────────────────────────────

describe('Lowering — Value Types', () => {
  it('lowers a value type to ValueTypeDecl', () => {
    const { cst } = parseSource(`type Coords = { lat: Float, lng: Float }`)
    const bag = new DiagnosticBag()
    const { ast } = lower(cst, bag)
    expect(bag.hasErrors()).toBe(false)
    const vt = ast.declarations[0] as ValueTypeDecl
    expect(vt.kind).toBe('ValueTypeDecl')
    expect(vt.name.value).toBe('Coords')
    expect(vt.fields).toHaveLength(2)
  })

  it('extracts nullable flag from field', () => {
    const { cst } = parseSource(`type T = { x: String? }`)
    const bag = new DiagnosticBag()
    const { ast } = lower(cst, bag)
    const vt = ast.declarations[0] as ValueTypeDecl
    expect(vt.fields[0].nullable).toBe(true)
  })

  it('extracts list flag from field', () => {
    const { cst } = parseSource(`type T = { items: String[] }`)
    const bag = new DiagnosticBag()
    const { ast } = lower(cst, bag)
    const vt = ast.declarations[0] as ValueTypeDecl
    expect(vt.fields[0].list).toBe(true)
  })

  it('lowers field default value', () => {
    const { cst } = parseSource(`type T = { count: Int = 0 }`)
    const bag = new DiagnosticBag()
    const { ast } = lower(cst, bag)
    const vt = ast.declarations[0] as ValueTypeDecl
    expect(vt.fields[0].defaultValue).not.toBeNull()
    expect(vt.fields[0].defaultValue!.kind).toBe('NumberLiteral')
  })

  it('lowers empty value type', () => {
    const { cst } = parseSource(`type Empty = {}`)
    const bag = new DiagnosticBag()
    const { ast } = lower(cst, bag)
    const vt = ast.declarations[0] as ValueTypeDecl
    expect(vt.fields).toHaveLength(0)
  })
})

// ─── Resolver Tests ─────────────────────────────────────────

describe('Resolver — Value Types', () => {
  it('resolves field types in a value type', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Coords = { lat: Float, lng: Float }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const vt = findValueType(ir!, 'Coords')
    expect(vt.fields[0].type.kind).toBe('Scalar')
  })

  it('errors on unknown field type', () => {
    const { diagnostics } = compileWithKernel(`
      type Bad = { x: NonExistent }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.R_UNKNOWN_TYPE)).toBe(true)
  })

  it('detects circular value type references', () => {
    const { diagnostics } = compileWithKernel(`
      type A = { b: B }
      type B = { a: A }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_CIRCULAR_VALUE_TYPE)).toBe(true)
  })

  it('allows value type referencing another value type (non-circular)', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Inner = { x: Float }
      type Outer = { inner: Inner }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const outer = findValueType(ir!, 'Outer')
    expect(outer.fields[0].type.kind).toBe('ValueType')
  })

  it('allows value type referencing a node', () => {
    const { ir, diagnostics } = compileWithKernel(`
      class User { name: String }
      type Result = { user: User }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const result = findValueType(ir!, 'Result')
    expect(result.fields[0].type.kind).toBe('Node')
  })
})

// ─── Validator Tests ────────────────────────────────────────

describe('Validator — Value Types', () => {
  it('detects duplicate field names', () => {
    const { diagnostics } = compileWithKernel(`
      type Dup = { x: Int, x: Float }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_DUPLICATE_FIELD)).toBe(true)
  })

  it('validates default value compatibility', () => {
    const { diagnostics } = compileWithKernel(`
      type Bad = { count: Int = "hello" }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_DEFAULT_TYPE_MISMATCH)).toBe(true)
  })

  it('accepts compatible default values', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Config = { retries: Int = 3, name: String = "default" }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const vt = findValueType(ir!, 'Config')
    expect(vt.fields[0].default).not.toBeNull()
    expect(vt.fields[1].default).not.toBeNull()
  })
})

// ─── Full Pipeline Tests ────────────────────────────────────

describe('Full Pipeline — Value Types', () => {
  it('compiles a value type with mixed field types', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Coords = {
        lat: Float,
        lng: Float,
        label: String? = "unknown"
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const vt = findValueType(ir!, 'Coords')
    expect(vt.fields).toHaveLength(3)
    expect(vt.fields[0].type).toEqual({ kind: 'Scalar', name: 'Float' })
    expect(vt.fields[2].nullable).toBe(true)
    expect(vt.fields[2].default).toEqual({ kind: 'StringLiteral', value: 'unknown' })
  })

  it('compiles method using value type as return', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Coords = { lat: Float, lng: Float }
      class Place {
        name: String
        fn location(): Coords
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const place = findNode(ir!, 'Place')
    expect(place.methods[0].return_type).toEqual({ kind: 'ValueType', name: 'Coords' })
  })

  it('compiles method using value type as param', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Coords = { lat: Float, lng: Float }
      class Map {
        fn setCenter(coords: Coords): Boolean
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const map = findNode(ir!, 'Map')
    expect(map.methods[0].params[0].type).toEqual({ kind: 'ValueType', name: 'Coords' })
  })

  it('compiles value type referencing another value type', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Point = { x: Float, y: Float }
      type Rect = { topLeft: Point, bottomRight: Point }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const rect = findValueType(ir!, 'Rect')
    expect(rect.fields[0].type).toEqual({ kind: 'ValueType', name: 'Point' })
    expect(rect.fields[1].type).toEqual({ kind: 'ValueType', name: 'Point' })
  })

  it('compiles value type with list field', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Tags = { items: String[] }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const tags = findValueType(ir!, 'Tags')
    expect(tags.fields[0].type).toEqual({
      kind: 'List',
      element: { kind: 'Scalar', name: 'String' },
    })
  })

  it('compiles empty value type', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Empty = {}
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const empty = findValueType(ir!, 'Empty')
    expect(empty.fields).toHaveLength(0)
  })

  it('compiles value type as attribute type', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Coords = { lat: Float, lng: Float }
      class Place {
        location: Coords
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const place = findNode(ir!, 'Place')
    expect(place.attributes[0].type).toEqual({ kind: 'ValueType', name: 'Coords' })
  })

  it('includes value_types array in SchemaIR', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type A = { x: Int }
      type B = { y: String }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    expect(ir!.value_types).toHaveLength(2)
    expect(ir!.value_types.map((v) => v.name)).toEqual(['A', 'B'])
  })

  it('value_types is empty when no value types defined', () => {
    const { ir, diagnostics } = compileWithKernel(`
      class User { name: String }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    expect(ir!.value_types).toHaveLength(0)
  })
})
