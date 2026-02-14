import { describe, it, expect } from 'vitest'
import { compileAndGenerate, extractValidatorBlock } from './helpers.js'

describe('inheritance', () => {
  it('flattens deep 3-level chain', () => {
    const { source } = compileAndGenerate(`
      interface Base { id: String }
      interface Middle: Base { rank: Int }
      interface Leaf: Middle { tag: String }
      class Concrete: Leaf { name: String }
    `)
    expect(source).toContain('Concrete: z.object({')
    expect(source).toMatch(/Concrete: z\.object\(\{[\s\S]*?id:[\s\S]*?rank:[\s\S]*?tag:[\s\S]*?name:[\s\S]*?\}\)/)
  })

  it('handles diamond inheritance without duplicate attributes', () => {
    const { source, model } = compileAndGenerate(`
      interface HasId { id: String }
      interface Left: HasId { left_val: Int }
      interface Right: HasId { right_val: Int }
      class Diamond: Left, Right { own: String }
    `)
    const diamondNode = model.nodeDefs.get('Diamond')!
    const idAttrs = diamondNode.allAttributes.filter((a) => a.name === 'id')
    expect(idAttrs).toHaveLength(1)

    const validatorBlock = extractValidatorBlock(source, 'Diamond')
    const idCount = (validatorBlock.match(/\bid:/g) || []).length
    expect(idCount).toBe(1)
  })

  it('child attribute overrides inherited with same name', () => {
    const { model } = compileAndGenerate(`
      interface Parent { name: String? }
      class Child: Parent { name: String }
    `)
    const child = model.nodeDefs.get('Child')!
    const name = child.allAttributes.find((a) => a.name === 'name')!
    expect(name.nullable).toBe(false)
  })

  it('generates extends clause for abstract interfaces', () => {
    const { source } = compileAndGenerate(`
      interface A { x: Int }
      interface B: A { y: Int }
    `)
    expect(source).toContain('export interface A {')
    expect(source).toContain('export interface B extends A {')
  })

  it('schema with only abstract interfaces — no concrete nodes', () => {
    const { source, model } = compileAndGenerate(`
      interface A { x: Int }
      interface B: A { y: Int }
    `)
    expect(source).not.toContain('SchemaNodeType')
    expect(model.nodeDefs.get('A')!.abstract).toBe(true)
    expect(model.nodeDefs.get('B')!.abstract).toBe(true)
  })
})
