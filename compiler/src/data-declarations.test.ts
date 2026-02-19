// src/data-declarations.test.ts
// ============================================================
// Compiler tests for data declarations and brace projections.
// ============================================================

import { describe, it, expect } from 'vitest'
import { lex } from './lexer'
import { parse } from './parser/index'
import { lower } from './lower/index'
import { compile } from './compile'
import { KERNEL_PRELUDE } from './prelude'
import { buildKernelRegistry } from './kernel-prelude'

const kernelRegistry = buildKernelRegistry()
import {
  type ClassDeclNode,
  type DataDeclNode,
} from './cst/index'
import {
  type NodeDecl,
  type EdgeDecl,
  type InterfaceDecl,
  type DataDecl,
  type Declaration,
} from './ast/index'
import { type SchemaIR, type NodeDef, type EdgeDef, type MethodDef, type DataTypeDef } from './ir/index'
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

function ast(source: string): Declaration[] {
  const bag = new DiagnosticBag()
  const { tokens } = lex(source, bag)
  const { cst } = parse(tokens, bag)
  const { ast } = lower(cst, bag)
  return ast.declarations
}

function compileWithKernel(source: string) {
  return compile(source, { prelude: KERNEL_PRELUDE, registry: kernelRegistry })
}

function nodes(ir: SchemaIR): NodeDef[] {
  return ir.classes.filter((c): c is NodeDef => c.type === 'node')
}
function edges(ir: SchemaIR): EdgeDef[] {
  return ir.classes.filter((c): c is EdgeDef => c.type === 'edge')
}
function findNode(ir: SchemaIR, name: string): NodeDef {
  return nodes(ir).find((n) => n.name === name)!
}
function findDataType(ir: SchemaIR, name: string): DataTypeDef {
  return ir.data_types.find((d) => d.name === name)!
}
function findMethod(defs: MethodDef[], name: string): MethodDef {
  return defs.find((m) => m.name === name)!
}

// ─── Parser Tests ───────────────────────────────────────────

