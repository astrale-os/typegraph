import { describe, it, expect } from 'vitest'

import { compileAndGenerate } from './helpers.js'

describe('kernel types — extend integration', () => {
  it('imported Identity is an abstract stub in output', () => {
    const { source, model } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      class User: Identity { name: String }
    `)
    expect(source).toMatch(/Identity:\s*\{[\s\S]*?abstract: true/)
    expect(source).toContain('export interface User extends Identity {')
    expect(source).toMatch(/User:[\s\S]*?implements: \['Identity'\]/)
    expect(source).not.toMatch(/SchemaNodeType.*'Identity'/)

    const identity = model.nodeDefs.get('Identity')!
    expect(identity.abstract).toBe(true)
  })

  it('kernel Node type as base allows creating edges', () => {
    const { source, model } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class A: Node {}
      class B: Node {}
      class rel(x: A, y: B) []
    `)
    const a = model.nodeDefs.get('A')!
    expect(a.implements).toContain('Node')
    expect(source).toContain('export interface A extends Node')

    const rel = model.edgeDefs.get('rel')!
    expect(rel.endpoints[0].allowed_types).toEqual([{ kind: 'Node', name: 'A' }])
    expect(rel.endpoints[1].allowed_types).toEqual([{ kind: 'Node', name: 'B' }])
  })

  it('multiple kernel imports', () => {
    const { source, model } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity, Node }
      class Admin: Identity { level: Int }
      class Resource: Node { name: String }
    `)
    const nodeType = model.nodeDefs.get('Node')
    expect(nodeType).toBeDefined()
    expect(nodeType!.abstract).toBe(true)

    expect(source).toContain('Admin: Partial<Admin>')
    expect(source).toContain('Resource: Partial<Resource>')
  })

  it('kernel prelude edge types are usable', () => {
    const { model } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Node }
      class App: Node { name: String }
      class Module: Node { name: String }
    `)
    expect(model.nodeDefs.has('Node')).toBe(true)
  })
})
