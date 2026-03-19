import { describe, it, expect } from 'vitest'
import { compileAndGenerate, extractSchemaEdgeBlock } from './helpers.js'

describe('edges', () => {
  it('generates edge with two endpoints', () => {
    const { source } = compileAndGenerate(`
      class A: Node {}
      class B: Node {}
      class connects(from: A, to: B) []
    `)
    expect(source).toContain('connects: { from: string; to: string }')
  })

  it('generates edge with union type endpoints', () => {
    const { source, model } = compileAndGenerate(`
      class X: Node {}
      class Y: Node {}
      class Z: Node {}
      class multi_target(source: X, target: Y | Z) []
    `)
    const edge = model.edgeDefs.get('multi_target')!
    expect(edge.endpoints[1].allowed_types).toHaveLength(2)
    expect(source).toContain('multi_target: { source: string; target: string }')
  })

  it('generates edge with single endpoint (higher-order)', () => {
    const { source } = compileAndGenerate(`
      class A: Node {}
      class B: Node {}
      class base_edge(x: A, y: B) []
      class meta(about: edge<any>) { note: String }
    `)
    expect(source).toContain('meta: { about: string }')
    expect(source).toContain('export interface MetaPayload {')
    expect(source).toContain('note: string')
  })

  it('generates edge payload with multiple attributes and defaults', () => {
    const { source } = compileAndGenerate(`
      type Role = String [in: ["viewer", "editor", "admin"]]
      class U: Node {}
      class G: Node {}
      class membership(user: U, group: G) [unique] {
        role: Role = "viewer",
        joined_at: Timestamp = now(),
        notes: String?
      }
    `)
    expect(source).toContain('export interface MembershipPayload {')
    expect(source).toContain('role: Role')
    expect(source).toContain('joined_at: string')
    expect(source).toContain('notes?: string | null')
    expect(source).toContain("role: z.enum(RoleValues).default('viewer'),")
    expect(source).toContain('notes: z.string().nullable().optional(),')
  })

  it('generates edge constraints in schema value', () => {
    const { source } = compileAndGenerate(`
      class A: Node {}
      class self_ref(x: A, y: A) [no_self, acyclic, unique, on_kill_target: cascade]
    `)
    expect(source).toContain('no_self: true')
    expect(source).toContain('acyclic: true')
    expect(source).toContain('unique: true')
    expect(source).toContain("on_kill_target: 'cascade'")
  })

  it('generates cardinality in schema value', () => {
    const { source } = compileAndGenerate(`
      class A: Node {}
      class limited(src: A, tgt: A) [src -> 0..10, tgt -> 1]
    `)
    expect(source).toContain('cardinality: { min: 0, max: 10 }')
    expect(source).toContain('cardinality: { min: 1, max: 1 }')
  })

  it('edge without payload does NOT get a payload interface', () => {
    const { source } = compileAndGenerate(`
      class A: Node {}
      class simple(x: A, y: A) []
    `)
    expect(source).not.toContain('SimplePayload')
  })
})

describe('edge inheritance — polymorphic endpoints', () => {
  it('edge between interfaces records interface types in schema value', () => {
    const { source, model } = compileAndGenerate(`
      interface Connectable: Node { label: String }
      class Alpha: Connectable { a: Int }
      class Beta: Connectable { b: Int }
      class link(src: Connectable, tgt: Connectable) []
    `)
    const edgeBlock = extractSchemaEdgeBlock(source, 'link')
    expect(edgeBlock).toContain("types: ['Connectable']")

    expect(source).toMatch(/Alpha:[\s\S]*?implements: \['Connectable'\]/)
    expect(source).toMatch(/Beta:[\s\S]*?implements: \['Connectable'\]/)

    const alpha = model.nodeDefs.get('Alpha')!
    expect(alpha.implements).toContain('Connectable')
  })

  it('edge between imported kernel type + user types', () => {
    const { source, model } = compileAndGenerate(`
      extend "https://kernel.astrale.ai/v1" { Identity }
      class User: Identity { name: String }
      class Bot: Identity { model: String }
      class interacts(actor: Identity, target: Identity) []
    `)
    const edgeBlock = extractSchemaEdgeBlock(source, 'interacts')
    expect(edgeBlock).toContain("types: ['Identity']")

    expect(model.nodeDefs.get('User')!.implements).toContain('Identity')
    expect(model.nodeDefs.get('Bot')!.implements).toContain('Identity')

    expect(source).toMatch(/Identity:\s*\{[\s\S]*?abstract: true/)
  })

  it('edge with union of concrete + interface endpoints', () => {
    const { source } = compileAndGenerate(`
      interface Taggable: Node {}
      class Post: Taggable { title: String }
      class Comment: Node { body: String }
      class tagged(target: Taggable | Comment, tag: Post) []
    `)
    const edgeDef = extractSchemaEdgeBlock(source, 'tagged')
    expect(edgeDef).toContain("'Taggable'")
    expect(edgeDef).toContain("'Comment'")
  })

  it('concrete class satisfying interface endpoint appears with correct implements', () => {
    const { model } = compileAndGenerate(`
      interface Ownable: Node {}
      interface Shareable: Node {}
      class Document: Ownable, Shareable { title: String }
      class owned_by(item: Ownable, owner: Document) []
      class shared_via(item: Shareable, target: Document) []
    `)
    const doc = model.nodeDefs.get('Document')!
    expect(doc.implements).toContain('Ownable')
    expect(doc.implements).toContain('Shareable')

    const ownedBy = model.edgeDefs.get('owned_by')!
    expect(ownedBy.endpoints[0].allowed_types).toEqual([{ kind: 'Node', name: 'Ownable' }])
    const sharedVia = model.edgeDefs.get('shared_via')!
    expect(sharedVia.endpoints[0].allowed_types).toEqual([{ kind: 'Node', name: 'Shareable' }])
  })
})
