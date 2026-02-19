// src/lower.test.ts
import { describe, it, expect } from 'vitest'
import { lex } from './lexer'
import { parse } from './parser/index'
import { lower } from './lower/index'
import { readFileSync } from 'fs'
import { resolve as pathResolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { DiagnosticBag } from './diagnostics'

const KERNEL_SCHEMA_SOURCE = readFileSync(
  pathResolve(dirname(fileURLToPath(import.meta.url)), '..', 'kernel.gsl'),
  'utf-8',
)
import {
  type Declaration,
  type TypeAliasDecl,
  type InterfaceDecl,
  type NodeDecl,
  type EdgeDecl,
  type ExtendDecl,
  Modifier,
  type FlagModifier,
  type FormatModifier,
  type InModifier,
  type LengthModifier,
  type IndexedModifier,
  type CardinalityModifier,
  type LifecycleModifier,
  type NamedType,
  NullableType,
  type UnionType,
  type EdgeRefType,
  type StringLiteral,
  type NumberLiteral,
  type BooleanLiteral,
  type CallExpression,
} from './ast/index'

/** Helper: source → AST declarations (no errors expected). */
function ast(source: string): Declaration[] {
  const bag = new DiagnosticBag()
  const { tokens } = lex(source, bag)
  const { cst } = parse(tokens, bag)
  const { ast, diagnostics } = lower(cst, bag)
  expect(diagnostics.hasErrors()).toBe(false)
  return ast.declarations
}

/** Get first declaration, cast to T. */
function first<T extends Declaration>(source: string): T {
  return ast(source)[0] as T
}

describe('Lowering', () => {
  // ─── Type Aliases ──────────────────────────────────────────

  describe('TypeAliasDecl', () => {
    it('lowers simple alias', () => {
      const d = first<TypeAliasDecl>('type Email = String')
      expect(d.kind).toBe('TypeAliasDecl')
      expect(d.name.value).toBe('Email')
      expect(d.type.kind).toBe('NamedType')
      expect((d.type as NamedType).name.value).toBe('String')
      expect(d.modifiers).toHaveLength(0)
    })

    it('lowers alias with format modifier', () => {
      const d = first<TypeAliasDecl>('type Email = String [format: email]')
      expect(d.modifiers).toHaveLength(1)
      const m = d.modifiers[0] as FormatModifier
      expect(m.kind).toBe('FormatModifier')
      expect(m.format).toBe('email')
    })

    it('lowers alias with in modifier', () => {
      const d = first<TypeAliasDecl>('type Plan = String [in: ["free", "pro"]]')
      expect(d.modifiers).toHaveLength(1)
      const m = d.modifiers[0] as InModifier
      expect(m.kind).toBe('InModifier')
      expect(m.values).toEqual(['free', 'pro'])
    })

    it('lowers alias with length modifier', () => {
      const d = first<TypeAliasDecl>('type Name = String [length: 1..255]')
      const m = d.modifiers[0] as LengthModifier
      expect(m.kind).toBe('LengthModifier')
      expect(m.min).toBe(1)
      expect(m.max).toBe(255)
    })
  })

  // ─── Interfaces ────────────────────────────────────────────

  describe('InterfaceDecl', () => {
    it('lowers empty interface', () => {
      const d = first<InterfaceDecl>('interface Node {}')
      expect(d.kind).toBe('InterfaceDecl')
      expect(d.name.value).toBe('Node')
      expect(d.extends).toHaveLength(0)
      expect(d.attributes).toHaveLength(0)
    })

    it('lowers interface with extends', () => {
      const d = first<InterfaceDecl>('interface Identity: Node {}')
      expect(d.extends).toHaveLength(1)
      expect(d.extends[0].value).toBe('Node')
    })

    it('lowers interface attributes with modifiers and defaults', () => {
      const d = first<InterfaceDecl>(`interface Timestamped {
        created_at: Timestamp [readonly, indexed: desc] = now(),
        updated_at: Timestamp?
      }`)
      expect(d.attributes).toHaveLength(2)

      const a0 = d.attributes[0]
      expect(a0.name.value).toBe('created_at')
      expect(a0.modifiers).toHaveLength(2)
      expect(a0.modifiers[0].kind).toBe('FlagModifier')
      expect((a0.modifiers[0] as FlagModifier).flag).toBe('readonly')
      expect(a0.modifiers[1].kind).toBe('IndexedModifier')
      expect((a0.modifiers[1] as IndexedModifier).direction).toBe('desc')
      expect(a0.defaultValue).not.toBeNull()
      expect(a0.defaultValue!.kind).toBe('CallExpression')
      expect((a0.defaultValue as CallExpression).fn.value).toBe('now')

      const a1 = d.attributes[1]
      expect(a1.type.kind).toBe('NullableType')
    })
  })

  // ─── NodeDecl ───────────────────────────────────────────

  describe('NodeDecl', () => {
    it('lowers to NodeDecl (not EdgeDecl)', () => {
      const d = first<NodeDecl>('class Class: Node {}')
      expect(d.kind).toBe('NodeDecl')
      expect(d.name.value).toBe('Class')
      expect(d.implements).toHaveLength(1)
      expect(d.implements[0].value).toBe('Node')
    })

    it('lowers class with attributes and defaults', () => {
      const d = first<NodeDecl>(`class Organization: Identity {
        plan: Plan = "free"
      }`)
      expect(d.attributes).toHaveLength(1)
      const attr = d.attributes[0]
      expect(attr.defaultValue).not.toBeNull()
      expect(attr.defaultValue!.kind).toBe('StringLiteral')
      expect((attr.defaultValue as StringLiteral).value).toBe('free')
    })

    it('lowers class with unique modifier', () => {
      const d = first<NodeDecl>(`class User {
        username: String [unique]
      }`)
      const m = d.attributes[0].modifiers[0] as FlagModifier
      expect(m.flag).toBe('unique')
    })
  })

  // ─── EdgeDecl ──────────────────────────────────────────────

  describe('EdgeDecl', () => {
    it('lowers class with signature to EdgeDecl', () => {
      const d = first<EdgeDecl>('class follows(follower: User, followee: User) [no_self, unique]')
      expect(d.kind).toBe('EdgeDecl')
      expect(d.name.value).toBe('follows')
      expect(d.params).toHaveLength(2)
      expect(d.params[0].name.value).toBe('follower')
      expect(d.params[1].name.value).toBe('followee')
    })

    it('lowers cardinality modifiers', () => {
      const d = first<EdgeDecl>(
        'class follows(follower: User, followee: User) [follower -> 0..5000]',
      )
      expect(d.modifiers).toHaveLength(1)
      const m = d.modifiers[0] as CardinalityModifier
      expect(m.kind).toBe('CardinalityModifier')
      expect(m.param.value).toBe('follower')
      expect(m.min).toBe(0)
      expect(m.max).toBe(5000)
    })

    it('lowers exact cardinality', () => {
      const d = first<EdgeDecl>('class instance_of(instance: Node, type: Class) [instance -> 1]')
      const m = d.modifiers[0] as CardinalityModifier
      expect(m.min).toBe(1)
      expect(m.max).toBe(1)
    })

    it('lowers unbounded cardinality', () => {
      const d = first<EdgeDecl>('class r(a: A, b: B) [a -> 1..*]')
      const m = d.modifiers[0] as CardinalityModifier
      expect(m.min).toBe(1)
      expect(m.max).toBeNull()
    })

    it('lowers union type parameters', () => {
      const d = first<EdgeDecl>(
        'class authored(author: User, content: Post | Comment) [content -> 1]',
      )
      const paramType = d.params[1].type
      expect(paramType.kind).toBe('UnionType')
      const ut = paramType as UnionType
      expect(ut.types).toHaveLength(2)
      expect((ut.types[0] as NamedType).name.value).toBe('Post')
      expect((ut.types[1] as NamedType).name.value).toBe('Comment')
    })

    it('lowers lifecycle modifiers', () => {
      const d = first<EdgeDecl>('class comment_on(c: Comment, t: Post) [on_kill_target: cascade]')
      const m = d.modifiers[0] as LifecycleModifier
      expect(m.kind).toBe('LifecycleModifier')
      expect(m.event).toBe('on_kill_target')
      expect(m.action).toBe('cascade')
    })

    it('lowers edge with body (attributes)', () => {
      const d = first<EdgeDecl>(`class has_perm(identity: Identity, target: Node) {
        perm: Bitmask
      }`)
      expect(d.attributes).toHaveLength(1)
      expect(d.attributes[0].name.value).toBe('perm')
    })

    it('lowers higher-order edge (edge<any>)', () => {
      const d = first<EdgeDecl>(`class flagged(about: edge<any>) {
        reason: String
      }`)
      const paramType = d.params[0].type
      expect(paramType.kind).toBe('EdgeRefType')
      expect((paramType as EdgeRefType).target).toBeNull() // any
    })

    it('lowers specific edge reference', () => {
      const d = first<EdgeDecl>('class meta(about: edge<follows>) {}')
      const paramType = d.params[0].type
      expect(paramType.kind).toBe('EdgeRefType')
      expect((paramType as EdgeRefType).target!.value).toBe('follows')
    })
  })

  // ─── ExtendDecl ────────────────────────────────────────────

  describe('ExtendDecl', () => {
    it('lowers extend with unquoted URI', () => {
      const d = first<ExtendDecl>('extend "https://kernel.astrale.ai/v1" { Identity }')
      expect(d.kind).toBe('ExtendDecl')
      expect(d.uri).toBe('https://kernel.astrale.ai/v1')
      expect(d.imports).toHaveLength(1)
      expect(d.imports[0].value).toBe('Identity')
    })
  })

  // ─── Expressions ───────────────────────────────────────────

  describe('Expressions', () => {
    it('lowers string default', () => {
      const d = first<NodeDecl>('class X { a: String = "hello" }')
      const def = d.attributes[0].defaultValue as StringLiteral
      expect(def.kind).toBe('StringLiteral')
      expect(def.value).toBe('hello')
    })

    it('lowers number default', () => {
      const d = first<NodeDecl>('class X { a: Int = 42 }')
      const def = d.attributes[0].defaultValue as NumberLiteral
      expect(def.kind).toBe('NumberLiteral')
      expect(def.value).toBe(42)
    })

    it('lowers boolean default', () => {
      const d = first<NodeDecl>('class X { a: Boolean = true }')
      const def = d.attributes[0].defaultValue as BooleanLiteral
      expect(def.kind).toBe('BooleanLiteral')
      expect(def.value).toBe(true)
    })

    it('lowers function call default', () => {
      const d = first<NodeDecl>('class X { a: Timestamp = now() }')
      const def = d.attributes[0].defaultValue as CallExpression
      expect(def.kind).toBe('CallExpression')
      expect(def.fn.value).toBe('now')
    })
  })

  // ─── Kernel Prelude ────────────────────────────────────────

  describe('Kernel prelude', () => {
    it('lowers the kernel prelude without errors', () => {
      const decls = ast(KERNEL_SCHEMA_SOURCE)
      expect(decls.length).toBeGreaterThan(0)

      const kinds = decls.map((d) => d.kind)
      expect(kinds.filter((k) => k === 'InterfaceDecl')).toHaveLength(3)
      expect(kinds.filter((k) => k === 'NodeDecl')).toHaveLength(4)
      expect(kinds.filter((k) => k === 'EdgeDecl')).toHaveLength(11)
    })

    it('correctly splits nodes and edges in kernel', () => {
      const decls = ast(KERNEL_SCHEMA_SOURCE)
      const nodes = decls.filter((d) => d.kind === 'NodeDecl') as NodeDecl[]
      const edges = decls.filter((d) => d.kind === 'EdgeDecl') as EdgeDecl[]

      expect(nodes.map((n) => n.name.value).sort()).toEqual(['Class', 'Interface', 'Operation', 'Root'])

      const edgeNames = edges.map((e) => e.name.value).sort()
      expect(edgeNames).toContain('has_parent')
      expect(edgeNames).toContain('instance_of')
      expect(edgeNames).toContain('implements')
      expect(edgeNames).toContain('extends')
      expect(edgeNames).toContain('method_of')
      expect(edgeNames).toContain('has_perm')
    })
  })

  // ─── Blog Schema Integration ───────────────────────────────

  describe('Blog schema (integration)', () => {
    const BLOG_SCHEMA = `
extend "https://kernel.astrale.ai/v1" { Identity }

type Email = String [format: email]
type Slug = String [format: slug]
type Plan = String [in: ["free", "pro", "enterprise"]]
type OrgRole = String [in: ["member", "admin", "owner"]]
type PostStatus = String [in: ["draft", "published", "archived"]]

interface Timestamped {
  created_at: Timestamp [readonly, indexed: desc] = now(),
  updated_at: Timestamp?
}

interface Publishable: Timestamped {
  published_at: Timestamp?,
  status: PostStatus = "draft"
}

interface Reactable {
  reaction_count: Int = 0
}

class User: Identity, Timestamped {
  username: String [unique],
  email: Email [unique],
  display_name: String?,
  bio: String?
}

class Organization: Identity, Timestamped {
  name: String,
  slug: Slug [unique],
  plan: Plan = "free"
}

class Post: Publishable, Reactable {
  title: String,
  body: String,
  slug: Slug [unique]
}

class Comment: Reactable, Timestamped {
  body: String
}

class Tag {
  name: String [unique],
  slug: Slug [unique]
}

class follows(follower: User, followee: User) [
  no_self,
  unique,
  follower -> 0..5000
]

class authored(author: User, content: Post | Comment) [content -> 1]

class comment_on(comment: Comment, target: Post | Comment) [
  comment -> 1,
  acyclic,
  on_kill_target: cascade
]

class tagged_with(post: Post, tag: Tag) [unique]

class member_of(user: User, org: Organization) [unique] {
  role: OrgRole = "member",
  joined_at: Timestamp = now()
}

class flagged(about: edge<any>) {
  reason: String,
  flagged_by: String,
  flagged_at: Timestamp = now()
}
`

    it('lowers full blog schema without errors', () => {
      const decls = ast(BLOG_SCHEMA)
      expect(decls).toHaveLength(20)
    })

    it('classifies declarations correctly', () => {
      const decls = ast(BLOG_SCHEMA)
      const counts = new Map<string, number>()
      for (const d of decls) {
        counts.set(d.kind, (counts.get(d.kind) ?? 0) + 1)
      }
      expect(counts.get('ExtendDecl')).toBe(1)
      expect(counts.get('TypeAliasDecl')).toBe(5)
      expect(counts.get('InterfaceDecl')).toBe(3)
      expect(counts.get('NodeDecl')).toBe(5) // Node classes
      expect(counts.get('EdgeDecl')).toBe(6) // Edge classes
    })

    it('preserves all modifier details on follows edge', () => {
      const decls = ast(BLOG_SCHEMA)
      const follows = decls.find(
        (d) => d.kind === 'EdgeDecl' && (d as EdgeDecl).name.value === 'follows',
      ) as EdgeDecl
      expect(follows.modifiers).toHaveLength(3)

      const flags = follows.modifiers.filter((m) => m.kind === 'FlagModifier') as FlagModifier[]
      expect(flags.map((f) => f.flag).sort()).toEqual(['no_self', 'unique'])

      const card = follows.modifiers.find(
        (m) => m.kind === 'CardinalityModifier',
      ) as CardinalityModifier
      expect(card.param.value).toBe('follower')
      expect(card.min).toBe(0)
      expect(card.max).toBe(5000)
    })

    it('preserves higher-order edge type on flagged', () => {
      const decls = ast(BLOG_SCHEMA)
      const flagged = decls.find(
        (d) => d.kind === 'EdgeDecl' && (d as EdgeDecl).name.value === 'flagged',
      ) as EdgeDecl
      expect(flagged.params[0].type.kind).toBe('EdgeRefType')
      expect((flagged.params[0].type as EdgeRefType).target).toBeNull()
      expect(flagged.attributes).toHaveLength(3)
    })
  })
})
