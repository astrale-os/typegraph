// src/methods.test.ts
// ============================================================
// Compiler tests for KRL method declarations.
// ============================================================

import { describe, it, expect } from 'vitest'
import { lex } from './lexer'
import { parse } from './parser/index'
import { lower } from './lower/index'
import { compile } from './compile'
import { KERNEL_PRELUDE } from './prelude'
import { buildKernelRegistry } from './kernel-prelude'

const kernelRegistry = buildKernelRegistry()
import { type ClassDeclNode, type InterfaceDeclNode, type MethodNode } from './cst/index'
import { type InterfaceDecl, type NodeDecl, type EdgeDecl } from './ast/index'
import { type SchemaIR, type NodeDef, type EdgeDef, type MethodDef } from './ir/index'
import { DiagnosticBag } from './diagnostics'

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
function edges(ir: SchemaIR): EdgeDef[] {
  return ir.classes.filter((c): c is EdgeDef => c.type === 'edge')
}
function findNode(ir: SchemaIR, name: string): NodeDef {
  return nodes(ir).find((n) => n.name === name)!
}
function findEdge(ir: SchemaIR, name: string): EdgeDef {
  return edges(ir).find((e) => e.name === name)!
}
function findMethod(defs: MethodDef[], name: string): MethodDef {
  return defs.find((m) => m.name === name)!
}

// ─── Parser Tests ───────────────────────────────────────────

describe('Parser — Methods', () => {
  it('parses a method with no params', () => {
    const [d] = decls(`interface Foo { fn greet(): String }`)
    const iface = d as InterfaceDeclNode
    expect(iface.body!.methods).toHaveLength(1)
    const m = iface.body!.methods[0]
    expect(m.kind).toBe('Method')
    expect(m.name.text).toBe('greet')
    expect(m.params).toHaveLength(0)
    expect(m.listSuffix).toBeNull()
    expect(m.nullable).toBeNull()
  })

  it('parses a method with params', () => {
    const [d] = decls(`class Foo { fn canPurchase(product: Product, qty: Int): Boolean }`)
    const cls = d as ClassDeclNode
    expect(cls.body!.methods).toHaveLength(1)
    const m = cls.body!.methods[0]
    expect(m.name.text).toBe('canPurchase')
    expect(m.params).toHaveLength(2)
    expect(m.params[0].name.text).toBe('product')
    expect(m.params[1].name.text).toBe('qty')
  })

  it('parses a method with default param', () => {
    const [d] = decls(`class Foo { fn list(limit: Int = 10): String }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.params[0].defaultValue).not.toBeNull()
  })

  it('parses a method with list return type', () => {
    const [d] = decls(`class Foo { fn items(): Item[] }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.listSuffix).not.toBeNull()
    expect(m.nullable).toBeNull()
  })

  it('parses a method with nullable return type', () => {
    const [d] = decls(`class Foo { fn maybe(): String? }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.nullable).not.toBeNull()
    expect(m.listSuffix).toBeNull()
  })

  it('parses mixed attributes and methods', () => {
    const [d] = decls(`class Customer {
      email: String,
      fn displayName(): String
      name: String,
      fn canPurchase(product: Product): Boolean
    }`)
    const cls = d as ClassDeclNode
    expect(cls.body!.attributes).toHaveLength(2)
    expect(cls.body!.methods).toHaveLength(2)
    expect(cls.body!.attributes[0].name.text).toBe('email')
    expect(cls.body!.attributes[1].name.text).toBe('name')
    expect(cls.body!.methods[0].name.text).toBe('displayName')
    expect(cls.body!.methods[1].name.text).toBe('canPurchase')
  })

  it('parses methods on interface', () => {
    const [d] = decls(`interface Timestamped {
      created_at: Timestamp,
      fn age(): Int
    }`)
    const iface = d as InterfaceDeclNode
    expect(iface.body!.attributes).toHaveLength(1)
    expect(iface.body!.methods).toHaveLength(1)
  })

  it('parses method without params (empty parens)', () => {
    const [d] = decls(`class Foo { fn noParams(): Boolean }`)
    const cls = d as ClassDeclNode
    expect(cls.body!.methods[0].params).toHaveLength(0)
  })

  it('parses a public method (default) with null privateKeyword', () => {
    const [d] = decls(`class Foo { fn greet(): String }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.privateKeyword).toBeNull()
  })

  it('parses a private method', () => {
    const [d] = decls(`class Foo { private fn secret(): String }`)
    const cls = d as ClassDeclNode
    const m = cls.body!.methods[0]
    expect(m.privateKeyword).not.toBeNull()
    expect(m.name.text).toBe('secret')
  })

  it('parses mixed public and private methods', () => {
    const [d] = decls(`class Foo {
      fn publicMethod(): String
      private fn privateMethod(): Int
      fn anotherPublic(): Boolean
    }`)
    const cls = d as ClassDeclNode
    expect(cls.body!.methods).toHaveLength(3)
    expect(cls.body!.methods[0].privateKeyword).toBeNull()
    expect(cls.body!.methods[1].privateKeyword).not.toBeNull()
    expect(cls.body!.methods[2].privateKeyword).toBeNull()
  })

  it('parses private method on interface', () => {
    const [d] = decls(`interface Foo { private fn internal(): Int }`)
    const iface = d as InterfaceDeclNode
    expect(iface.body!.methods[0].privateKeyword).not.toBeNull()
  })

  it('parses private method on edge', () => {
    const [d] = decls(`class membership(user: User, org: Org) { private fn promote(): Boolean }`)
    const cls = d as ClassDeclNode
    expect(cls.body!.methods[0].privateKeyword).not.toBeNull()
    expect(cls.body!.methods[0].name.text).toBe('promote')
  })

  it('allows attribute named "private" (contextual keyword safety)', () => {
    const [d] = decls(`class Foo { private: String }`)
    const cls = d as ClassDeclNode
    expect(cls.body!.attributes).toHaveLength(1)
    expect(cls.body!.attributes[0].name.text).toBe('private')
    expect(cls.body!.methods).toHaveLength(0)
  })
})