describe('Parser — Data Declarations', () => {
  it('parses a top-level structured data declaration', () => {
    const [d] = decls(`data Payload = { code: String, size: Int }`)
    expect(d.kind).toBe('DataDecl')
    const data = d as DataDeclNode
    expect(data.dataKeyword.text).toBe('data')
    expect(data.name.text).toBe('Payload')
    expect(data.eq).not.toBeNull()
    expect(data.eq!.kind).toBe('Eq')
    expect(data.lbrace).not.toBeNull()
    expect(data.rbrace).not.toBeNull()
    expect(data.fields).toHaveLength(2)
    expect(data.fields[0].name.text).toBe('code')
    expect(data.fields[1].name.text).toBe('size')
    expect(data.typeExpr).toBeNull()
  })

  it('parses a top-level scalar data declaration', () => {
    const [d] = decls(`data Blob = ByteString`)
    expect(d.kind).toBe('DataDecl')
    const data = d as DataDeclNode
    expect(data.name.text).toBe('Blob')
    expect(data.eq).not.toBeNull()
    expect(data.typeExpr).not.toBeNull()
    expect(data.typeExpr!.kind).toBe('NamedType')
    expect(data.lbrace).toBeNull()
    expect(data.rbrace).toBeNull()
    expect(data.fields).toHaveLength(0)
  })

  it('parses inline data declaration in a class body', () => {
    const [d] = decls(`class Op { data OpData = { code: String } }`)
    expect(d.kind).toBe('ClassDecl')
    const cls = d as ClassDeclNode
    expect(cls.body).not.toBeNull()
    expect(cls.body!.dataDecls).toHaveLength(1)
    const inlineData = cls.body!.dataDecls[0]
    expect(inlineData.kind).toBe('DataDecl')
    expect(inlineData.name.text).toBe('OpData')
    expect(inlineData.eq).not.toBeNull()
    expect(inlineData.lbrace).not.toBeNull()
    expect(inlineData.fields).toHaveLength(1)
    expect(inlineData.fields[0].name.text).toBe('code')
  })

  it('parses data reference in a class body', () => {
    const d = decls(`data Payload = { code: String }\nclass Op { data Payload }`)
    expect(d).toHaveLength(2)
    const cls = d[1] as ClassDeclNode
    expect(cls.body).not.toBeNull()
    expect(cls.body!.dataRefs).toHaveLength(1)
    const ref = cls.body!.dataRefs[0]
    expect(ref.kind).toBe('DataRef')
    expect(ref.dataKeyword.text).toBe('data')
    expect(ref.name.text).toBe('Payload')
    expect(cls.body!.dataDecls).toHaveLength(0)
  })

  it('data: attribute coexists with inline data decl', () => {
    const [d] = decls(`class Op { data: String  data OpData = { code: String } }`)
    const cls = d as ClassDeclNode
    expect(cls.body!.attributes).toHaveLength(1)
    expect(cls.body!.attributes[0].name.text).toBe('data')
    expect(cls.body!.dataDecls).toHaveLength(1)
    expect(cls.body!.dataDecls[0].name.text).toBe('OpData')
  })

  it('parses multiple data declarations in one body', () => {
    const [d] = decls(`class Op { data A = { x: String } data B = { y: Int } }`)
    const cls = d as ClassDeclNode
    expect(cls.body!.dataDecls).toHaveLength(2)
    expect(cls.body!.dataDecls[0].name.text).toBe('A')
    expect(cls.body!.dataDecls[1].name.text).toBe('B')
  })

  it('parses a data declaration with empty body', () => {
    const [d] = decls(`data Empty = {}`)
    const data = d as DataDeclNode
    expect(data.name.text).toBe('Empty')
    expect(data.lbrace).not.toBeNull()
    expect(data.rbrace).not.toBeNull()
    expect(data.fields).toHaveLength(0)
  })

  it('parses data with list fields', () => {
    const [d] = decls(`data Info = { tags: String[] }`)
    const data = d as DataDeclNode
    expect(data.fields).toHaveLength(1)
    expect(data.fields[0].name.text).toBe('tags')
    expect(data.fields[0].listSuffix).not.toBeNull()
    expect(data.fields[0].listSuffix!.lbracket).toBeDefined()
    expect(data.fields[0].listSuffix!.rbracket).toBeDefined()
  })

  it('parses data with nullable fields', () => {
    const [d] = decls(`data Info = { name: String? }`)
    const data = d as DataDeclNode
    expect(data.fields).toHaveLength(1)
    expect(data.fields[0].name.text).toBe('name')
    expect(data.fields[0].nullable).not.toBeNull()
    expect(data.fields[0].nullable!.text).toBe('?')
  })

  it('parses data with default values', () => {
    const [d] = decls(`data Config = { retries: Int = 3 }`)
    const data = d as DataDeclNode
    expect(data.fields).toHaveLength(1)
    expect(data.fields[0].name.text).toBe('retries')
    expect(data.fields[0].defaultValue).not.toBeNull()
    expect(data.fields[0].defaultValue!.kind).toBe('DefaultValue')
    expect(data.fields[0].defaultValue!.expression.token.text).toBe('3')
  })
})

