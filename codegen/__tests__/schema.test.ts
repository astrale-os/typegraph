import { describe, it, expect } from 'vitest'
import { compileAndGenerate } from './helpers.js'

describe('schema types', () => {
  it('only includes concrete non-imported nodes in SchemaNodeType', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      interface Base { x: Int }
      class Concrete: Base {}
      class Another: Identity {}
    `)
    expect(source).toContain("export type SchemaNodeType = 'Concrete' | 'Another'")
    expect(source).not.toMatch(/SchemaNodeType.*'Base'/)
    expect(source).not.toMatch(/SchemaNodeType.*'Identity'/)
  })

  it('includes all edges in SchemaEdgeType', () => {
    const { source } = compileAndGenerate(`
      class A: Node {}
      class edge_one(x: A, y: A) []
      class edge_two(x: A, y: A) []
    `)
    expect(source).toContain("export type SchemaEdgeType = 'edge_one' | 'edge_two'")
  })

  it('emits SchemaType as union of both', () => {
    const { source } = compileAndGenerate(`
      class Foo: Node {}
      class link(a: Foo, b: Foo) []
    `)
    expect(source).toContain('export type SchemaType = SchemaNodeType | SchemaEdgeType')
  })

  it('omits SchemaNodeType when no concrete nodes', () => {
    const { source } = compileAndGenerate(`
      interface OnlyAbstract { x: Int }
    `)
    expect(source).not.toContain('SchemaNodeType')
  })
})

describe('schema value', () => {
  it('includes abstract flag correctly', () => {
    const { source } = compileAndGenerate(`
      interface Abs { x: Int }
      class Con: Abs { y: Int }
    `)
    expect(source).toMatch(/Abs:\s*\{[\s\S]*?abstract: true/)
    expect(source).toMatch(/Con:\s*\{[\s\S]*?abstract: false/)
  })

  it('lists implements in schema value', () => {
    const { source } = compileAndGenerate(`
      interface A {}
      interface B {}
      class C: A, B { x: Int }
    `)
    expect(source).toMatch(/C:[\s\S]*?implements: \['A', 'B'\]/)
  })

  it('includes all scalars', () => {
    const { source } = compileAndGenerate(`class Empty {}`)
    expect(source).toContain("'String'")
    expect(source).toContain("'Int'")
    expect(source).toContain("'Float'")
    expect(source).toContain("'Boolean'")
    expect(source).toContain("'Timestamp'")
  })
})
