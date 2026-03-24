import { describe, it, expect } from 'vitest'

import { load, ConflictError, normalizeIR } from '../src/loader.js'
import { compileKRL, mergeAndGenerate } from './helpers.js'

describe('schema merging', () => {
  it('merges two schemas with distinct definitions', () => {
    const { source } = mergeAndGenerate(`class Alpha { name: String }`, `class Beta { count: Int }`)
    expect(source).toContain('export interface Alpha {')
    expect(source).toContain('export interface Beta {')
    expect(source).toContain("'Alpha' | 'Beta'")
  })

  it('deduplicates identical definitions silently', () => {
    const { source } = mergeAndGenerate(`class Same { x: String }`, `class Same { x: String }`)
    expect(source).toContain('export interface Same {')
    const matches = source.match(/export interface Same/g)
    expect(matches).toHaveLength(1)
  })

  it('throws on conflicting definitions in strict mode', () => {
    const ir1 = compileKRL(`class Conflict { x: String }`)
    const ir2 = compileKRL(`class Conflict { x: Int }`)
    expect(() =>
      load([
        normalizeIR(ir1 as unknown as Record<string, unknown>),
        normalizeIR(ir2 as unknown as Record<string, unknown>),
      ]),
    ).toThrow(ConflictError)
  })

  it('merges shared type aliases (identical = dedup)', () => {
    const { source } = mergeAndGenerate(
      `type Email = String [format: email]`,
      `type Email = String [format: email]`,
    )
    const emailCount = (source.match(/export type Email/g) || []).length
    expect(emailCount).toBe(1)
  })

  it('merges enums from both schemas', () => {
    const { source } = mergeAndGenerate(
      `type Color = String [in: ["red", "green"]]`,
      `type Size = String [in: ["s", "m", "l"]]`,
    )
    expect(source).toContain('ColorValues')
    expect(source).toContain('SizeValues')
  })
})
