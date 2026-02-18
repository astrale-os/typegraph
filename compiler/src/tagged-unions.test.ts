// src/tagged-unions.test.ts
// ============================================================
// Compiler tests for tagged union declarations.
// ============================================================

import { describe, it, expect } from 'vitest'
import { lex } from './lexer'
import { parse } from './parser/index'
import { lower } from './lower/index'
import { compile } from './compile'
import { KERNEL_PRELUDE } from './prelude'
import { buildKernelRegistry } from './kernel-prelude'

const kernelRegistry = buildKernelRegistry()
import { type TaggedUnionDeclNode } from './cst/index'
import { type TaggedUnionDecl } from './ast/index'
import { type SchemaIR, type NodeDef, type TaggedUnionDef } from './ir/index'
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
function findTaggedUnion(ir: SchemaIR, name: string): TaggedUnionDef {
  return ir.tagged_unions.find((t) => t.name === name)!
}

// ─── Parser Tests ───────────────────────────────────────────

describe('Parser — Tagged Unions', () => {
  it('parses a basic tagged union', () => {
    const [d] = decls(`type PublicKey = | jwk { key: String } | jwksUri { uri: String }`)
    expect(d.kind).toBe('TaggedUnionDecl')
    const tu = d as TaggedUnionDeclNode
    expect(tu.name.text).toBe('PublicKey')
    expect(tu.variants).toHaveLength(2)
    expect(tu.variants[0].tag.text).toBe('jwk')
    expect(tu.variants[0].fields).toHaveLength(1)
    expect(tu.variants[1].tag.text).toBe('jwksUri')
    expect(tu.variants[1].fields).toHaveLength(1)
  })

  it('parses a tagged union with multiple fields per variant', () => {
    const [d] = decls(`
      type Shape =
        | circle { radius: Float }
        | rectangle { width: Float, height: Float }
    `)
    const tu = d as TaggedUnionDeclNode
    expect(tu.variants).toHaveLength(2)
    expect(tu.variants[0].fields).toHaveLength(1)
    expect(tu.variants[1].fields).toHaveLength(2)
  })

  it('parses a tagged union with empty variant', () => {
    const [d] = decls(`type Result = | ok { value: String } | error {}`)
    const tu = d as TaggedUnionDeclNode
    expect(tu.variants).toHaveLength(2)
    expect(tu.variants[1].fields).toHaveLength(0)
  })

  it('parses tagged union alongside other declarations', () => {
    const ds = decls(`
      type Email = String
      type PublicKey = | jwk { key: String } | jwksUri { uri: String }
      class User { name: String }
    `)
    expect(ds).toHaveLength(3)
    expect(ds[0].kind).toBe('TypeAliasDecl')
    expect(ds[1].kind).toBe('TaggedUnionDecl')
    expect(ds[2].kind).toBe('ClassDecl')
  })

  it('parses a tagged union with nullable fields', () => {
    const [d] = decls(`type Auth = | token { value: String } | anonymous { label: String? }`)
    const tu = d as TaggedUnionDeclNode
    expect(tu.variants[1].fields[0].nullable).not.toBeNull()
  })

  it('parses a tagged union with list fields', () => {
    const [d] = decls(`type Data = | single { value: String } | multi { values: String[] }`)
    const tu = d as TaggedUnionDeclNode
    expect(tu.variants[1].fields[0].listSuffix).not.toBeNull()
  })

  it('parses a tagged union with default values', () => {
    const [d] = decls(`type Config = | basic { retries: Int = 3 } | advanced { timeout: Int = 30 }`)
    const tu = d as TaggedUnionDeclNode
    expect(tu.variants[0].fields[0].defaultValue).not.toBeNull()
    expect(tu.variants[1].fields[0].defaultValue).not.toBeNull()
  })
})

// ─── Lowering Tests ─────────────────────────────────────────

