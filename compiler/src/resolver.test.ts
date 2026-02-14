// src/resolver.test.ts
import { describe, it, expect } from 'vitest'
import { lex } from './lexer.js'
import { parse } from './parser/index.js'
import { lower } from './lower/index.js'
import { resolve, createBuiltinScope, type ResolvedSchema } from './resolver/index.js'
import { KERNEL_PRELUDE } from './kernel-prelude.js'
import { DiagnosticBag } from './diagnostics.js'

/** Helper: full pipeline source → resolved schema. */
function resolveSource(
  source: string,
  baseScope?: Map<string, any>,
): { schema: ResolvedSchema; diagnostics: DiagnosticBag } {
  const bag = new DiagnosticBag()
  const { tokens } = lex(source, bag)
  const { cst } = parse(tokens, bag)
  const { ast } = lower(cst, bag)
  return resolve(ast, baseScope ?? createBuiltinScope(KERNEL_PRELUDE.scalars), bag)
}

/** Resolve the kernel prelude, return the primal scope. */
function resolveKernel(): Map<string, any> {
  const { schema, diagnostics } = resolveSource(
    KERNEL_PRELUDE.source,
    createBuiltinScope(KERNEL_PRELUDE.scalars),
  )
  expect(diagnostics.hasErrors()).toBe(false)
  return schema.symbols
}

/** Resolve user source against kernel scope. */
function resolveWithKernel(source: string) {
  const primalScope = resolveKernel()
  return resolveSource(source, primalScope)
}