describe('Parser — Brace Projections', () => {
  it('parses method with {*} projection', () => {
    const [d] = decls(`class Foo { fn get(): Op { * } }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.projection).not.toBeNull()
    expect(m.projection!.star).not.toBeNull()
    expect(m.projection!.items).toHaveLength(0)
  })

  it('parses method with {name, code} projection', () => {
    const [d] = decls(`class Foo { fn get(): Op { name, code } }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.projection).not.toBeNull()
    expect(m.projection!.star).toBeNull()
    expect(m.projection!.items).toHaveLength(2)
    expect(m.projection!.items[0].text).toBe('name')
    expect(m.projection!.items[1].text).toBe('code')
  })

  it('parses method with {*, OpData} projection', () => {
    const [d] = decls(`class Foo { fn get(): Op { *, OpData } }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.projection).not.toBeNull()
    expect(m.projection!.star).not.toBeNull()
    expect(m.projection!.items).toHaveLength(1)
    expect(m.projection!.items[0].text).toBe('OpData')
  })

  it('parses method with {name, OpData} projection', () => {
    const [d] = decls(`class Foo { fn get(): Op { name, OpData } }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.projection).not.toBeNull()
    expect(m.projection!.star).toBeNull()
    expect(m.projection!.items).toHaveLength(2)
    expect(m.projection!.items[0].text).toBe('name')
    expect(m.projection!.items[1].text).toBe('OpData')
  })

  it('parses method with {OpData} projection (data type only)', () => {
    const [d] = decls(`class Foo { fn get(): Op { OpData } }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.projection).not.toBeNull()
    expect(m.projection!.star).toBeNull()
    expect(m.projection!.items).toHaveLength(1)
    expect(m.projection!.items[0].text).toBe('OpData')
  })

  it('parses projection with list suffix after braces', () => {
    const [d] = decls(`class Foo { fn list(): Op { name }[] }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.projection).not.toBeNull()
    expect(m.projection!.items).toHaveLength(1)
    expect(m.projection!.items[0].text).toBe('name')
    expect(m.listSuffix).not.toBeNull()
  })

  it('method without projection has null projection', () => {
    const [d] = decls(`class Foo { fn get(): Op }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.projection).toBeNull()
  })

  it('projection does NOT fire after nullable return type', () => {
    const source = `class Foo { fn get(): Op? }
class Bar { name: String }`
    const d = decls(source)
    const cls = d[0] as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.nullable).not.toBeNull()
    expect(m.projection).toBeNull()
    // Bar should parse cleanly — the { from Bar body is not stolen
    expect(d).toHaveLength(2)
  })

  it('`data` keyword as a field name in value type parses as field', () => {
    const [d] = decls(`type Foo = { data: String }`)
    expect(d.kind).toBe('ValueTypeDecl')
  })

  it('parses empty projection { }', () => {
    const [d] = decls(`class Foo { fn get(): Op { } }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.projection).not.toBeNull()
    expect(m.projection!.star).toBeNull()
    expect(m.projection!.items).toHaveLength(0)
  })
})

// ─── Lowering Tests ─────────────────────────────────────────