// ─── Lowering Tests ─────────────────────────────────────────

describe('Lowering — Methods', () => {
  function lowerSource(source: string) {
    const bag = new DiagnosticBag()
    const { tokens } = lex(source, bag)
    const { cst } = parse(tokens, bag)
    const { ast } = lower(cst)
    return ast
  }

  it('lowers method to AST with correct kind', () => {
    const ast = lowerSource(`class Foo { fn greet(): String }`)
    const node = ast.declarations[0] as NodeDecl
    expect(node.methods).toHaveLength(1)
    expect(node.methods[0].kind).toBe('Method')
    expect(node.methods[0].name.value).toBe('greet')
  })

  it('extracts returnList flag', () => {
    const ast = lowerSource(`class Foo { fn items(): Item[] }`)
    const node = ast.declarations[0] as NodeDecl
    expect(node.methods[0].returnList).toBe(true)
    expect(node.methods[0].returnNullable).toBe(false)
  })

  it('extracts returnNullable flag', () => {
    const ast = lowerSource(`class Foo { fn maybe(): String? }`)
    const node = ast.declarations[0] as NodeDecl
    expect(node.methods[0].returnNullable).toBe(true)
    expect(node.methods[0].returnList).toBe(false)
  })

  it('lowers method params with types', () => {
    const ast = lowerSource(`class Foo { fn buy(product: Product, qty: Int): Boolean }`)
    const node = ast.declarations[0] as NodeDecl
    const m = node.methods[0]
    expect(m.params).toHaveLength(2)
    expect(m.params[0].name.value).toBe('product')
    expect(m.params[1].name.value).toBe('qty')
  })

  it('lowers method param defaults', () => {
    const ast = lowerSource(`class Foo { fn list(limit: Int = 10): String }`)
    const node = ast.declarations[0] as NodeDecl
    const param = node.methods[0].params[0]
    expect(param.defaultValue).not.toBeNull()
    expect(param.defaultValue!.kind).toBe('NumberLiteral')
  })

  it('lowers interface methods', () => {
    const ast = lowerSource(`interface Timestamped { fn age(): Int }`)
    const iface = ast.declarations[0] as InterfaceDecl
    expect(iface.methods).toHaveLength(1)
  })

  it('lowers edge methods', () => {
    const ast = lowerSource(`class membership(user: User, org: Org) { fn promote(): Boolean }`)
    const edge = ast.declarations[0] as EdgeDecl
    expect(edge.methods).toHaveLength(1)
    expect(edge.methods[0].name.value).toBe('promote')
  })

  it('lowers public method with access = public', () => {
    const ast = lowerSource(`class Foo { fn greet(): String }`)
    const node = ast.declarations[0] as NodeDecl
    expect(node.methods[0].access).toBe('public')
  })

  it('lowers private method with access = private', () => {
    const ast = lowerSource(`class Foo { private fn secret(): String }`)
    const node = ast.declarations[0] as NodeDecl
    expect(node.methods[0].access).toBe('private')
  })
})

// ─── Resolver Tests ─────────────────────────────────────────

