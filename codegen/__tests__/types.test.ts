import { describe, it, expect } from 'vitest'

import { compileAndGenerate } from './helpers.js'

describe('enums', () => {
  it('generates const tuple + type for enum aliases', () => {
    const { source } = compileAndGenerate(`
      type Color = String [in: ["red", "green", "blue"]]
    `)
    expect(source).toContain("export const ColorValues = ['red', 'green', 'blue'] as const")
    expect(source).toContain('export type Color = (typeof ColorValues)[number]')
  })

  it('generates validators using the enum const reference', () => {
    const { source } = compileAndGenerate(`
      type Priority = String [in: ["low", "medium", "high", "critical"]]
    `)
    expect(source).toContain('Priority: z.enum(PriorityValues),')
  })

  it('handles single-value enums', () => {
    const { source } = compileAndGenerate(`
      type Singleton = String [in: ["only"]]
    `)
    expect(source).toContain("export const SingletonValues = ['only'] as const")
  })

  it('handles many enum values', () => {
    const { source } = compileAndGenerate(`
      type Weekday = String [in: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]]
    `)
    const match = source.match(/WeekdayValues = \[(.*?)\] as const/)
    expect(match).toBeTruthy()
    const values = match![1].split(',').map((v) => v.trim().replace(/'/g, ''))
    expect(values).toHaveLength(7)
  })
})

describe('type aliases', () => {
  it('generates constrained type aliases', () => {
    const { source } = compileAndGenerate(`
      type Email = String [format: email]
      type Url = String [format: url]
      type Uuid = String [format: uuid]
    `)
    expect(source).toContain('export type Email = string')
    expect(source).toContain('export type Url = string')
    expect(source).toContain('export type Uuid = string')
    expect(source).toContain('/** String with format: email */')
    expect(source).toContain('Email: z.string().email(),')
    expect(source).toContain('Url: z.string().url(),')
    expect(source).toContain('Uuid: z.string().uuid(),')
  })

  it('generates length-constrained aliases', () => {
    const { source } = compileAndGenerate(`
      type ShortText = String [length: 1..280]
    `)
    expect(source).toContain('ShortText: z.string().min(1).max(280),')
  })

  it('generates pattern-constrained aliases', () => {
    const { source } = compileAndGenerate(`
      type Slug = String [format: slug]
    `)
    expect(source).toContain('export type Slug = string')
  })

  it('separates enums from plain aliases', () => {
    const { source } = compileAndGenerate(`
      type Email = String [format: email]
      type Color = String [in: ["red", "blue"]]
    `)
    const enumSection = source.indexOf('Enums')
    const aliasSection = source.indexOf('Type Aliases')
    expect(enumSection).toBeLessThan(aliasSection)
    expect(source).toContain('export type Email = string')
    expect(source).toContain("export const ColorValues = ['red', 'blue'] as const")
  })
})
