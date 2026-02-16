// src/compile.test.ts
import { describe, it, expect } from 'vitest'
import { compile } from './compile'
import { type SchemaIR, type NodeDef, type EdgeDef, ClassDef } from './ir/index'
import { KERNEL_PRELUDE } from './prelude'
import { buildKernelRegistry } from './kernel-prelude'

const kernelRegistry = buildKernelRegistry()

/** Helpers to filter classes array by discriminator. */
function nodes(ir: SchemaIR): NodeDef[] {
  return ir.classes.filter((c): c is NodeDef => c.type === 'node')
}
function edges(ir: SchemaIR): EdgeDef[] {
  return ir.classes.filter((c): c is EdgeDef => c.type === 'edge')
}
function findNode(ir: SchemaIR, name: string): NodeDef {
  return nodes(ir).find((n) => n.name === name)!
}
function findEdge(ir: SchemaIR, name: string): EdgeDef {
  return edges(ir).find((e) => e.name === name)!
}

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

/** Helper: compile with kernel prelude. */
function compileWithKernel(source: string) {
  return compile(source, { prelude: KERNEL_PRELUDE, registry: kernelRegistry })
}

describe('Validator', () => {
  it('accepts valid schema', () => {
    const { ir, diagnostics } = compileWithKernel(BLOG_SCHEMA)
    expect(diagnostics.getErrors()).toHaveLength(0)
    expect(ir).not.toBeNull()
  })

  it('rejects class extending another class', () => {
    const { diagnostics } = compile(`
      class Foo {}
      class Bar: Foo {}
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(
      diagnostics.getErrors().some((e) => e.code === 'V003' && e.message.includes('Foo')),
    ).toBe(true)
  })

  it('rejects interface extending a class', () => {
    const { diagnostics } = compile(`
      class Foo {}
      interface Bar: Foo {}
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V004')).toBe(true)
  })

  it('rejects invalid cardinality (min > max)', () => {
    const { diagnostics } = compileWithKernel(`
      class A: Node {}
      class r(a: A, b: A) [a -> 5..2]
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V002')).toBe(true)
  })

  it('rejects cardinality on unknown parameter', () => {
    const { diagnostics } = compileWithKernel(`
      class A: Node {}
      class r(a: A, b: A) [c -> 1]
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V002' && e.message.includes('c'))).toBe(
      true,
    )
  })

  it('rejects format modifier on edge', () => {
    const { diagnostics } = compileWithKernel(`
      class A: Node {}
      class r(a: A, b: A) [format: email]
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V001')).toBe(true)
  })

  it('rejects incompatible default value types', () => {
    const { diagnostics } = compile(`
      class BadDefaults {
        name: String = 123
      }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V006')).toBe(true)
  })

  it('rejects unknown default functions', () => {
    const { diagnostics } = compile(`
      class BadDefaults {
        created_at: Timestamp = someday()
      }
    `)
    expect(diagnostics.hasErrors()).toBe(true)
    expect(diagnostics.getErrors().some((e) => e.code === 'V009')).toBe(true)
  })

  it('accepts alias-compatible defaults', () => {
    const { diagnostics } = compile(`
      type OrgRole = String [in: ["member", "admin", "owner"]]
      class Membership {
        role: OrgRole = "member"
      }
    `)
    expect(diagnostics.getErrors()).toHaveLength(0)
  })
})

describe('Serializer', () => {
  it('produces valid IR version', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    expect(ir!.version).toBe('1.0')
  })

  it('includes builtin scalars', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    expect(ir!.builtin_scalars).toContain('String')
    expect(ir!.builtin_scalars).toContain('Int')
    expect(ir!.builtin_scalars).toContain('Timestamp')
  })

  it('serializes extensions', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    expect(ir!.extensions).toHaveLength(1)
    expect(ir!.extensions[0].uri).toBe('https://kernel.astrale.ai/v1')
    expect(ir!.extensions[0].imported_types).toEqual(['Identity'])
  })

  it('serializes type aliases with constraints', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const email = ir!.type_aliases.find((a) => a.name === 'Email')!
    expect(email.underlying_type).toBe('String')
    expect(email.constraints!.format).toBe('email')

    const plan = ir!.type_aliases.find((a) => a.name === 'Plan')!
    expect(plan.constraints!.enum_values).toEqual(['free', 'pro', 'enterprise'])
  })

  // ─── Unified classes array ─────────────────────────────────

  it('puts all classes in a single array', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    // 3 interfaces + 5 node classes + 6 edges = 14
    expect(ir!.classes).toHaveLength(14)
  })

  it('discriminates nodes and edges', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    expect(nodes(ir!)).toHaveLength(8) // 3 interfaces + 5 classes
    expect(edges(ir!)).toHaveLength(6)
  })

  it('serializes interfaces as abstract nodes', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const timestamped = findNode(ir!, 'Timestamped')
    expect(timestamped.type).toBe('node')
    expect(timestamped.abstract).toBe(true)
    expect(timestamped.attributes).toHaveLength(2)
  })

  it('serializes classes as concrete nodes', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const user = findNode(ir!, 'User')
    expect(user.type).toBe('node')
    expect(user.abstract).toBe(false)
    expect(user.implements).toEqual(['Identity', 'Timestamped'])
    expect(user.attributes).toHaveLength(4)
  })

  it('serializes edges with type discriminator', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const follows = findEdge(ir!, 'follows')
    expect(follows.type).toBe('edge')
    expect(follows.endpoints).toHaveLength(2)
  })

  // ─── Discriminated TypeRef ─────────────────────────────────

  it('tags scalar type refs correctly', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const user = findNode(ir!, 'User')
    const username = user.attributes.find((a) => a.name === 'username')!
    expect(username.type).toEqual({ kind: 'Scalar', name: 'String' })
  })

  it('tags alias type refs correctly', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const user = findNode(ir!, 'User')
    const email = user.attributes.find((a) => a.name === 'email')!
    expect(email.type).toEqual({ kind: 'Alias', name: 'Email' })
  })

  it('tags node type refs in edge endpoints', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const follows = findEdge(ir!, 'follows')
    expect(follows.endpoints[0].allowed_types).toEqual([{ kind: 'Node', name: 'User' }])
  })

  it('tags union type refs', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const authored = findEdge(ir!, 'authored')
    expect(authored.endpoints[1].allowed_types).toEqual([
      { kind: 'Node', name: 'Post' },
      { kind: 'Node', name: 'Comment' },
    ])
  })

  it('tags higher-order edge refs', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const flagged = findEdge(ir!, 'flagged')
    expect(flagged.endpoints[0].allowed_types).toEqual([{ kind: 'AnyEdge' }])
  })

  // ─── Structured ValueNode ──────────────────────────────────

  it('serializes string literal defaults', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const pub = findNode(ir!, 'Publishable')
    const status = pub.attributes.find((a) => a.name === 'status')!
    expect(status.default).toEqual({ kind: 'StringLiteral', value: 'draft' })
  })

  it('serializes number literal defaults', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const reactable = findNode(ir!, 'Reactable')
    const count = reactable.attributes.find((a) => a.name === 'reaction_count')!
    expect(count.default).toEqual({ kind: 'NumberLiteral', value: 0 })
  })

  it('serializes function call defaults', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const ts = findNode(ir!, 'Timestamped')
    const createdAt = ts.attributes.find((a) => a.name === 'created_at')!
    expect(createdAt.default).toEqual({ kind: 'Call', fn: 'now', args: [] })
  })

  // ─── Edge Constraints ──────────────────────────────────────

  it('serializes edge constraints correctly', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)

    const follows = findEdge(ir!, 'follows')
    expect(follows.constraints.no_self).toBe(true)
    expect(follows.constraints.unique).toBe(true)
    expect(follows.constraints.acyclic).toBe(false)

    const commentOn = findEdge(ir!, 'comment_on')
    expect(commentOn.constraints.acyclic).toBe(true)
    expect(commentOn.constraints.on_kill_target).toBe('cascade')
  })

  // ─── Named Endpoints & Cardinality ─────────────────────────

  it('preserves endpoint names and cardinality', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const follows = findEdge(ir!, 'follows')

    expect(follows.endpoints[0].param_name).toBe('follower')
    expect(follows.endpoints[0].cardinality).toEqual({ min: 0, max: 5000 })

    expect(follows.endpoints[1].param_name).toBe('followee')
    expect(follows.endpoints[1].cardinality).toBeNull()
  })

  it('preserves exact cardinality', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const authored = findEdge(ir!, 'authored')
    expect(authored.endpoints[1].param_name).toBe('content')
    expect(authored.endpoints[1].cardinality).toEqual({ min: 1, max: 1 })
  })

  // ─── Attribute Modifiers ───────────────────────────────────

  it('serializes attribute modifiers', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const ts = findNode(ir!, 'Timestamped')
    const createdAt = ts.attributes.find((a) => a.name === 'created_at')!
    expect(createdAt.modifiers.readonly).toBe(true)
    expect(createdAt.modifiers.indexed).toBe('desc')
  })

  it('serializes unique modifier', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const user = findNode(ir!, 'User')
    const username = user.attributes.find((a) => a.name === 'username')!
    expect(username.modifiers.unique).toBe(true)
  })

  it('serializes nullable flag', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const user = findNode(ir!, 'User')
    const bio = user.attributes.find((a) => a.name === 'bio')!
    expect(bio.nullable).toBe(true)
    const username = user.attributes.find((a) => a.name === 'username')!
    expect(username.nullable).toBe(false)
  })

  // ─── Edge Attributes ───────────────────────────────────────

  it('serializes edge payload attributes', () => {
    const { ir } = compileWithKernel(BLOG_SCHEMA)
    const memberOf = findEdge(ir!, 'member_of')
    expect(memberOf.attributes).toHaveLength(2)

    const role = memberOf.attributes.find((a) => a.name === 'role')!
    expect(role.type).toEqual({ kind: 'Alias', name: 'OrgRole' })
    expect(role.default).toEqual({ kind: 'StringLiteral', value: 'member' })

    const joinedAt = memberOf.attributes.find((a) => a.name === 'joined_at')!
    expect(joinedAt.type).toEqual({ kind: 'Scalar', name: 'Timestamp' })
    expect(joinedAt.default).toEqual({ kind: 'Call', fn: 'now', args: [] })
  })
})