describe('Resolver — Methods', () => {
  it('resolves method return types', () => {
    const { diagnostics } = compile(`
      class Customer {
        fn displayName(): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
  })

  it('resolves method param types', () => {
    const { diagnostics } = compile(`
      class Product {}
      class Customer {
        fn canPurchase(product: Product): Boolean
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
  })

  it('reports unknown type in method return', () => {
    const { diagnostics } = compile(`
      class Customer {
        fn getData(): UnknownType
      }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
  })

  it('reports unknown type in method param', () => {
    const { diagnostics } = compile(`
      class Customer {
        fn doSomething(x: UnknownType): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
  })
})

// ─── Validator Tests ────────────────────────────────────────

describe('Validator — Methods', () => {
  it('rejects duplicate method names on same type', () => {
    const { diagnostics } = compile(`
      class Foo {
        fn bar(): String
        fn bar(): Int
      }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V010')).toBe(true)
  })

  it('rejects duplicate param names within a method', () => {
    const { diagnostics } = compile(`
      class Foo {
        fn bar(x: String, x: Int): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V013')).toBe(true)
  })

  it('allows compatible override (same return type)', () => {
    const { diagnostics } = compile(`
      interface Greetable {
        fn greet(): String
      }
      class Person: Greetable {
        fn greet(): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
  })

  it('rejects incompatible override (different return type)', () => {
    const { diagnostics } = compile(`
      interface Greetable {
        fn greet(): String
      }
      class Person: Greetable {
        fn greet(): Int
      }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V011')).toBe(true)
  })

  it('allows diamond inheritance with identical methods', () => {
    const { diagnostics } = compile(`
      interface A {
        fn doIt(): String
      }
      interface B: A {}
      interface C: A {}
      class D: B, C {}
    `)
    expect(diagnostics.hasErrors()).toBe(false)
  })

  it('rejects diamond conflict with different return types', () => {
    const { diagnostics } = compile(`
      interface A {
        fn doIt(): String
      }
      interface B {
        fn doIt(): Int
      }
      class C: A, B {}
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V012')).toBe(true)
  })

  it('accepts class with no methods (empty methods list)', () => {
    const { diagnostics } = compile(`class Foo {}`)
    expect(diagnostics.hasErrors()).toBe(false)
  })

  it('allows same name for attribute and method', () => {
    const { diagnostics } = compile(`
      class Foo {
        name: String,
        fn name(): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
  })

  it('allows override with different param signature', () => {
    const { diagnostics } = compile(`
      interface Searchable {
        fn search(query: String, limit: Int): String
      }
      class Index: Searchable {
        fn search(): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
  })

  it('rejects incompatible override between interfaces', () => {
    const { diagnostics } = compile(`
      interface A {
        fn render(): String
      }
      interface B: A {
        fn render(): Int
      }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V011')).toBe(true)
  })

  it('inherits methods through grandparent chain', () => {
    const { diagnostics } = compile(`
      interface A {
        fn deepMethod(): String
      }
      interface B: A {}
      class C: B {}
    `)
    expect(diagnostics.hasErrors()).toBe(false)
  })

  it('allows narrowing access (public → private override)', () => {
    const { diagnostics } = compile(`
      interface Base {
        fn doIt(): String
      }
      class Child: Base {
        private fn doIt(): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
  })

  it('rejects widening access (private → public override)', () => {
    const { diagnostics } = compile(`
      interface Base {
        private fn doIt(): String
      }
      class Child: Base {
        fn doIt(): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V016')).toBe(true)
  })

  it('allows same access in override', () => {
    const { diagnostics } = compile(`
      interface Base {
        private fn doIt(): String
      }
      class Child: Base {
        private fn doIt(): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
  })

  it('rejects diamond with conflicting access', () => {
    const { diagnostics } = compile(`
      interface A {
        fn doIt(): String
      }
      interface B {
        private fn doIt(): String
      }
      class C: A, B {}
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V012')).toBe(true)
  })

  it('reports both widening and return-type errors simultaneously', () => {
    const { diagnostics } = compile(`
      interface Base {
        private fn doIt(): String
      }
      class Child: Base {
        fn doIt(): Int
      }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    const codes = diagnostics.getErrors().map((e) => e.code)
    expect(codes).toContain('V011')
    expect(codes).toContain('V016')
  })
})

// ─── Full Pipeline / Serializer Tests ───────────────────────

describe('Full pipeline — Methods', () => {
  it('serializes interface with methods', () => {
    const { ir, diagnostics } = compile(`
      interface Timestamped {
        created_at: Timestamp,
        fn age(): Int
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const ts = findNode(ir!, 'Timestamped')
    expect(ts.methods).toHaveLength(1)
    expect(ts.methods[0].name).toBe('age')
    expect(ts.methods[0].return_type).toEqual({ kind: 'Scalar', name: 'Int' })
    expect(ts.methods[0].return_nullable).toBe(false)
    expect(ts.methods[0].params).toHaveLength(0)
  })

  it('serializes class with own methods', () => {
    const { ir, diagnostics } = compile(`
      class Product {}
      class Customer {
        email: String,
        fn displayName(): String
        fn canPurchase(product: Product): Boolean
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const customer = findNode(ir!, 'Customer')
    expect(customer.methods).toHaveLength(2)

    const display = findMethod(customer.methods, 'displayName')
    expect(display.params).toHaveLength(0)
    expect(display.return_type).toEqual({ kind: 'Scalar', name: 'String' })

    const canPurchase = findMethod(customer.methods, 'canPurchase')
    expect(canPurchase.params).toHaveLength(1)
    expect(canPurchase.params[0].name).toBe('product')
    expect(canPurchase.params[0].type).toEqual({ kind: 'Node', name: 'Product' })
  })

  it('serializes method with list return type', () => {
    const { ir, diagnostics } = compile(`
      class Order {}
      class Customer {
        fn orders(): Order[]
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const customer = findNode(ir!, 'Customer')
    const m = customer.methods[0]
    expect(m.return_type).toEqual({
      kind: 'List',
      element: { kind: 'Node', name: 'Order' },
    })
  })

  it('serializes method with nullable return type', () => {
    const { ir, diagnostics } = compile(`
      class Customer {
        fn nickname(): String?
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const customer = findNode(ir!, 'Customer')
    const m = customer.methods[0]
    expect(m.return_nullable).toBe(true)
    // The return_type itself is the base type (not wrapped in nullable)
    expect(m.return_type).toEqual({ kind: 'Scalar', name: 'String' })
  })

  it('serializes method param defaults', () => {
    const { ir, diagnostics } = compile(`
      class Foo {
        fn list(limit: Int = 10, offset: Int = 0): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const foo = findNode(ir!, 'Foo')
    const m = foo.methods[0]
    expect(m.params[0].default).toEqual({ kind: 'NumberLiteral', value: 10 })
    expect(m.params[1].default).toEqual({ kind: 'NumberLiteral', value: 0 })
  })

  it('serializes edge with methods', () => {
    const { ir, diagnostics } = compileWithKernel(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class User: Node {}
      class Org: Node {}
      class membership(user: User, org: Org) {
        fn promote(): Boolean
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const edge = findEdge(ir!, 'membership')
    expect(edge.methods).toHaveLength(1)
    expect(edge.methods[0].name).toBe('promote')
    expect(edge.methods[0].return_type).toEqual({ kind: 'Scalar', name: 'Boolean' })
  })

  it('produces empty methods array for types without methods', () => {
    const { ir, diagnostics } = compile(`
      class Plain {
        name: String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const plain = findNode(ir!, 'Plain')
    expect(plain.methods).toEqual([])
  })

  it('serializes method with alias return type', () => {
    const { ir, diagnostics } = compile(`
      type Email = String [format: email]
      class Customer {
        fn primaryEmail(): Email
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const customer = findNode(ir!, 'Customer')
    expect(customer.methods[0].return_type).toEqual({ kind: 'Alias', name: 'Email' })
  })

  it('compiles methods with kernel prelude', () => {
    const { ir, diagnostics } = compileWithKernel(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      interface Timestamped {
        created_at: Timestamp,
        fn age(): Int
      }
      class User: Identity, Timestamped {
        name: String,
        fn displayName(): String
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const timestamped = findNode(ir!, 'Timestamped')
    expect(timestamped.methods).toHaveLength(1)
    const user = findNode(ir!, 'User')
    expect(user.methods).toHaveLength(1)
  })

  it('serializes method with multiple params of different types', () => {
    const { ir, diagnostics } = compile(`
      type Currency = String [in: ["USD", "EUR"]]
      class Account {
        fn transfer(amount: Int, currency: Currency, memo: String = "none"): Boolean
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const account = findNode(ir!, 'Account')
    const m = account.methods[0]
    expect(m.params).toHaveLength(3)
    expect(m.params[0].type).toEqual({ kind: 'Scalar', name: 'Int' })
    expect(m.params[1].type).toEqual({ kind: 'Alias', name: 'Currency' })
    expect(m.params[2].type).toEqual({ kind: 'Scalar', name: 'String' })
    expect(m.params[2].default).toEqual({ kind: 'StringLiteral', value: 'none' })
  })

  it('serializes method access to IR', () => {
    const { ir, diagnostics } = compile(`
      class Foo {
        fn publicMethod(): String
        private fn privateMethod(): Int
      }
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const foo = findNode(ir!, 'Foo')
    expect(findMethod(foo.methods, 'publicMethod').access).toBe('public')
    expect(findMethod(foo.methods, 'privateMethod').access).toBe('private')
  })

  it('inherited method preserves original access', () => {
    const { ir, diagnostics } = compile(`
      interface Base {
        fn publicFn(): String
        private fn privateFn(): Int
      }
      class Child: Base {}
    `)
    expect(diagnostics.hasErrors()).toBe(false)
    const base = findNode(ir!, 'Base')
    expect(findMethod(base.methods, 'publicFn').access).toBe('public')
    expect(findMethod(base.methods, 'privateFn').access).toBe('private')
  })
})