describe('Lowering — Data Declarations', () => {
  it('standalone structured data lowers to DataDecl with fields', () => {
    const declarations = ast(`data Payload = { code: String, size: Int }`)
    expect(declarations).toHaveLength(1)
    const d = declarations[0] as DataDecl
    expect(d.kind).toBe('DataDecl')
    expect(d.name.value).toBe('Payload')
    expect(d.fields).not.toBeNull()
    expect(d.fields).toHaveLength(2)
    expect(d.fields![0].name.value).toBe('code')
    expect(d.fields![1].name.value).toBe('size')
    expect(d.scalarType).toBeNull()
  })

  it('standalone scalar data lowers to DataDecl with scalarType', () => {
    const declarations = ast(`data Blob = ByteString`)
    const d = declarations[0] as DataDecl
    expect(d.kind).toBe('DataDecl')
    expect(d.name.value).toBe('Blob')
    expect(d.fields).toBeNull()
    expect(d.scalarType).not.toBeNull()
    expect(d.scalarType!.kind).toBe('NamedType')
    if (d.scalarType!.kind === 'NamedType') {
      expect(d.scalarType!.name.value).toBe('ByteString')
    }
  })

  it('inline data is extracted into NodeDecl.dataDecl', () => {
    const declarations = ast(`class Op { data OpData = { code: String } }`)
    expect(declarations).toHaveLength(1)
    const node = declarations[0] as NodeDecl
    expect(node.kind).toBe('NodeDecl')
    expect(node.dataDecl).not.toBeNull()
    expect(node.dataDecl!.kind).toBe('DataDecl')
    expect(node.dataDecl!.name.value).toBe('OpData')
    expect(node.dataDecl!.fields).toHaveLength(1)
    expect(node.dataRef).toBeNull()
  })

  it('data ref is extracted into NodeDecl.dataRef', () => {
    const declarations = ast(`data Payload = { x: String }\nclass Op { data Payload }`)
    const node = declarations[1] as NodeDecl
    expect(node.kind).toBe('NodeDecl')
    expect(node.dataRef).not.toBeNull()
    expect(node.dataRef!.value).toBe('Payload')
    expect(node.dataDecl).toBeNull()
  })

  it('projection is lowered correctly: star, fields, dataRef', () => {
    const declarations = ast(`class Foo { fn get(): Op { *, name, OpData } }`)
    const node = declarations[0] as NodeDecl
    const method = node.methods[0]
    expect(method.projection).not.toBeNull()
    expect(method.projection!.star).toBe(true)
    expect(method.projection!.fields).toHaveLength(1)
    expect(method.projection!.fields[0].value).toBe('name')
    expect(method.projection!.dataRef).not.toBeNull()
    expect(method.projection!.dataRef!.value).toBe('OpData')
  })

  it('projection with only fields (no star, no data)', () => {
    const declarations = ast(`class Foo { fn get(): Op { name, code } }`)
    const node = declarations[0] as NodeDecl
    const method = node.methods[0]
    expect(method.projection).not.toBeNull()
    expect(method.projection!.star).toBe(false)
    expect(method.projection!.fields).toHaveLength(2)
    expect(method.projection!.fields[0].value).toBe('name')
    expect(method.projection!.fields[1].value).toBe('code')
    expect(method.projection!.dataRef).toBeNull()
  })

  it('projection with only dataRef (PascalCase)', () => {
    const declarations = ast(`class Foo { fn get(): Op { OpData } }`)
    const node = declarations[0] as NodeDecl
    const method = node.methods[0]
    expect(method.projection!.star).toBe(false)
    expect(method.projection!.fields).toHaveLength(0)
    expect(method.projection!.dataRef).not.toBeNull()
    expect(method.projection!.dataRef!.value).toBe('OpData')
  })

  it('data: attribute is NOT confused with data declaration', () => {
    const declarations = ast(`class Op { data: String  data OpData = { code: String } }`)
    const node = declarations[0] as NodeDecl
    expect(node.attributes).toHaveLength(1)
    expect(node.attributes[0].name.value).toBe('data')
    expect(node.dataDecl).not.toBeNull()
    expect(node.dataDecl!.name.value).toBe('OpData')
  })

  it('edge with inline data declaration', () => {
    const declarations = ast(`class Follows(source: User, target: User) { data FollowMeta = { reason: String } }`)
    expect(declarations).toHaveLength(1)
    const edge = declarations[0] as EdgeDecl
    expect(edge.kind).toBe('EdgeDecl')
    expect(edge.dataDecl).not.toBeNull()
    expect(edge.dataDecl!.name.value).toBe('FollowMeta')
    expect(edge.dataDecl!.fields).toHaveLength(1)
  })

  it('interface with data ref', () => {
    const declarations = ast(`data Metadata = { x: String }\ninterface HasMeta { data Metadata }`)
    const iface = declarations[1] as InterfaceDecl
    expect(iface.kind).toBe('InterfaceDecl')
    expect(iface.dataRef).not.toBeNull()
    expect(iface.dataRef!.value).toBe('Metadata')
    expect(iface.dataDecl).toBeNull()
  })
})

// ─── Resolver Tests ─────────────────────────────────────────

describe('Resolver — Data Declarations', () => {
  it('standalone data creates Data symbol', () => {
    const result = compile(`data Payload = { code: String }`, { prelude: KERNEL_PRELUDE })
    expect(result.diagnostics.hasErrors()).toBe(false)
    const sym = result.artifacts!.resolved.symbols.get('Payload')
    expect(sym).toBeDefined()
    expect(sym!.symbolKind).toBe('Data')
  })

  it('inline data from class body creates Data symbol', () => {
    const result = compile(`class Op { data OpData = { code: String } }`, { prelude: KERNEL_PRELUDE })
    expect(result.diagnostics.hasErrors()).toBe(false)
    const sym = result.artifacts!.resolved.symbols.get('OpData')
    expect(sym).toBeDefined()
    expect(sym!.symbolKind).toBe('Data')
  })

  it('data reference resolves to Data symbol', () => {
    const result = compile(`data Payload = { code: String }\nclass Op { data Payload }`, { prelude: KERNEL_PRELUDE })
    expect(result.diagnostics.hasErrors()).toBe(false)
    const payloadSym = result.artifacts!.resolved.symbols.get('Payload')
    expect(payloadSym).toBeDefined()
    expect(payloadSym!.symbolKind).toBe('Data')
  })

  it('unknown data reference produces R001 error', () => {
    const result = compile(`class Op { data NonExistent }`, { prelude: KERNEL_PRELUDE })
    const errors = result.diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.R_UNKNOWN_TYPE)).toBe(true)
  })

  it('data fields resolve their types', () => {
    const result = compile(`data Payload = { code: String, size: Int }`, { prelude: KERNEL_PRELUDE })
    expect(result.diagnostics.hasErrors()).toBe(false)
  })

  it('data field with unknown type produces R001', () => {
    const result = compile(`data Payload = { code: Zork }`, { prelude: KERNEL_PRELUDE })
    const errors = result.diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.R_UNKNOWN_TYPE)).toBe(true)
  })

  it('projection dataRef resolves', () => {
    const source = `
      data OpData = { x: String }
      class Op { data OpData  fn get(): Op { OpData } }
    `
    const result = compile(source, { prelude: KERNEL_PRELUDE })
    expect(result.diagnostics.hasErrors()).toBe(false)
  })
})

