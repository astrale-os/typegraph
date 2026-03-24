import { describe, it, expect } from 'vitest'

import { compileAndGenerate } from './helpers.js'

describe('nodes', () => {
  it('generates interface for node with all attribute types', () => {
    const { source } = compileAndGenerate(`
      class Everything {
        text: String,
        count: Int,
        score: Float,
        active: Boolean,
        created: Timestamp
      }
    `)
    expect(source).toContain('export interface Everything {')
    expect(source).toContain('text: string')
    expect(source).toContain('count: number')
    expect(source).toContain('score: number')
    expect(source).toContain('active: boolean')
    expect(source).toContain('created: string')
  })

  it('handles nullable attributes correctly', () => {
    const { source } = compileAndGenerate(`
      class WithNullables {
        required: String,
        optional: String?,
        also_required: Int
      }
    `)
    expect(source).toContain('required: string')
    expect(source).toContain('optional?: string | null')
    expect(source).toContain('also_required: number')
    expect(source).toContain('optional: z.string().nullable().optional(),')
  })

  it('handles defaults in validators', () => {
    const { source } = compileAndGenerate(`
      class WithDefaults {
        name: String = "untitled",
        count: Int = 0,
        active: Boolean = true,
        ts: Timestamp = now()
      }
    `)
    expect(source).toContain("name: z.string().default('untitled'),")
    expect(source).toContain('count: z.number().int().default(0),')
    expect(source).toContain('active: z.boolean().default(true),')
    expect(source).toContain('ts: z.string(),')
  })

  it('generates empty interface for attributeless node', () => {
    const { source } = compileAndGenerate(`class Marker {}`)
    expect(source).toContain('export interface Marker {}')
  })

  it('generates schema value with attribute list', () => {
    const { source } = compileAndGenerate(`
      class Item { name: String, quantity: Int }
    `)
    expect(source).toContain("attributes: ['name', 'quantity']")
  })
})
