import { describe, it, expect } from 'vitest'

import { compileAndGenerate } from './helpers.js'

describe('core DSL', () => {
  it('generates CoreNodeProps referencing generated interfaces', () => {
    const { source } = compileAndGenerate(`
      class User { name: String, active: Boolean }
      class Item { title: String }
    `)
    expect(source).toContain('export interface CoreNodeProps {')
    expect(source).toContain('User: Partial<User>')
    expect(source).toContain('Item: Partial<Item>')
  })

  it('excludes abstract nodes from CoreNodeProps', () => {
    const { source } = compileAndGenerate(`
      interface Base { id: String }
      class Concrete: Base { name: String }
    `)
    expect(source).toContain('Concrete: Partial<Concrete>')
    expect(source).not.toMatch(/CoreNodeProps[\s\S]*?Base: Partial/)
  })

  it('generates CoreEdgeEndpoints with all param names', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class A: Node {}
      class B: Node {}
      class C: Node {}
      class triple_ref(alpha: A, beta: B | C, gamma: C) []
    `)
    expect(source).toContain('triple_ref: { alpha: string; beta: string; gamma: string }')
  })

  it('generates CoreEdgeProps only for edges with attributes', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class X: Node {}
      class with_payload(a: X, b: X) [] { weight: Float }
      class without_payload(a: X, b: X) []
    `)
    expect(source).toContain('export interface CoreEdgeProps {')
    expect(source).toContain('with_payload: Partial<WithPayloadPayload>')
    expect(source).not.toMatch(/CoreEdgeProps[\s\S]*?without_payload/)
  })

  it('generates node() with overloads', () => {
    const { source } = compileAndGenerate(`class A {}`)
    expect(source).toMatch(/export function node<T extends SchemaNodeType>\(\s*type: T,/)
    expect(source).toMatch(
      /export function node<T extends SchemaNodeType, C extends Record<string, CoreNodeDef>>\(/,
    )
    expect(source).toContain('children: C,')
    expect(source).not.toContain('options: { children: C }')
  })

  it('generates edge() with conditional props', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class A: Node {}
      class rel(x: A, y: A) [] { note: String }
    `)
    expect(source).toContain('props?: T extends keyof CoreEdgeProps ? CoreEdgeProps[T] : never,')
  })

  it('generates defineCore with const type parameter', () => {
    const { source } = compileAndGenerate(`class A {}`)
    expect(source).toContain(
      'export function defineCore<const T extends CoreDefinition>(def: T): T',
    )
  })

  it('generates Refs type with recursive flattening', () => {
    const { source } = compileAndGenerate(`class A {}`)
    expect(source).toContain('type FlattenCoreKeys<T extends Record<string, any>>')
    expect(source).toContain('export type ExtractCoreKeys<T extends CoreDefinition>')
    expect(source).toContain('export type Refs<T extends CoreDefinition = CoreDefinition>')
  })

  it('skips Core section entirely when no concrete nodes or edges', () => {
    const { source } = compileAndGenerate(`
      interface OnlyAbstract { x: Int }
    `)
    expect(source).not.toContain('CoreNodeProps')
    expect(source).not.toContain('defineCore')
  })
})

describe('core types — runtime usage', () => {
  it('generated node() + edge() + defineCore() produce valid structures', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity, Node }
      class Application: Identity { name: String }
      class Module: Node { name: String }
      class manages(app: Application, mod: Module) []
    `)
    expect(source).toContain('Application: Partial<Application>')
    expect(source).toContain('Module: Partial<Module>')
    expect(source).toContain('manages: { app: string; mod: string }')
    expect(source).toContain("'Application'")
    expect(source).toContain("'Module'")
    expect(source).toContain("'manages'")
    expect(source).toContain('export function node<T extends SchemaNodeType>')
    expect(source).toContain('export function edge<T extends SchemaEdgeType>')
    expect(source).toContain('export function defineCore<const T extends CoreDefinition>')
    expect(source).toContain('export type Refs<T extends CoreDefinition')
  })

  it('edge without payload generates edge() without props parameter', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class A: Node {}
      class simple(x: A, y: A) []
    `)
    expect(source).not.toContain('CoreEdgeProps')
    expect(source).not.toContain('props?: T extends keyof CoreEdgeProps')
  })

  it('edge with payload generates edge() with conditional props', () => {
    const { source } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class A: Node {}
      class weighted(x: A, y: A) [] { weight: Float }
      class plain(x: A, y: A) []
    `)
    expect(source).toContain('export interface CoreEdgeProps {')
    expect(source).toContain('weighted: Partial<WeightedPayload>')
    expect(source).not.toMatch(/CoreEdgeProps[\s\S]*?plain/)
    expect(source).toContain('props?: T extends keyof CoreEdgeProps ? CoreEdgeProps[T] : never,')
  })
})