// ─── Validator Tests ────────────────────────────────────────

describe('Validator — Data Declarations', () => {
  it('class with both inline dataDecl AND dataRef produces V019', () => {
    const source = `
      data External = { x: String }
      class Op {
        data Inline = { code: String }
        data External
      }
    `
    const result = compile(source, { prelude: KERNEL_PRELUDE })
    const errors = result.diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_MULTIPLE_DATA_DECLS)).toBe(true)
  })

  it('dataRef pointing to a non-Data symbol produces V020', () => {
    const source = `
      class Target { name: String }
      class Op { data Target }
    `
    const result = compile(source, { prelude: KERNEL_PRELUDE })
    const errors = result.diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_DATA_REF_NOT_DATA)).toBe(true)
  })

  it('projection references unknown field → V021', () => {
    const source = `
      class Op { name: String  fn get(): Op { nonexistent } }
    `
    const result = compile(source, { prelude: KERNEL_PRELUDE })
    const errors = result.diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_PROJECTION_UNKNOWN_FIELD)).toBe(true)
  })

  it('projection references data on class without data → V022', () => {
    const source = `
      data SomeData = { x: String }
      class Op { name: String  fn get(): Op { SomeData } }
    `
    const result = compile(source, { prelude: KERNEL_PRELUDE })
    const errors = result.diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_PROJECTION_NO_DATA)).toBe(true)
  })

  it('* + named fields produces V024 warning', () => {
    const source = `
      class Op { name: String  fn get(): Op { *, name } }
    `
    const result = compile(source, { prelude: KERNEL_PRELUDE })
    const warnings = result.diagnostics.getWarnings()
    expect(warnings.some((w) => w.code === DiagnosticCodes.V_PROJECTION_REDUNDANT_STAR)).toBe(true)
  })

  it('duplicate fields in data decl produces V014', () => {
    const source = `data Payload = { code: String, code: Int }`
    const result = compile(source, { prelude: KERNEL_PRELUDE })
    const errors = result.diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.V_DUPLICATE_FIELD)).toBe(true)
  })

  it('valid data declarations produce no errors', () => {
    const source = `
      data Payload = { code: String, size: Int }
      data Blob = ByteString
      class Op { data Payload  name: String }
    `
    const result = compile(source, { prelude: KERNEL_PRELUDE })
    expect(result.diagnostics.hasErrors()).toBe(false)
  })
})

// ─── Serializer / Full Pipeline Tests ───────────────────────

