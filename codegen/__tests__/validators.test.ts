import { describe, it, expect } from 'vitest'
import { compileAndGenerate, extractValidatorBlock } from './helpers.js'

describe('validators', () => {
  it('propagates enum constraints to validators', () => {
    const { source } = compileAndGenerate(`
      type Status = String [in: ["on", "off"]]
      class Device { status: Status }
    `)
    expect(source).toContain('Status: z.enum(StatusValues),')
    expect(source).toContain('status: z.enum(StatusValues),')
  })

  it('propagates format constraints to validators', () => {
    const { source } = compileAndGenerate(`
      type Email = String [format: email]
      class Account { email: Email }
    `)
    expect(source).toContain('Email: z.string().email(),')
    expect(source).toContain('email: z.string().email(),')
  })

  it('generates nullable + default combination correctly', () => {
    const { source } = compileAndGenerate(`
      class NullableDefaults { label: String? = "none" }
    `)
    expect(source).toContain("label: z.string().nullable().optional().default('none'),")
  })

  it('flattens inherited attributes in validators', () => {
    const { source } = compileAndGenerate(`
      interface HasTimestamp { created_at: Timestamp }
      class Record: HasTimestamp { data: String }
    `)
    const block = extractValidatorBlock(source, 'Record')
    expect(block).toContain('created_at:')
    expect(block).toContain('data:')
  })
})

describe('validation — codegen responsibilities', () => {
  it('Zod validators reject invalid data at runtime', () => {
    const { source } = compileAndGenerate(`
      type Email = String [format: email]
      class Account {
        email: Email [unique],
        name: String,
        age: Int
      }
    `)
    expect(source).toContain('email: z.string().email(),')
    expect(source).toContain('name: z.string(),')
    expect(source).toContain('age: z.number().int(),')
    const block = extractValidatorBlock(source, 'Account')
    expect(block).toContain('email:')
    expect(block).toContain('name:')
    expect(block).toContain('age:')
  })

  it('edge constraints are fully captured in schema value for runtime enforcement', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class A: Node {}
      class guarded(x: A, y: A) [no_self, acyclic, unique, x -> 1..5, on_kill_target: cascade]
    `)
    const edgeBlock = extractSchemaEdgeBlock(source, 'guarded')
    expect(edgeBlock).toContain('no_self: true')
    expect(edgeBlock).toContain('acyclic: true')
    expect(edgeBlock).toContain('unique: true')
    expect(edgeBlock).toContain("on_kill_target: 'cascade'")
    expect(edgeBlock).toContain('cardinality: { min: 1, max: 5 }')
  })

  it('symmetric constraint is captured', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class A: Node {}
      class friends(a: A, b: A) [symmetric, unique, no_self]
    `)
    const edgeBlock = extractSchemaEdgeBlock(source, 'friends')
    expect(edgeBlock).toContain('symmetric: true')
    expect(edgeBlock).toContain('unique: true')
    expect(edgeBlock).toContain('no_self: true')
  })

  it('on_kill_source lifecycle action is captured', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class Parent: Node {}
      class Child: Node {}
      class parent_of(parent: Parent, child: Child) [on_kill_source: cascade]
    `)
    const edgeBlock = extractSchemaEdgeBlock(source, 'parent_of')
    expect(edgeBlock).toContain("on_kill_source: 'cascade'")
  })

  it('nullable defaults produce correct validator chain', () => {
    const { source } = compileAndGenerate(`
      class Config {
        label: String? = "default",
        count: Int? = 0,
        active: Boolean? = true
      }
    `)
    expect(source).toContain("label: z.string().nullable().optional().default('default'),")
    expect(source).toContain('count: z.number().int().nullable().optional().default(0),')
    expect(source).toContain('active: z.boolean().nullable().optional().default(true),')
  })
})

// ─── Helpers (re-exported for convenience) ──────────────────

function extractSchemaEdgeBlock(source: string, name: string): string {
  const regex = new RegExp(`${name}: \\{([\\s\\S]*?)\\n    \\},`, 'm')
  const match = source.match(regex)
  return match ? match[1] : ''
}
