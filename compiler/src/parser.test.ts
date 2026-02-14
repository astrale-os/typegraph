// src/parser.test.ts
import { describe, it, expect } from 'vitest'
import { lex } from './lexer'
import { parse } from './parser/index'
import { KERNEL_PRELUDE } from './kernel-prelude'
import {
  SchemaNode,
  type ClassDeclNode,
  type InterfaceDeclNode,
  type TypeAliasDeclNode,
  type ExtendDeclNode,
  isToken,
  isNode,
  spanOf,
} from './cst/index'
import { DiagnosticBag } from './diagnostics'

/** Helper: lex + parse, return CST root and diagnostics. */
function parseSource(source: string) {
  const bag = new DiagnosticBag()
  const { tokens } = lex(source, bag)
  const { cst, diagnostics } = parse(tokens, bag)
  return { cst, diagnostics }
}

/** Helper: parse and expect no errors, return declarations. */
function decls(source: string) {
  const { cst, diagnostics } = parseSource(source)
  expect(diagnostics.hasErrors()).toBe(false)
  return cst.declarations
}

describe('Parser', () => {
  // ─── Type Alias ────────────────────────────────────────────

  describe('TypeAliasDecl', () => {
    it('parses simple type alias', () => {
      const [d] = decls('type Email = String')
      expect(d.kind).toBe('TypeAliasDecl')
      const alias = d as TypeAliasDeclNode
      expect(alias.name.text).toBe('Email')
      expect(alias.modifiers).toBeNull()
    })

    it('parses type alias with modifiers', () => {
      const [d] = decls('type Email = String [format: email]')
      const alias = d as TypeAliasDeclNode
      expect(alias.name.text).toBe('Email')
      expect(alias.modifiers).not.toBeNull()
      expect(alias.modifiers!.modifiers).toHaveLength(1)
    })

    it('parses type alias with in modifier', () => {
      const [d] = decls('type Plan = String [in: ["free", "pro", "enterprise"]]')
      const alias = d as TypeAliasDeclNode
      expect(alias.modifiers!.modifiers).toHaveLength(1)
    })

    it('parses type alias with length modifier', () => {
      const [d] = decls('type Name = String [length: 1..255]')
      const alias = d as TypeAliasDeclNode
      expect(alias.modifiers!.modifiers).toHaveLength(1)
    })
  })

  // ─── Interface ─────────────────────────────────────────────

  describe('InterfaceDecl', () => {
    it('parses empty interface', () => {
      const [d] = decls('interface Node {}')
      expect(d.kind).toBe('InterfaceDecl')
      const iface = d as InterfaceDeclNode
      expect(iface.name.text).toBe('Node')
      expect(iface.extendsClause).toBeNull()
      expect(iface.body).not.toBeNull()
      expect(iface.body!.attributes).toHaveLength(0)
    })

    it('parses interface with extends', () => {
      const [d] = decls('interface Identity: Node {}')
      const iface = d as InterfaceDeclNode
      expect(iface.name.text).toBe('Identity')
      expect(iface.extendsClause).not.toBeNull()
      expect(iface.extendsClause!.names.items).toHaveLength(1)
      expect(iface.extendsClause!.names.items[0].text).toBe('Node')
    })

    it('parses interface with multiple extends', () => {
      const [d] = decls('interface Publishable: Timestamped, Reactable {}')
      const iface = d as InterfaceDeclNode
      expect(iface.extendsClause!.names.items).toHaveLength(2)
    })

    it('parses interface with attributes', () => {
      const [d] = decls(`interface Timestamped {
        created_at: Timestamp [readonly, indexed: desc] = now(),
        updated_at: Timestamp?
      }`)
      const iface = d as InterfaceDeclNode
      expect(iface.body!.attributes).toHaveLength(2)

      const attr0 = iface.body!.attributes[0]
      expect(attr0.name.text).toBe('created_at')
      expect(attr0.modifiers).not.toBeNull()
      expect(attr0.modifiers!.modifiers).toHaveLength(2)
      expect(attr0.defaultValue).not.toBeNull()

      const attr1 = iface.body!.attributes[1]
      expect(attr1.name.text).toBe('updated_at')
      expect(attr1.typeExpr.kind).toBe('NullableType')
    })
  })

  // ─── Class (Node) ──────────────────────────────────────────

  describe('ClassDecl (Node)', () => {
    it('parses simple class', () => {
      const [d] = decls('class Class: Node {}')
      expect(d.kind).toBe('ClassDecl')
      const cls = d as ClassDeclNode
      expect(cls.name.text).toBe('Class')
      expect(cls.signature).toBeNull()
      expect(cls.extendsClause).not.toBeNull()
    })

    it('parses class with attributes', () => {
      const [d] = decls(`class User: Identity, Timestamped {
        username: String [unique],
        email: Email [unique],
        display_name: String?,
        bio: String?
      }`)
      const cls = d as ClassDeclNode
      expect(cls.name.text).toBe('User')
      expect(cls.extendsClause!.names.items).toHaveLength(2)
      expect(cls.body!.attributes).toHaveLength(4)
    })

    it('parses class with default value', () => {
      const [d] = decls(`class Organization: Identity {
        plan: Plan = "free"
      }`)
      const cls = d as ClassDeclNode
      const attr = cls.body!.attributes[0]
      expect(attr.defaultValue).not.toBeNull()
    })
  })

  // ─── Class (Edge) ──────────────────────────────────────────

  describe('ClassDecl (Edge)', () => {
    it('parses edge with signature', () => {
      const [d] = decls(
        'class follows(follower: User, followee: User) [no_self, unique, follower -> 0..5000]',
      )
      expect(d.kind).toBe('ClassDecl')
      const cls = d as ClassDeclNode
      expect(cls.name.text).toBe('follows')
      expect(cls.signature).not.toBeNull()
      expect(cls.signature!.params).toHaveLength(2)
      expect(cls.signature!.params[0].name.text).toBe('follower')
      expect(cls.signature!.params[1].name.text).toBe('followee')
      expect(cls.modifiers).not.toBeNull()
      expect(cls.modifiers!.modifiers).toHaveLength(3)
    })

    it('parses edge with union type parameter', () => {
      const [d] = decls('class authored(author: User, content: Post | Comment) [content -> 1]')
      const cls = d as ClassDeclNode
      expect(cls.signature!.params[1].typeExpr.kind).toBe('UnionType')
    })

    it('parses edge with body', () => {
      const [d] = decls(`class has_perm(identity: Identity, target: Node) {
        perm: Bitmask
      }`)
      const cls = d as ClassDeclNode
      expect(cls.signature).not.toBeNull()
      expect(cls.body).not.toBeNull()
      expect(cls.body!.attributes).toHaveLength(1)
    })

    it('parses edge with lifecycle modifiers', () => {
      const [d] = decls(
        'class comment_on(comment: Comment, target: Post | Comment) [comment -> 1, acyclic, on_kill_target: cascade]',
      )
      const cls = d as ClassDeclNode
      expect(cls.modifiers!.modifiers).toHaveLength(3)
    })

    it('parses edge with exact cardinality', () => {
      const [d] = decls('class instance_of(instance: Node | Link, type: Class) [instance -> 1]')
      const cls = d as ClassDeclNode
      expect(cls.modifiers!.modifiers).toHaveLength(1)
    })

    it('parses higher-order edge', () => {
      const [d] = decls(`class flagged(about: edge<any>) {
        reason: String,
        flagged_by: String
      }`)
      const cls = d as ClassDeclNode
      expect(cls.signature!.params[0].typeExpr.kind).toBe('EdgeRefType')
      const typeNode = cls.signature!.params[0].typeExpr
      expect('edgeKeyword' in typeNode).toBe(true)
    })
  })

  // ─── Extend ────────────────────────────────────────────────

  describe('ExtendDecl', () => {
    it('parses extend declaration', () => {
      const [d] = decls('extend "https://kernel.astrale.ai/v1" { Identity }')
      expect(d.kind).toBe('ExtendDecl')
      const ext = d as ExtendDeclNode
      expect(ext.uri.text).toBe('"https://kernel.astrale.ai/v1"')
      expect(ext.imports.items).toHaveLength(1)
      expect(ext.imports.items[0].text).toBe('Identity')
    })

    it('parses extend with multiple imports', () => {
      const [d] = decls('extend "https://example.com" { Foo, Bar, Baz }')
      const ext = d as ExtendDeclNode
      expect(ext.imports.items).toHaveLength(3)
    })
  })

  // ─── Type Expressions ─────────────────────────────────────

  describe('Type expressions', () => {
    it('parses simple named type', () => {
      const [d] = decls('interface Foo { x: String }')
      const iface = d as InterfaceDeclNode
      expect(iface.body!.attributes[0].typeExpr.kind).toBe('NamedType')
    })

    it('parses nullable type', () => {
      const [d] = decls('interface Foo { x: String? }')
      const iface = d as InterfaceDeclNode
      expect(iface.body!.attributes[0].typeExpr.kind).toBe('NullableType')
    })

    it('parses union type', () => {
      const [d] = decls('interface Foo { x: A | B | C }')
      const iface = d as InterfaceDeclNode
      const te = iface.body!.attributes[0].typeExpr
      expect(te.kind).toBe('UnionType')
      expect((te as any).types).toHaveLength(3)
    })

    it('parses edge<Name> type', () => {
      const [d] = decls('interface Foo { x: edge<follows> }')
      const iface = d as InterfaceDeclNode
      const te = iface.body!.attributes[0].typeExpr
      expect(te.kind).toBe('EdgeRefType')
      expect('edgeKeyword' in te).toBe(true)
    })
  })

  // ─── Multiple declarations ────────────────────────────────

  describe('Multiple declarations', () => {
    it('parses multiple declarations', () => {
      const ds = decls(`
        interface Node {}
        interface Link {}
        class Class: Node {}
      `)
      expect(ds).toHaveLength(3)
      expect(ds[0].kind).toBe('InterfaceDecl')
      expect(ds[1].kind).toBe('InterfaceDecl')
      expect(ds[2].kind).toBe('ClassDecl')
    })
  })

  // ─── Lossless CST ─────────────────────────────────────────

  describe('Lossless CST', () => {
    it('preserves all tokens in children', () => {
      const { cst } = parseSource('class User: Node {}')
      // Count all leaf tokens in the tree
      function countTokens(node: any): number {
        if (isToken(node)) return 1
        if (isNode(node)) {
          return node.children.reduce((acc: number, c: any) => acc + countTokens(c), 0)
        }
        return 0
      }
      // class User : Node { } EOF = 7 tokens
      const total = countTokens(cst)
      expect(total).toBe(7)
    })

    it('computes spans from children', () => {
      const { cst } = parseSource('class User {}')
      const cls = cst.declarations[0]
      const span = spanOf(cls)
      expect(span.start).toBe(0)
      expect(span.end).toBe(13)
    })
  })

  // ─── Error Recovery ────────────────────────────────────────

  describe('Error recovery', () => {
    it('recovers from missing closing brace', () => {
      const { cst, diagnostics } = parseSource(`
        class User: Node {
          name: String
        
        class Post: Node {}
      `)
      expect(diagnostics.hasErrors()).toBe(true)
      // Should still parse Post
      expect(cst.declarations.length).toBeGreaterThanOrEqual(2)
    })

    it('recovers from unexpected token in declaration position', () => {
      const { cst, diagnostics } = parseSource(`
        interface Node {}
        @@@
        interface Link {}
      `)
      // Lexer errors from @@@, parser should still get both interfaces
      expect(cst.declarations.length).toBeGreaterThanOrEqual(2)
    })

    it('reports missing closing bracket in modifiers', () => {
      const { diagnostics } = parseSource(`
        class foo(a: A, b: B) [no_self
        class Bar {}
      `)
      expect(diagnostics.hasErrors()).toBe(true)
    })

    it('reports expected token errors', () => {
      const { diagnostics } = parseSource('type = String')
      expect(diagnostics.hasErrors()).toBe(true)
    })
  })

  // ─── Kernel Prelude ────────────────────────────────────────

  describe('Kernel prelude', () => {
    it('parses the entire kernel prelude without errors', () => {
      const { cst, diagnostics } = parseSource(KERNEL_PRELUDE.source)
      expect(diagnostics.hasErrors()).toBe(false)

      // Count by kind
      const kinds = cst.declarations.map((d) => d.kind)
      const interfaces = kinds.filter((k) => k === 'InterfaceDecl')
      const classes = kinds.filter((k) => k === 'ClassDecl')

      // 3 interfaces: Node, Link, Identity
      expect(interfaces).toHaveLength(3)

      // 10 classes: Class, Interface, has_parent, instance_of,
      //   has_link, links_to, implements, extends,
      //   has_perm, excluded_from, constrained_by, extends_with
      expect(classes).toHaveLength(12)
    })

    it('correctly identifies edges in kernel', () => {
      const { cst } = parseSource(KERNEL_PRELUDE.source)
      const edges = cst.declarations.filter(
        (d) => d.kind === 'ClassDecl' && (d as ClassDeclNode).signature !== null,
      )
      // has_parent, instance_of, has_link, links_to, implements,
      // extends, has_perm, excluded_from, constrained_by, extends_with
      expect(edges).toHaveLength(10)
    })

    it('correctly identifies nodes in kernel', () => {
      const { cst } = parseSource(KERNEL_PRELUDE.source)
      const nodes = cst.declarations.filter(
        (d) => d.kind === 'ClassDecl' && (d as ClassDeclNode).signature === null,
      )
      // Class, Interface
      expect(nodes).toHaveLength(2)
    })
  })

  // ─── Full blog schema ──────────────────────────────────────

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

    it('parses the full blog schema without errors', () => {
      const { cst, diagnostics } = parseSource(BLOG_SCHEMA)
      expect(diagnostics.hasErrors()).toBe(false)

      // 1 extend + 5 type aliases + 3 interfaces + 5 node classes + 6 edges = 20
      expect(cst.declarations).toHaveLength(20)
    })

    it('classifies all declaration kinds correctly', () => {
      const { cst } = parseSource(BLOG_SCHEMA)
      const kindCounts = new Map<string, number>()
      for (const d of cst.declarations) {
        kindCounts.set(d.kind, (kindCounts.get(d.kind) ?? 0) + 1)
      }
      expect(kindCounts.get('ExtendDecl')).toBe(1)
      expect(kindCounts.get('TypeAliasDecl')).toBe(5)
      expect(kindCounts.get('InterfaceDecl')).toBe(3)
      expect(kindCounts.get('ClassDecl')).toBe(11) // 5 nodes + 6 edges
    })
  })
})
