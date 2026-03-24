// scripts/emit-ir.ts
// Quick script to compile the blog schema and emit the IR JSON.
// Run with: npx tsx scripts/emit-ir.ts

import { compile } from '../src/compile.js'
import { buildKernelRegistry } from '../src/kernel-prelude.js'
import { KERNEL_PRELUDE } from '../src/prelude.js'

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

const { ir, diagnostics } = compile(BLOG_SCHEMA, {
  prelude: KERNEL_PRELUDE,
  registry: buildKernelRegistry(),
  sourceHash: 'blog-schema-v1',
})

if (diagnostics.hasErrors()) {
  console.error('Compilation errors:')
  for (const d of diagnostics.getErrors()) {
    console.error(`  [${d.code}] ${d.message} (offset ${d.span.start})`)
  }
  process.exit(1)
}

const warnings = diagnostics.getWarnings()
if (warnings.length > 0) {
  console.error('Warnings:')
  for (const w of warnings) {
    console.error(`  [${w.code}] ${w.message}`)
  }
}

console.log(JSON.stringify(ir, null, 2))