describe('Resolver', () => {
  // ─── Builtin Scope ─────────────────────────────────────────

  describe('Builtin scope', () => {
    it('creates builtin scope with all scalar types', () => {
      const scope = createBuiltinScope(KERNEL_PRELUDE.scalars)
      expect(scope.has('String')).toBe(true)
      expect(scope.has('Int')).toBe(true)
      expect(scope.has('Float')).toBe(true)
      expect(scope.has('Boolean')).toBe(true)
      expect(scope.has('Timestamp')).toBe(true)
      expect(scope.has('Bitmask')).toBe(true)
      expect(scope.has('ByteString')).toBe(true)
      expect(scope.get('String')!.symbolKind).toBe('Scalar')
    })
  })

  // ─── Registration ──────────────────────────────────────────

  describe('Symbol registration', () => {
    it('registers type aliases', () => {
      const { schema } = resolveSource('type Email = String')
      expect(schema.symbols.has('Email')).toBe(true)
      expect(schema.symbols.get('Email')!.symbolKind).toBe('TypeAlias')
    })

    it('registers interfaces', () => {
      const { schema } = resolveSource('interface Foo {}')
      expect(schema.symbols.has('Foo')).toBe(true)
      expect(schema.symbols.get('Foo')!.symbolKind).toBe('Interface')
    })

    it('registers classes', () => {
      const { schema } = resolveSource('class Foo {}')
      expect(schema.symbols.has('Foo')).toBe(true)
      expect(schema.symbols.get('Foo')!.symbolKind).toBe('Class')
    })

    it('registers edges', () => {
      const { schema } = resolveSource('interface A {} \n interface B {} \n class r(a: A, b: B) []')
      expect(schema.symbols.has('r')).toBe(true)
      expect(schema.symbols.get('r')!.symbolKind).toBe('Edge')
    })

    it('reports duplicate declarations', () => {
      const { diagnostics } = resolveSource(`
        interface Foo {}
        interface Foo {}
      `)
      expect(diagnostics.hasErrors()).toBe(true)
      const errors = diagnostics.getErrors()
      expect(errors[0].code).toBe('R002')
      expect(errors[0].message).toContain('Foo')
    })
  })

  // ─── Type Resolution ───────────────────────────────────────

  describe('Type resolution', () => {
    it('resolves builtin scalar references', () => {
      const { diagnostics } = resolveSource('interface Foo { x: String }')
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('resolves forward references', () => {
      // Bar references Foo, but Foo is declared after Bar
      const { diagnostics } = resolveSource(`
        interface Bar { x: Foo }
        interface Foo {}
      `)
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('reports unknown types', () => {
      const { diagnostics } = resolveSource('interface Foo { x: Unknown }')
      expect(diagnostics.hasErrors()).toBe(true)
      const errors = diagnostics.getErrors()
      expect(errors[0].code).toBe('R001')
      expect(errors[0].message).toContain('Unknown')
    })

    it('resolves type alias references', () => {
      const { diagnostics } = resolveSource(`
        type Email = String
        interface User { email: Email }
      `)
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('resolves union type members', () => {
      const { diagnostics } = resolveSource(`
        class A {}
        class B {}
        class r(a: A, b: A | B) []
      `)
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('resolves nullable types', () => {
      const { diagnostics } = resolveSource('interface Foo { x: String? }')
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('resolves interface extends', () => {
      const { diagnostics } = resolveSource(`
        interface Base {}
        interface Child: Base {}
      `)
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('reports unknown interface in extends', () => {
      const { diagnostics } = resolveSource('interface Child: Nonexistent {}')
      expect(diagnostics.hasErrors()).toBe(true)
    })

    it('resolves class implements', () => {
      const { diagnostics } = resolveSource(`
        interface Base {}
        class Concrete: Base {}
      `)
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('resolves edge parameter types', () => {
      const { diagnostics } = resolveSource(`
        class A {}
        class B {}
        class r(a: A, b: B) []
      `)
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('reports unknown edge parameter types', () => {
      const { diagnostics } = resolveSource('class r(a: Unknown) []')
      expect(diagnostics.hasErrors()).toBe(true)
    })
  })

  // ─── References Map ────────────────────────────────────────

  describe('References map', () => {
    it('records resolved references', () => {
      const { schema } = resolveSource('interface Foo { x: String }')
      // "String" reference should be recorded
      expect(schema.references.size).toBeGreaterThan(0)
      // At least one reference should point to the String builtin
      const refs = Array.from(schema.references.values())
      expect(refs.some((r) => r.name === 'String')).toBe(true)
    })
  })

  // ─── Extension Imports ─────────────────────────────────────

  describe('Extension imports', () => {
    it('registers extension imports as stubs', () => {
      const { schema, diagnostics } = resolveSource(
        'extend "https://example.com" { Foo }\ninterface Bar: Foo {}',
      )
      expect(diagnostics.hasErrors()).toBe(false)
      expect(schema.symbols.has('Foo')).toBe(true)
    })
  })

  // ─── Kernel Bootstrapping ─────────────────────────────────

  describe('Kernel bootstrapping', () => {
    it('resolves the kernel prelude against builtins without errors', () => {
      const { diagnostics } = resolveSource(
        KERNEL_PRELUDE.source,
        createBuiltinScope(KERNEL_PRELUDE.scalars),
      )
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('kernel scope contains all expected symbols', () => {
      const scope = resolveKernel()

      // Builtins
      expect(scope.has('String')).toBe(true)
      expect(scope.has('Bitmask')).toBe(true)

      // Interfaces
      expect(scope.get('Node')!.symbolKind).toBe('Interface')
      expect(scope.get('Link')!.symbolKind).toBe('Interface')
      expect(scope.get('Identity')!.symbolKind).toBe('Interface')

      // Classes
      expect(scope.get('Class')!.symbolKind).toBe('Class')
      expect(scope.get('Interface')!.symbolKind).toBe('Class')

      // Edges
      expect(scope.get('has_parent')!.symbolKind).toBe('Edge')
      expect(scope.get('instance_of')!.symbolKind).toBe('Edge')
      expect(scope.get('implements')!.symbolKind).toBe('Edge')
      expect(scope.get('extends')!.symbolKind).toBe('Edge')
      expect(scope.get('has_perm')!.symbolKind).toBe('Edge')
    })

    it('user code resolves against kernel scope', () => {
      const { diagnostics } = resolveWithKernel(`
        class User: Identity {}
      `)
      // Identity is defined in kernel
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('user code can reference kernel edges', () => {
      const { diagnostics } = resolveWithKernel(`
        class User: Node {}
        class Admin: Node {}
        class has_parent(child: Node, parent: Node) [child -> 0..1]
      `)
      // has_parent is defined in kernel — duplicate declaration
      expect(diagnostics.hasErrors()).toBe(true)
      expect(diagnostics.getErrors()[0].code).toBe('R002')
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

    it('resolves the full blog schema without errors', () => {
      const primalScope = resolveKernel()
      const { diagnostics } = resolveSource(BLOG_SCHEMA, primalScope)
      expect(diagnostics.hasErrors()).toBe(false)
    })

    it('blog schema symbols include all declarations', () => {
      const primalScope = resolveKernel()
      const { schema } = resolveSource(BLOG_SCHEMA, primalScope)

      // User types
      expect(schema.symbols.get('User')!.symbolKind).toBe('Class')
      expect(schema.symbols.get('Post')!.symbolKind).toBe('Class')
      expect(schema.symbols.get('follows')!.symbolKind).toBe('Edge')
      expect(schema.symbols.get('Email')!.symbolKind).toBe('TypeAlias')
      expect(schema.symbols.get('Timestamped')!.symbolKind).toBe('Interface')
    })

    it('all type references are resolved', () => {
      const primalScope = resolveKernel()
      const { schema } = resolveSource(BLOG_SCHEMA, primalScope)
      // Should have a substantial number of resolved references
      expect(schema.references.size).toBeGreaterThan(20)
    })
  })
})