describe('Serializer — Data Declarations & Projections', () => {
  it('structured data → DataTypeDef with fields, null scalar_type', () => {
    const result = compileWithKernel(`data Payload = { code: String, size: Int }`)
    expect(result.ir).not.toBeNull()
    const dt = findDataType(result.ir!, 'Payload')
    expect(dt).toBeDefined()
    expect(dt.fields).not.toBeNull()
    expect(dt.fields).toHaveLength(2)
    expect(dt.fields![0].name).toBe('code')
    expect(dt.fields![1].name).toBe('size')
    expect(dt.scalar_type).toBeNull()
  })

  it('scalar data → DataTypeDef with null fields, non-null scalar_type', () => {
    const result = compileWithKernel(`data Blob = ByteString`)
    expect(result.ir).not.toBeNull()
    const dt = findDataType(result.ir!, 'Blob')
    expect(dt).toBeDefined()
    expect(dt.fields).toBeNull()
    expect(dt.scalar_type).toBe('ByteString')
  })

  it('inline data attached to class → NodeDef.data_ref set, DataTypeDef emitted', () => {
    const result = compileWithKernel(`class Op { data OpData = { code: String } }`)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    expect(node).toBeDefined()
    expect(node.data_ref).toBe('OpData')

    const dt = findDataType(result.ir!, 'OpData')
    expect(dt).toBeDefined()
    expect(dt.fields).not.toBeNull()
    expect(dt.fields).toHaveLength(1)
    expect(dt.fields![0].name).toBe('code')
  })

  it('data ref attached to class → NodeDef.data_ref set', () => {
    const source = `
      data Payload = { code: String }
      class Op { data Payload }
    `
    const result = compileWithKernel(source)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    expect(node).toBeDefined()
    expect(node.data_ref).toBe('Payload')
  })

  it('method with no projection → projection: null in IR', () => {
    const source = `class Op { name: String  fn get(): Op }`
    const result = compileWithKernel(source)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    const method = findMethod(node.methods, 'get')
    expect(method.projection).toBeNull()
  })

  it('method with {*} → { star: true, fields: [], include_data: false }', () => {
    const source = `class Op { name: String  fn get(): Op { * } }`
    const result = compileWithKernel(source)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    const method = findMethod(node.methods, 'get')
    expect(method.projection).not.toBeNull()
    expect(method.projection!.star).toBe(true)
    expect(method.projection!.fields).toEqual([])
    expect(method.projection!.include_data).toBe(false)
  })

  it('method with {name, code} → { star: false, fields: ["name", "code"], include_data: false }', () => {
    const source = `class Op { name: String  code: String  fn get(): Op { name, code } }`
    const result = compileWithKernel(source)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    const method = findMethod(node.methods, 'get')
    expect(method.projection).not.toBeNull()
    expect(method.projection!.star).toBe(false)
    expect(method.projection!.fields).toEqual(['name', 'code'])
    expect(method.projection!.include_data).toBe(false)
  })

  it('method with {*, OpData} → { star: true, fields: [], include_data: true }', () => {
    const source = `
      data OpData = { x: String }
      class Op { data OpData  name: String  fn get(): Op { *, OpData } }
    `
    const result = compileWithKernel(source)
    // V024 warning expected for * + fields, but the result should still compile
    // Actually * + data is not a warning (V024 is * + named fields only)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    const method = findMethod(node.methods, 'get')
    expect(method.projection).not.toBeNull()
    expect(method.projection!.star).toBe(true)
    expect(method.projection!.fields).toEqual([])
    expect(method.projection!.include_data).toBe(true)
  })

  it('method with {OpData} → { star: false, fields: [], include_data: true }', () => {
    const source = `
      data OpData = { x: String }
      class Op { data OpData  name: String  fn get(): Op { OpData } }
    `
    const result = compileWithKernel(source)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    const method = findMethod(node.methods, 'get')
    expect(method.projection).not.toBeNull()
    expect(method.projection!.star).toBe(false)
    expect(method.projection!.fields).toEqual([])
    expect(method.projection!.include_data).toBe(true)
  })

  it('method with {name, OpData} → { star: false, fields: ["name"], include_data: true }', () => {
    const source = `
      data OpData = { x: String }
      class Op { data OpData  name: String  fn get(): Op { name, OpData } }
    `
    const result = compileWithKernel(source)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    const method = findMethod(node.methods, 'get')
    expect(method.projection).not.toBeNull()
    expect(method.projection!.star).toBe(false)
    expect(method.projection!.fields).toEqual(['name'])
    expect(method.projection!.include_data).toBe(true)
  })
})

// ─── Edge Cases & Adversarial ───────────────────────────────

