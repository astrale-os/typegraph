import { describe, it, expect } from 'vitest'
import { compileAndGenerate } from './helpers.js'

describe('edge cases', () => {
  it('empty schema produces minimal output', () => {
    const { source } = compileAndGenerate('')
    expect(source).toContain('@generated')
    expect(source).toContain("import { z } from 'zod'")
    expect(source).not.toContain('export interface')
  })

  it('single attributeless node', () => {
    const { source } = compileAndGenerate('class Singleton {}')
    expect(source).toContain('export interface Singleton {}')
    expect(source).toContain('Singleton: z.object({')
    expect(source).toContain("export type SchemaNodeType = 'Singleton'")
  })

  it('many nodes and edges stress test', () => {
    const extend = 'extend "https://kernel.astrale.ai/v1" { Node }'
    const nodes = Array.from(
      { length: 10 },
      (_, i) => `class N${i}: Node { val${i}: String }`,
    ).join('\n')
    const edges = Array.from(
      { length: 5 },
      (_, i) => `class e${i}(a: N${i * 2}, b: N${i * 2 + 1}) []`,
    ).join('\n')
    const { source, model } = compileAndGenerate(`${extend}\n${nodes}\n${edges}`)
    expect(model.nodeDefs.size).toBeGreaterThanOrEqual(10)
    expect(model.edgeDefs.size).toBe(5)
    for (let i = 0; i < 10; i++) {
      expect(source).toContain(`export interface N${i}`)
    }
  })

  it('node referencing alias type in attribute', () => {
    const { source } = compileAndGenerate(`
      type Email = String [format: email]
      class User {
        primary_email: Email,
        backup_email: Email?
      }
    `)
    expect(source).toContain('primary_email: Email')
    expect(source).toContain('backup_email?: Email | null')
  })

  it('attribute modifiers appear in schema value', () => {
    const { source } = compileAndGenerate(`
      class Item {
        code: String [unique, indexed: asc],
        label: String [readonly]
      }
    `)
    expect(source).toContain("attributes: ['code', 'label']")
  })
})