describe('Lowering — Tagged Unions', () => {
  it('lowers a tagged union to TaggedUnionDecl', () => {
    const { cst } = parseSource(`type PublicKey = | jwk { key: String } | jwksUri { uri: String }`)
    const bag = new DiagnosticBag()
    const { ast } = lower(cst, bag)
    expect(bag.hasErrors()).toBe(false)
    const tu = ast.declarations[0] as TaggedUnionDecl
    expect(tu.kind).toBe('TaggedUnionDecl')
    expect(tu.name.value).toBe('PublicKey')
    expect(tu.variants).toHaveLength(2)
    expect(tu.variants[0].tag).toBe('jwk')
    expect(tu.variants[0].fields).toHaveLength(1)
  })

  it('extracts nullable flag from variant field', () => {
    const { cst } = parseSource(`type T = | a { x: String? } | b { y: Int }`)
    const bag = new DiagnosticBag()
    const { ast } = lower(cst, bag)
    const tu = ast.declarations[0] as TaggedUnionDecl
    expect(tu.variants[0].fields[0].nullable).toBe(true)
  })

  it('extracts list flag from variant field', () => {
    const { cst } = parseSource(`type T = | a { items: String[] } | b { single: String }`)
    const bag = new DiagnosticBag()
    const { ast } = lower(cst, bag)
    const tu = ast.declarations[0] as TaggedUnionDecl
    expect(tu.variants[0].fields[0].list).toBe(true)
  })

  it('lowers field default value', () => {
    const { cst } = parseSource(`type T = | a { count: Int = 0 } | b { name: String }`)
    const bag = new DiagnosticBag()
    const { ast } = lower(cst, bag)
    const tu = ast.declarations[0] as TaggedUnionDecl
    expect(tu.variants[0].fields[0].defaultValue).not.toBeNull()
    expect(tu.variants[0].fields[0].defaultValue!.kind).toBe('NumberLiteral')
  })

  it('lowers variant with empty fields', () => {
    const { cst } = parseSource(`type T = | a {} | b { x: Int }`)
    const bag = new DiagnosticBag()
    const { ast } = lower(cst, bag)
    const tu = ast.declarations[0] as TaggedUnionDecl
    expect(tu.variants[0].fields).toHaveLength(0)
    expect(tu.variants[1].fields).toHaveLength(1)
  })
})

// ─── Resolver Tests ─────────────────────────────────────────

describe('Resolver — Tagged Unions', () => {
  it('resolves field types in tagged union variants', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type PublicKey = | jwk { key: String } | jwksUri { uri: String }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const tu = findTaggedUnion(ir!, 'PublicKey')
    expect(tu.variants[0].fields[0].type.kind).toBe('Scalar')
  })

  it('errors on unknown field type in variant', () => {
    const { diagnostics } = compileWithKernel(`
      type Bad = | a { x: NonExistent } | b { y: String }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.R_UNKNOWN_TYPE)).toBe(true)
  })

  it('detects circular tagged union references', () => {
    const { diagnostics } = compileWithKernel(`
      type A = | x { b: B } | y { val: String }
      type B = | p { a: A } | q { val: Int }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_CIRCULAR_VALUE_TYPE)).toBe(true)
  })

  it('detects circular tagged union with value type', () => {
    const { diagnostics } = compileWithKernel(`
      type A = | x { b: B } | y { val: String }
      type B = { a: A }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_CIRCULAR_VALUE_TYPE)).toBe(true)
  })

  it('allows tagged union referencing a value type (non-circular)', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Inner = { x: Float }
      type Outer = | a { inner: Inner } | b { val: String }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const outer = findTaggedUnion(ir!, 'Outer')
    expect(outer.variants[0].fields[0].type.kind).toBe('ValueType')
  })

  it('allows value type referencing a tagged union', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type PublicKey = | jwk { key: String } | jwksUri { uri: String }
      type Config = { publicKey: PublicKey }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const config = ir!.value_types.find((v) => v.name === 'Config')!
    expect(config.fields[0].type).toEqual({ kind: 'TaggedUnion', name: 'PublicKey' })
  })

  it('registers tagged union as TaggedUnion symbol kind', () => {
    const { artifacts, diagnostics } = compileWithKernel(`
      type PK = | jwk { key: String } | jwksUri { uri: String }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const sym = artifacts!.resolved.symbols.get('PK')
    expect(sym).toBeDefined()
    expect(sym!.symbolKind).toBe('TaggedUnion')
  })
})

// ─── Validator Tests ────────────────────────────────────────

