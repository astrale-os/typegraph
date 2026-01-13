# Typegraph

Type-safe graph DSL for Cypher (Neo4j/Memgraph/FalkorDB).

[![CI](https://github.com/astrale-os/typegraph/actions/workflows/ci.yml/badge.svg)](https://github.com/astrale-os/typegraph/actions/workflows/ci.yml)
[![JSR @astrale/typegraph](https://jsr.io/badges/@astrale/typegraph)](https://jsr.io/@astrale/typegraph)

## Packages

| Package                                                  | Description                              |
| -------------------------------------------------------- | ---------------------------------------- |
| [`@astrale/typegraph`](./packages/typegraph)             | Core query builder and mutation DSL      |
| [`@astrale/typegraph-adapter-memory`](./packages/memory) | In-memory adapter (testing, prototyping) |

## Installation

```bash
# Deno
deno add jsr:@astrale/typegraph

# npm (via JSR)
npx jsr add @astrale/typegraph

# pnpm (via JSR)
pnpm dlx jsr add @astrale/typegraph

# Bun
bunx jsr add @astrale/typegraph
```

## Schema Definition

Define your graph structure with Zod schemas. All nodes and edges have an implicit `id: string` field.

```typescript
import { defineSchema, node, edge } from '@astrale/typegraph'
import { z } from 'zod'

const schema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
        status: z.enum(['active', 'inactive']),
      },
      indexes: ['email'],
    }),
    post: node({
      properties: {
        title: z.string(),
        content: z.string(),
        publishedAt: z.date().optional(),
      },
    }),
    comment: node({
      properties: {
        content: z.string(),
        createdAt: z.date(),
      },
    }),
  },
  edges: {
    // One user authors many posts, each post has one author
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'one' },
      properties: {
        role: z.enum(['author', 'coauthor']),
      },
    }),
    // Self-referential: users follow users
    follows: edge({
      from: 'user',
      to: 'user',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
    // Hierarchy: posts can have parent posts (threads)
    hasParent: edge({
      from: 'post',
      to: 'post',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },
  hierarchy: { defaultEdge: 'hasParent', direction: 'up' },
})
```

## Query API

### Basic Queries

```typescript
import { createGraph } from '@astrale/typegraph'

const graph = createGraph(schema, {
  queryExecutor: myAdapter,
  mutationExecutor: myAdapter,
})

// All users
const users = await graph.node('user').execute()

// Single node by ID
const user = await graph.node('user').byId(userId).execute()

// Filter with where
const activeUsers = await graph.node('user').where('status', 'eq', 'active').execute()

// Complex conditions
const results = await graph
  .node('user')
  .whereComplex((w) => w.or(w.eq('status', 'active'), w.gt('score', 100)))
  .execute()

// Ordering and pagination
const topUsers = await graph.node('user').orderBy('score', 'DESC').limit(10).skip(20).execute()

// Or use paginate helper
const page3 = await graph.node('user').paginate({ page: 3, pageSize: 10 }).execute()
```

### Edge Traversal

```typescript
// Follow outgoing edges (from → to)
const posts = await graph.node('user').byId(userId).to('authored').execute()

// Follow incoming edges (to → from)
const author = await graph.node('post').byId(postId).from('authored').execute()

// Bidirectional traversal
const connections = await graph.node('user').byId(userId).via('follows').execute()

// Filter on edge properties
const authoredPosts = await graph
  .node('user')
  .byId(userId)
  .to('authored', { where: { role: { eq: 'author' } } })
  .execute()

// Variable-length paths
const reachable = await graph
  .node('user')
  .byId(userId)
  .to('follows', { depth: { min: 1, max: 3 } })
  .execute()
```

### Multi-Node Returns

Return multiple aliased nodes from a single query:

```typescript
const results = await graph
  .node('post')
  .as('post')
  .from('authored')
  .as('author')
  .returning('post', 'author')
  .execute()
// Type: Array<{ post: Post, author: User }>
```

### Fork Pattern (Fan-out)

Create multiple independent traversals from a single node:

```typescript
const results = await graph
  .node('post')
  .as('post')
  .fork(
    (q) => q.from('authored').as('author'),
    (q) => q.to('hasParent').as('parent'),
  )
  .returning('post', 'author', 'parent')
  .execute()
// Type: Array<{ post: Post, author: User, parent: Post | null }>
```

### Hierarchy Traversal

Built-in support for tree structures:

```typescript
// Get all ancestors
const ancestors = await graph.node('post').byId(postId).ancestors().execute()

// Get self and ancestors with depth
const lineage = await graph.node('post').byId(postId).selfAndAncestors().execute()
// Each result has _depth: 0 = self, 1 = parent, 2 = grandparent...

// Get all descendants
const descendants = await graph.node('post').byId(postId).descendants().execute()

// Direct children only
const children = await graph.node('post').byId(postId).children().execute()

// Navigate to root
const root = await graph.node('post').byId(postId).root().execute()

// Get siblings
const siblings = await graph.node('post').byId(postId).siblings().execute()
```

### Aggregation

```typescript
// Count
const count = await graph.node('user').count()

// Group by with aggregates
const stats = await graph
  .node('post')
  .groupBy('status')
  .count()
  .avg('viewCount', { alias: 'avgViews' })
  .execute()
```

### Set Operations

```typescript
// Union: users matching either condition
const activeOrAdmins = await graph
  .union(
    graph.node('user').where('status', 'eq', 'active'),
    graph.node('user').where('role', 'eq', 'admin'),
  )
  .execute()

// Intersection: users matching both conditions
const activeAdmins = await graph
  .intersect(
    graph.node('user').where('status', 'eq', 'active'),
    graph.node('user').where('role', 'eq', 'admin'),
  )
  .execute()
```

### Query Composition

Reusable query fragments:

```typescript
const activeUsers = (q) => q.where('status', 'eq', 'active')
const withPosts = (q) => q.to('authored')

const results = await graph.node('user').pipe(activeUsers).pipe(withPosts).execute()
```

## Mutation API

```typescript
// Create node
const user = await graph.mutate.create('user', {
  email: 'john@example.com',
  name: 'John',
  status: 'active',
})

// Update node
await graph.mutate.update('user', user.id, { name: 'Jane' })

// Upsert (create or update)
const result = await graph.mutate.upsert('user', knownId, { name: 'John' })
// result.created: boolean

// Delete node
await graph.mutate.delete('user', user.id)

// Link nodes
await graph.mutate.link('authored', user.id, post.id, { role: 'author' })

// Unlink nodes
await graph.mutate.unlink('authored', user.id, post.id)
```

### Hierarchy Mutations

```typescript
// Create child with parent link
const reply = await graph.mutate.createChild('post', parentPostId, {
  title: 'Reply',
  content: 'This is a reply',
})

// Move node to new parent
await graph.mutate.move(postId, newParentId)

// Move entire subtree
await graph.mutate.moveSubtree(rootId, newParentId)

// Clone node
const clone = await graph.mutate.clone('post', sourceId, { title: 'Copy of...' })

// Clone entire subtree
const cloned = await graph.mutate.cloneSubtree(rootId, {
  parentId: newParentId,
  transform: (node, depth) => ({ ...node, title: `Copy: ${node.title}` }),
})

// Delete subtree
await graph.mutate.deleteSubtree('post', rootId)
```

### Batch Operations

```typescript
// Create many
const users = await graph.mutate.createMany('user', [
  { email: 'a@example.com', name: 'A', status: 'active' },
  { email: 'b@example.com', name: 'B', status: 'active' },
])

// Link many
await graph.mutate.linkMany('follows', [
  { from: user1.id, to: user2.id },
  { from: user1.id, to: user3.id },
])

// Delete many
await graph.mutate.deleteMany('user', [id1, id2, id3])
```

### Transactions

```typescript
await graph.mutate.transaction(async (tx) => {
  const user = await tx.create('user', { name: 'John', ... })
  const post = await tx.create('post', { title: 'Hello', ... })
  await tx.link('authored', user.id, post.id)
})
```

## In-Memory Adapter

Zero-infrastructure graph database for testing and prototyping:

```bash
# Deno
deno add jsr:@astrale/typegraph-adapter-memory

# npm (via JSR)
npx jsr add @astrale/typegraph-adapter-memory
```

```typescript
import { createInMemoryGraph } from '@astrale/typegraph-adapter-memory'

const graph = createInMemoryGraph(schema)

// Same API as production
const user = await graph.mutate.create('user', { name: 'Test', ... })
const users = await graph.node('user').execute()

// In-memory specific features
graph.clear()                    // Clear all data
const data = graph.export()      // Export for serialization
graph.import(data)               // Import from serialization
const stats = graph.stats()      // Get statistics
```

## Type Safety

Full type inference throughout the API:

```typescript
// Node properties are inferred
const user = await graph.node('user').byId(id).execute()
user.email // string
user.status // 'active' | 'inactive'

// Edge traversal infers target types
const posts = await graph.node('user').byId(id).to('authored').execute()
posts[0].title // string (Post property)

// Cardinality affects return types
// 'one' cardinality → SingleNodeBuilder (returns single node)
// 'many' cardinality → CollectionBuilder (returns array)
// 'optional' cardinality → OptionalNodeBuilder (returns node | null)

// Multi-node returns are fully typed
const results = await graph
  .node('post')
  .as('p')
  .from('authored')
  .as('a')
  .returning('p', 'a')
  .execute()
results[0].p.title // string
results[0].a.email // string
```

## Architecture

```
Schema → AST → Compiler → Executor
  ↓       ↓       ↓          ↓
Types  Query   Cypher    Neo4j/
       Builder           Memgraph/
                         FalkorDB
```

1. **Schema**: Define graph structure with Zod
2. **AST**: Immutable query representation
3. **Compiler**: Transform AST to Cypher
4. **Executor**: Execute against database

## Development

```bash
git clone https://github.com/astrale-os/typegraph.git
cd typegraph
pnpm install
```

```bash
pnpm build        # Build all packages
pnpm typecheck    # TypeScript type checking
pnpm lint         # Run ESLint
pnpm test         # Run tests
```

## License

MIT