describe('Full pipeline', () => {
  it('compiles empty schema', () => {
    const { ir, diagnostics } = compile('')
    expect(diagnostics.hasErrors()).toBe(false)
    expect(ir).not.toBeNull()
    expect(ir!.classes).toHaveLength(0)
  })

  it('compiles minimal schema', () => {
    const { ir, diagnostics } = compileWithKernel('extend "https://kernel.astrale.ai/v1" { Node }\nclass Foo: Node {}')
    expect(diagnostics.hasErrors()).toBe(false)
    expect(ir!.classes).toHaveLength(1)
    expect(ir!.classes[0].name).toBe('Foo')
    expect(ir!.classes[0].type).toBe('node')
  })

  it('compiles full blog schema', () => {
    const { ir, diagnostics } = compileWithKernel(BLOG_SCHEMA)
    expect(diagnostics.getErrors()).toHaveLength(0)
    expect(ir).not.toBeNull()
    expect(ir!.type_aliases).toHaveLength(5)
    expect(ir!.classes).toHaveLength(14) // 3 interfaces + 5 classes + 6 edges
  })

  it('reports resolution errors', () => {
    const { ir, diagnostics } = compile('class Foo: Unknown {}')
    expect(diagnostics.hasErrors()).toBe(true)
  })

  it('provides intermediate artifacts', () => {
    const { artifacts } = compile('interface Foo {}')
    expect(artifacts).not.toBeNull()
    expect(artifacts!.cst.kind).toBe('Schema')
    expect(artifacts!.ast.declarations).toHaveLength(1)
    expect(artifacts!.resolved.symbols.has('Foo')).toBe(true)
  })

  it('includes meta in IR', () => {
    const { ir } = compile('', { sourceHash: 'abc123' })
    expect(ir!.meta.source_hash).toBe('abc123')
    expect(ir!.meta.generated_at).toBeTruthy()
  })
})