describe('Validator — Tagged Unions', () => {
  it('rejects tagged union with fewer than 2 variants', () => {
    const { diagnostics } = compileWithKernel(`
      type Bad = | only { x: Int }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_TOO_FEW_VARIANTS)).toBe(true)
  })

  it('rejects duplicate variant tags', () => {
    const { diagnostics } = compileWithKernel(`
      type Dup = | a { x: Int } | a { y: String }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_DUPLICATE_VARIANT)).toBe(true)
  })

  it('rejects duplicate fields within a variant', () => {
    const { diagnostics } = compileWithKernel(`
      type Bad = | a { x: Int, x: String } | b { y: Int }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_DUPLICATE_FIELD)).toBe(true)
  })

  it('validates default value compatibility in variants', () => {
    const { diagnostics } = compileWithKernel(`
      type Bad = | a { count: Int = "hello" } | b { x: String }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_DEFAULT_TYPE_MISMATCH)).toBe(true)
  })

  it('accepts compatible defaults in variant fields', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Config = | basic { retries: Int = 3 } | advanced { timeout: Int = 30 }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const tu = findTaggedUnion(ir!, 'Config')
    expect(tu.variants[0].fields[0].default).not.toBeNull()
    expect(tu.variants[1].fields[0].default).not.toBeNull()
  })

  it('allows independent variants with different fields', () => {
    const { diagnostics } = compileWithKernel(`
      type Result =
        | ok { value: String, count: Int }
        | error { message: String, code: Int }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
  })
})

// ─── Full Pipeline Tests ────────────────────────────────────

describe('Full Pipeline — Tagged Unions', () => {
  it('compiles a tagged union with mixed field types', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Claim =
        | eq { field: String, value: String }
        | contains { field: String, value: String }
        | exists { field: String }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const tu = findTaggedUnion(ir!, 'Claim')
    expect(tu.variants).toHaveLength(3)
    expect(tu.variants[0].tag).toBe('eq')
    expect(tu.variants[0].fields).toHaveLength(2)
    expect(tu.variants[0].fields[0].type).toEqual({ kind: 'Scalar', name: 'String' })
    expect(tu.variants[2].tag).toBe('exists')
    expect(tu.variants[2].fields).toHaveLength(1)
  })

  it('compiles method using tagged union as return type', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type PublicKey = | jwk { key: String } | jwksUri { uri: String }
      class Auth {
        fn getPublicKey(): PublicKey
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const auth = findNode(ir!, 'Auth')
    expect(auth.methods[0].return_type).toEqual({ kind: 'TaggedUnion', name: 'PublicKey' })
  })

  it('compiles method using tagged union as param type', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type PublicKey = | jwk { key: String } | jwksUri { uri: String }
      class Auth {
        fn setPublicKey(key: PublicKey): Boolean
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const auth = findNode(ir!, 'Auth')
    expect(auth.methods[0].params[0].type).toEqual({ kind: 'TaggedUnion', name: 'PublicKey' })
  })

  it('compiles tagged union as attribute type', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type PublicKey = | jwk { key: String } | jwksUri { uri: String }
      class Identity {
        key: PublicKey
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const identity = findNode(ir!, 'Identity')
    expect(identity.attributes[0].type).toEqual({ kind: 'TaggedUnion', name: 'PublicKey' })
  })

  it('includes tagged_unions array in SchemaIR', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type A = | x { v: Int } | y { w: String }
      type B = | p { m: Float } | q { n: Boolean }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    expect(ir!.tagged_unions).toHaveLength(2)
    expect(ir!.tagged_unions.map((t) => t.name)).toEqual(['A', 'B'])
  })

  it('tagged_unions is empty when none defined', () => {
    const { ir, diagnostics } = compileWithKernel(`
      class User { name: String }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    expect(ir!.tagged_unions).toHaveLength(0)
  })

  it('tagged union fields with list type serialize correctly', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Data =
        | single { value: String }
        | multi { values: String[] }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const tu = findTaggedUnion(ir!, 'Data')
    expect(tu.variants[1].fields[0].type).toEqual({
      kind: 'List',
      element: { kind: 'Scalar', name: 'String' },
    })
  })

  it('tagged union fields with nullable serialize correctly', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Auth =
        | token { value: String }
        | cookie { name: String, domain: String? }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const tu = findTaggedUnion(ir!, 'Auth')
    expect(tu.variants[1].fields[1].nullable).toBe(true)
  })

  it('tagged union referencing another tagged union', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type Inner = | a { x: Int } | b { y: String }
      type Outer = | wrap { inner: Inner } | plain { val: Float }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const outer = findTaggedUnion(ir!, 'Outer')
    expect(outer.variants[0].fields[0].type).toEqual({ kind: 'TaggedUnion', name: 'Inner' })
  })

  it('compiles realistic PublicKey + ClaimConstraint pattern', () => {
    const { ir, diagnostics } = compileWithKernel(`
      type PublicKey =
        | jwk { key: String }
        | jwksUri { uri: String }

      type ClaimConstraint =
        | eq { field: String, value: String }
        | contains { field: String, value: String }
        | exists { field: String }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    expect(ir!.tagged_unions).toHaveLength(2)

    const pk = findTaggedUnion(ir!, 'PublicKey')
    expect(pk.variants).toHaveLength(2)
    expect(pk.variants[0].tag).toBe('jwk')
    expect(pk.variants[1].tag).toBe('jwksUri')

    const cc = findTaggedUnion(ir!, 'ClaimConstraint')
    expect(cc.variants).toHaveLength(3)
  })
})