describe('Edge Cases — Data Declarations & Projections', () => {
  it('`data` as a class name: class data {}', () => {
    // `data` followed by `{` (not an Ident) means it's not a data decl
    // but the parser dispatches on atKeyword('data') before atKeyword('class')
    // So `class data {}` should work because 'class' keyword comes first
    const [d] = decls(`class data {}`)
    expect(d.kind).toBe('ClassDecl')
    const cls = d as ClassDeclNode
    expect(cls.name.text).toBe('data')
  })

  it('`data` followed by `:` is always an attribute', () => {
    const [d] = decls(`class Foo { data: String }`)
    const cls = d as ClassDeclNode
    expect(cls.body!.attributes).toHaveLength(1)
    expect(cls.body!.attributes[0].name.text).toBe('data')
    expect(cls.body!.dataDecls).toHaveLength(0)
    expect(cls.body!.dataRefs).toHaveLength(0)
  })

  it('data decl without `=` at top level produces parser error', () => {
    const { diagnostics } = parseSource(`data Payload { code: String }`)
    expect(diagnostics.hasErrors()).toBe(true)
    const errors = diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.P_EXPECTED_TOKEN)).toBe(true)
  })

  it('projection on a method returning a scalar parses (semantically odd but legal parse)', () => {
    const [d] = decls(`class Foo { fn count(): Int { * } }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.projection).not.toBeNull()
    expect(m.projection!.star).not.toBeNull()
    expect(m.projection!.star!.kind).toBe('Star')
  })

  it('nested data fields referencing other data types', () => {
    const source = `
      data Inner = { x: Int }
      data Outer = { inner: Inner }
    `
    const result = compile(source, { prelude: KERNEL_PRELUDE })
    expect(result.diagnostics.hasErrors()).toBe(false)
    expect(result.ir).not.toBeNull()
    const outerDt = findDataType(result.ir!, 'Outer')
    expect(outerDt.fields).toHaveLength(1)
    expect(outerDt.fields![0].name).toBe('inner')
  })

  it('data declaration with same name as class → duplicate name error R002', () => {
    const source = `
      data Foo = { x: String }
      class Foo { name: String }
    `
    const result = compile(source, { prelude: KERNEL_PRELUDE })
    const errors = result.diagnostics.getErrors()
    expect(errors.some((e) => e.code === DiagnosticCodes.R_DUPLICATE_NAME)).toBe(true)
  })

  it('two classes each with their own inline data declarations both work', () => {
    const source = `
      class Alpha { data AlphaData = { x: String } }
      class Beta { data BetaData = { y: Int } }
    `
    const result = compileWithKernel(source)
    expect(result.diagnostics.hasErrors()).toBe(false)
    expect(result.ir).not.toBeNull()

    const alpha = findNode(result.ir!, 'Alpha')
    expect(alpha.data_ref).toBe('AlphaData')

    const beta = findNode(result.ir!, 'Beta')
    expect(beta.data_ref).toBe('BetaData')

    const alphaDt = findDataType(result.ir!, 'AlphaData')
    expect(alphaDt.fields).toHaveLength(1)

    const betaDt = findDataType(result.ir!, 'BetaData')
    expect(betaDt.fields).toHaveLength(1)
  })

  it('edge class with data reference', () => {
    const source = `
      data FollowMeta = { reason: String }
      class User { name: String }
      class Follows(source: User, target: User) { data FollowMeta }
    `
    const result = compileWithKernel(source)
    expect(result.diagnostics.hasErrors()).toBe(false)
    expect(result.ir).not.toBeNull()

    const edge = edges(result.ir!).find((e) => e.name === 'Follows')!
    expect(edge).toBeDefined()
    expect(edge.data_ref).toBe('FollowMeta')
  })

  it('projection on method with list return: list suffix comes after projection', () => {
    const source = `class Op { name: String  fn list(): Op { name }[] }`
    const result = compileWithKernel(source)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    const method = findMethod(node.methods, 'list')
    expect(method.projection).not.toBeNull()
    expect(method.projection!.fields).toEqual(['name'])
    expect(method.return_type).toEqual({ kind: 'List', element: { kind: 'Node', name: 'Op' } })
  })

  it('data: attribute + data ref coexist without confusion', () => {
    const source = `
      data Payload = { code: String }
      class Op { data: String  data Payload  fn get(): Op }
    `
    const result = compileWithKernel(source)
    expect(result.diagnostics.hasErrors()).toBe(false)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    expect(node.data_ref).toBe('Payload')
    expect(node.attributes).toHaveLength(1)
    expect(node.attributes[0].name).toBe('data')
  })

  it('multiple data refs in one body both parse (even if validator complains)', () => {
    const [d] = decls(`class Op { data Foo  data Bar }`)
    const cls = d as ClassDeclNode
    expect(cls.body!.dataRefs).toHaveLength(2)
    expect(cls.body!.dataRefs[0].name.text).toBe('Foo')
    expect(cls.body!.dataRefs[1].name.text).toBe('Bar')
  })

  it('data declaration with complex field types', () => {
    const source = `data Payload = { tags: String[], count: Int, label: String? }`
    const result = compileWithKernel(source)
    expect(result.ir).not.toBeNull()
    const dt = findDataType(result.ir!, 'Payload')
    expect(dt.fields).toHaveLength(3)
    expect(dt.fields![0].name).toBe('tags')
    expect(dt.fields![0].type).toEqual({ kind: 'List', element: { kind: 'Scalar', name: 'String' } })
    expect(dt.fields![1].name).toBe('count')
    expect(dt.fields![2].name).toBe('label')
    expect(dt.fields![2].nullable).toBe(true)
  })

  it('interface with inline data declaration', () => {
    const source = `interface Trackable { data TrackData = { event: String } }`
    const result = compileWithKernel(source)
    expect(result.diagnostics.hasErrors()).toBe(false)
    expect(result.ir).not.toBeNull()

    const trackable = findNode(result.ir!, 'Trackable')
    expect(trackable.abstract).toBe(true)
    expect(trackable.data_ref).toBe('TrackData')

    const dt = findDataType(result.ir!, 'TrackData')
    expect(dt.fields).toHaveLength(1)
    expect(dt.fields![0].name).toBe('event')
  })

  it('projection star with both fields and data ref emits correct IR plus warning', () => {
    const source = `
      data OpData = { x: String }
      class Op { data OpData  name: String  fn get(): Op { *, name, OpData } }
    `
    const result = compileWithKernel(source)
    // Should still produce IR (warning, not error)
    expect(result.ir).not.toBeNull()

    const warnings = result.diagnostics.getWarnings()
    expect(warnings.some((w) => w.code === DiagnosticCodes.V_PROJECTION_REDUNDANT_STAR)).toBe(true)

    const node = findNode(result.ir!, 'Op')
    const method = findMethod(node.methods, 'get')
    expect(method.projection).not.toBeNull()
    expect(method.projection!.star).toBe(true)
    expect(method.projection!.fields).toEqual(['name'])
    expect(method.projection!.include_data).toBe(true)
  })

  it('empty data body produces DataTypeDef with empty fields array', () => {
    const result = compileWithKernel(`data Empty = {}`)
    expect(result.ir).not.toBeNull()
    const dt = findDataType(result.ir!, 'Empty')
    expect(dt.fields).not.toBeNull()
    expect(dt.fields).toHaveLength(0)
    expect(dt.scalar_type).toBeNull()
  })

  it('class without data has no data_ref in IR', () => {
    const source = `class Plain { name: String }`
    const result = compileWithKernel(source)
    expect(result.ir).not.toBeNull()
    const node = findNode(result.ir!, 'Plain')
    expect(node.data_ref).toBeUndefined()
  })

  it('scalar data type referenced in data field', () => {
    const source = `
      data Blob = ByteString
      data Container = { payload: Blob }
    `
    const result = compileWithKernel(source)
    expect(result.diagnostics.hasErrors()).toBe(false)
    expect(result.ir).not.toBeNull()
    const containerDt = findDataType(result.ir!, 'Container')
    expect(containerDt.fields).toHaveLength(1)
  })

  it('class with inline data + method with projection referencing that data', () => {
    const source = `
      data OpData = { reason: String }
      class Op { data OpData  name: String  fn detail(): Op { name, OpData } }
    `
    const result = compileWithKernel(source)
    expect(result.diagnostics.hasErrors()).toBe(false)
    expect(result.ir).not.toBeNull()

    const node = findNode(result.ir!, 'Op')
    expect(node.data_ref).toBe('OpData')
    const method = findMethod(node.methods, 'detail')
    expect(method.projection).not.toBeNull()
    expect(method.projection!.fields).toEqual(['name'])
    expect(method.projection!.include_data).toBe(true)
  })
})
