// SDK usage — kernel-level operations: spaces, permissions, traversals.
// This example shows how application types compose with the kernel prelude's
// Identity model and structural edges.

import { schema } from './schema.generated'
import { core } from './core'

const graph = await createGraph(schema, {
  adapter: new FalkorDBAdapter({ uri: 'bolt://localhost:6379' }),
  core,
})

// ─── Team Traversals ─────────────────────────────────────────

// Who is on the Acme team?
const members = await graph
  .node('Team')
  .where('slug', 'eq', 'acme')
  .from('memberOf')
  .execute()
// → UserNode[] (alice, bob)

// What spaces does Acme own?
const spaces = await graph
  .node('Team')
  .where('slug', 'eq', 'acme')
  .to('owns')
  .execute()
// → SpaceNode[] (engineering, design)

// ─── Multi-Hop: Team → Space → Documents ─────────────────────

// All documents in spaces owned by Acme
const docs = await graph
  .node('Team')
  .where('slug', 'eq', 'acme')
  .to('owns')
  .to('contains')
  .execute()
// → DocumentNode[] (roadmap, onboarding)

// ─── Permissions ─────────────────────────────────────────────
// The kernel prelude provides has_perm, excluded_from, constrained_by,
// and extends_with edges for the authorization system. These are wired
// at the kernel level (not through the typegraph SDK directly) — see
// kernel/runtime/operations/dispatcher/ for how permission checks
// are enforced before operations reach the graph.

// ─── Mutations ───────────────────────────────────────────────

// Create a new document and place it in a space
const spec = await graph.mutate.create('Document', {
  title: 'API Specification',
})
await graph.mutate.link('contains', 'engineering', spec.id)

// Add a new team member
await graph.mutate.link('memberOf', 'bob', 'acme', { role: 'admin' })
