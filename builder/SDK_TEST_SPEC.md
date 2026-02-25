# Builder SDK — Test Specification

All tests below define the target behavior for the Builder SDK client. The syntax takes the best of TypeGraph's fluent API and Builder's schema-derived typing.

**Syntax conventions:**

| Concept | TypeGraph | Builder SDK | Why |
|---|---|---|---|
| Entry point | `graph.node('user')` | `graph.User` | Schema-derived, typed, auto-completed |
| By ID | `graph.nodeById(id)` | `graph.User.byId(id)` | Knows the label |
| Outbound traversal | `.to('authored')` | `.post()` | Uses opposite endpoint `as` name |
| Inbound traversal | `.from('authored')` | `.author()` | Uses opposite endpoint `as` name |
| Self-ref (out) | `.to('follows')` | `.following()` | Endpoint `as` name resolves direction |
| Self-ref (in) | `.from('follows')` | `.follower()` | Endpoint `as` name resolves direction |
| Filtering | `.where('status', 'eq', 'active')` | `.where('status', 'eq', 'active')` | Kept as-is (good DX) |
| Ordering | `.orderBy('name', 'ASC')` | `.orderBy('name', 'ASC')` | Kept as-is |
| Pagination | `.limit(10)` / `.skip(5)` | `.limit(10)` / `.skip(5)` | Kept as-is |
| Execute | `.execute()` | `.execute()` | Kept as-is |
| Include (eager) | `.fork(...)` + `.as()` + `.returning()` | `.include(...)` | Declarative tree replaces fork+alias |
| Mutations | `graph.mutate.create('user', data)` | `graph.User.create(data)` | Schema-derived |
| Link | `graph.mutate.link('authored', from, to)` | `graph.link(user, 'authored', post)` | Kept, but typed endpoints |

---

## Test Schema

```typescript
import { z } from 'zod'
import { iface, node, edge, method, defineSchema } from '@astrale/builder'

const User = node({
  props: {
    email: z.string().email(),
    name: z.string().min(1),
    age: z.number().int().positive().optional(),
    status: z.enum(['active', 'inactive']).default('active'),
    createdAt: z.string().optional(),
  },
  indexes: [{ property: 'email', type: 'unique' }],
})

const Post = node({
  props: {
    title: z.string().min(1),
    content: z.string().optional(),
    publishedAt: z.string().optional(),
    views: z.number().int().default(0),
  },
})

const Comment = node({
  props: {
    text: z.string().min(1),
    createdAt: z.string().optional(),
  },
})

const Folder = node({
  props: {
    name: z.string(),
    path: z.string(),
  },
})

const Tag = node({
  props: { name: z.string() },
})

const authored = edge(
  { as: 'author', types: [User] },
  { as: 'post', types: [Post], cardinality: '1' },
  { props: { role: z.enum(['author', 'coauthor']).default('author') } },
)

const likes = edge(
  { as: 'fan', types: [User] },
  { as: 'liked', types: [Post] },
)

const follows = edge(
  { as: 'follower', types: [User] },
  { as: 'following', types: [User] },
)

const hasComment = edge(
  { as: 'post', types: [Post] },
  { as: 'comment', types: [Comment], cardinality: '1' },
)

const wroteComment = edge(
  { as: 'commentAuthor', types: [User] },
  { as: 'comment', types: [Comment], cardinality: '1' },
)

const hasParent = edge(
  { as: 'child', types: [Folder], cardinality: '0..1' },
  { as: 'parent', types: [Folder] },
  { noSelf: true, acyclic: true },
)

const tagged = edge(
  { as: 'post', types: [Post] },
  { as: 'tag', types: [Tag] },
)

export const Schema = defineSchema({
  User, Post, Comment, Folder, Tag,
  authored, likes, follows, hasComment, wroteComment, hasParent, tagged,
})
```

### Traversal methods available per node type

| Node | Method | Edge | Goes to | Return type |
|---|---|---|---|---|
| User | `.post()` | authored | Post | `Post[]` |
| User | `.liked()` | likes | Post | `Post[]` |
| User | `.following()` | follows (out) | User | `User[]` |
| User | `.follower()` | follows (in) | User | `User[]` |
| User | `.comment()` | wroteComment | Comment | `Comment[]` |
| Post | `.author()` | authored | User | `User` (cardinality `'1'`) |
| Post | `.fan()` | likes | User | `User[]` |
| Post | `.comment()` | hasComment | Comment | `Comment[]` |
| Post | `.tag()` | tagged | Tag | `Tag[]` |
| Comment | `.post()` | hasComment | Post | `Post` (cardinality `'1'`) |
| Comment | `.commentAuthor()` | wroteComment | User | `User` (cardinality `'1'`) |
| Folder | `.parent()` | hasParent | Folder | `Folder \| null` (cardinality `'0..1'`) |
| Folder | `.child()` | hasParent | Folder | `Folder[]` |
| Tag | `.post()` | tagged | Post | `Post[]` |

### Seed data

```typescript
const alice   = { id: 'user-1',    email: 'alice@example.com',   name: 'Alice',   status: 'active' }
const bob     = { id: 'user-2',    email: 'bob@example.com',     name: 'Bob',     status: 'active' }
const charlie = { id: 'user-3',    email: 'charlie@example.com', name: 'Charlie', status: 'inactive' }

const hello   = { id: 'post-1',    title: 'Hello World',       content: 'My first post',  views: 100 }
const graphql = { id: 'post-2',    title: 'GraphQL vs REST',   content: 'A comparison',   views: 250 }
const draft   = { id: 'post-3',    title: 'Draft Post',        views: 0 }

const great   = { id: 'comment-1', text: 'Great post!' }
const thanks  = { id: 'comment-2', text: 'Thanks for sharing' }

const tech     = { id: 'tag-1',    name: 'tech' }
const tutorial = { id: 'tag-2',    name: 'tutorial' }

const root = { id: 'folder-root', name: 'Root',      path: '/' }
const docs = { id: 'folder-docs', name: 'Documents', path: '/documents' }
const work = { id: 'folder-work', name: 'Work',      path: '/documents/work' }

// Edges:
// authored:      alice → hello, alice → graphql, bob → draft
// likes:         bob → hello, charlie → hello, alice → graphql
// follows:       bob → alice, charlie → alice
// hasComment:    hello → great, hello → thanks
// wroteComment:  bob → great, charlie → thanks
// tagged:        hello → tech, graphql → tech, graphql → tutorial
// hasParent:     docs → root, work → docs
```

---

## 1 · Query — Basic matching

### 1.1 Collection queries

```typescript
// 1.1.1 — fetch all nodes of a type
const users = await graph.User.execute()
expect(users).toHaveLength(3)

// 1.1.2 — fetch node by ID
const alice = await graph.User.byId('user-1').execute()
expect(alice.name).toBe('Alice')

// 1.1.3 — return empty for non-existent node
const users = await graph.User.where('name', 'eq', 'Nobody').execute()
expect(users).toHaveLength(0)
```

### 1.2 Match with inheritance

```typescript
// 1.2.1 — node with implements gets inherited labels
// When User implements [Timestamped], matching User also matches :Timestamped
const users = await graph.User.execute()
// Cypher should include inherited labels in MATCH pattern

// 1.2.2 — node without implements uses single label
const tags = await graph.Tag.execute()
// Cypher should match (:Tag) only
```

---

## 2 · Query — WHERE filtering

### 2.1 Comparison operators

```typescript
// 2.1.1 — equality
graph.User.where('status', 'eq', 'active').execute()

// 2.1.2 — inequality
graph.User.where('status', 'neq', 'inactive').execute()

// 2.1.3 — greater than
graph.Post.where('views', 'gt', 50).execute()

// 2.1.4 — greater than or equal
graph.Post.where('views', 'gte', 100).execute()

// 2.1.5 — less than
graph.Post.where('views', 'lt', 200).execute()

// 2.1.6 — less than or equal
graph.Post.where('views', 'lte', 100).execute()

// 2.1.7 — IN list
graph.User.where('name', 'in', ['Alice', 'Bob']).execute()

// 2.1.8 — NOT IN list
graph.User.where('name', 'notIn', ['Charlie']).execute()

// 2.1.9 — contains
graph.Post.where('title', 'contains', 'World').execute()

// 2.1.10 — startsWith
graph.User.where('name', 'startsWith', 'A').execute()

// 2.1.11 — endsWith
graph.User.where('name', 'endsWith', 'ce').execute()

// 2.1.12 — isNull
graph.Post.where('content', 'isNull').execute()

// 2.1.13 — isNotNull
graph.Post.where('content', 'isNotNull').execute()

// 2.1.14 — chained WHERE (AND)
graph.Post.where('views', 'gt', 50).where('views', 'lt', 200).execute()
```

### 2.2 Complex WHERE (boolean logic)

```typescript
// 2.2.1 — OR
graph.User.whereComplex(w => w.or(
  w.cond('status', 'eq', 'active'),
  w.cond('name', 'eq', 'Charlie'),
)).execute()

// 2.2.2 — AND + OR nested: (A AND (B OR C))
graph.Post.whereComplex(w => w.and(
  w.cond('views', 'gt', 0),
  w.or(
    w.cond('title', 'contains', 'World'),
    w.cond('title', 'contains', 'GraphQL'),
  ),
)).execute()

// 2.2.3 — NOT
graph.User.whereComplex(w => w.not(
  w.cond('status', 'eq', 'inactive'),
)).execute()

// 2.2.4 — deeply nested: ((A OR B) AND (C OR D))
graph.Post.whereComplex(w => w.and(
  w.or(w.cond('views', 'gt', 50), w.cond('views', 'lt', 10)),
  w.or(w.cond('title', 'contains', 'Hello'), w.cond('title', 'contains', 'REST')),
)).execute()

// 2.2.5 — NOT with OR (De Morgan)
graph.User.whereComplex(w => w.not(
  w.or(w.cond('status', 'eq', 'active'), w.cond('name', 'eq', 'Bob')),
)).execute()

// 2.2.6 — multiple NOT conditions
graph.User.whereComplex(w => w.and(
  w.not(w.cond('status', 'eq', 'inactive')),
  w.not(w.cond('name', 'eq', 'Charlie')),
)).execute()

// 2.2.7 — empty AND returns all results
graph.User.whereComplex(w => w.and()).execute()

// 2.2.8 — combining whereComplex with regular where
graph.User.where('status', 'eq', 'active').whereComplex(w =>
  w.or(w.cond('name', 'eq', 'Alice'), w.cond('name', 'eq', 'Bob')),
).execute()
```

### 2.3 Edge existence filtering

```typescript
// 2.3.1 — hasEdge (outgoing)
graph.User.hasEdge('authored', 'out').execute()

// 2.3.2 — hasEdge (incoming)
graph.Post.hasEdge('authored', 'in').execute()

// 2.3.3 — hasEdge (both directions)
graph.User.hasEdge('follows', 'both').execute()

// 2.3.4 — hasNoEdge
graph.User.hasNoEdge('authored', 'out').execute()
```

### 2.4 Connected-to filtering

```typescript
// 2.4.1 — whereConnectedTo (outgoing)
graph.User.whereConnectedTo('authored', 'post-1').execute()

// 2.4.2 — whereConnectedFrom (incoming)
graph.Post.whereConnectedFrom('authored', 'user-1').execute()

// 2.4.3 — chained whereConnectedTo
graph.User
  .whereConnectedTo('authored', 'post-1')
  .whereConnectedTo('likes', 'post-2')
  .execute()

// 2.4.4 — whereConnectedTo after traversal
graph.User.byId('user-1').post().whereConnectedTo('tagged', 'tag-1').execute()

// 2.4.5 — 3 constraints
graph.User
  .whereConnectedTo('authored', 'post-1')
  .whereConnectedTo('likes', 'post-2')
  .whereConnectedTo('follows', 'user-2')
  .execute()

// 2.4.6 — 5 constraints
graph.User
  .whereConnectedTo('authored', 'post-1')
  .whereConnectedTo('authored', 'post-2')
  .whereConnectedTo('likes', 'post-1')
  .whereConnectedTo('follows', 'user-2')
  .whereConnectedTo('follows', 'user-3')
  .execute()

// 2.4.7 — mixed directions
graph.User
  .whereConnectedTo('authored', 'post-1')
  .whereConnectedFrom('follows', 'user-2')
  .execute()

// 2.4.8 — interleaved with property filters
graph.User
  .where('status', 'eq', 'active')
  .whereConnectedTo('authored', 'post-1')
  .where('name', 'startsWith', 'A')
  .execute()

// 2.4.9 — traversal → connectedTo → traversal → connectedTo
graph.User.byId('user-1')
  .post()
  .whereConnectedTo('tagged', 'tag-1')
  .comment()
  .whereConnectedTo('wroteComment', 'user-2')
  .execute()

// 2.4.10 — on descendants
graph.Folder.byId('folder-root').descendants().whereConnectedTo('hasParent', 'folder-docs').execute()
```

---

## 3 · Query — Ordering & pagination

```typescript
// 3.1 — orderBy ascending (default)
graph.Post.orderBy('views').execute()

// 3.2 — orderBy ascending (explicit)
graph.Post.orderBy('views', 'ASC').execute()

// 3.3 — orderBy descending
graph.Post.orderBy('views', 'DESC').execute()

// 3.4 — orderBy multiple fields
graph.Post.orderBy('views', 'DESC').orderBy('title', 'ASC').execute()

// 3.5 — limit
graph.User.limit(2).execute()

// 3.6 — skip
graph.User.skip(1).execute()

// 3.7 — skip + limit
graph.User.skip(1).limit(2).execute()

// 3.8 — paginate helper
graph.Post.paginate({ page: 2, pageSize: 2 }).execute()

// 3.9 — distinct
graph.User.distinct().execute()

// 3.10 — combines where + orderBy + pagination
graph.Post.where('views', 'gt', 0).orderBy('views', 'DESC').limit(2).execute()

// 3.11 — pagination consistency with stable sort
// page 1 and page 2 must not overlap
const page1 = await graph.Post.orderBy('title').paginate({ page: 1, pageSize: 2 }).execute()
const page2 = await graph.Post.orderBy('title').paginate({ page: 2, pageSize: 2 }).execute()

// 3.12 — distinct + where
graph.User.where('status', 'eq', 'active').distinct().execute()

// 3.13 — distinct + orderBy + pagination
graph.User.distinct().orderBy('name').limit(2).execute()
```

---

## 4 · Query — Edge traversal

### 4.1 Basic traversal

```typescript
// 4.1.1 — outbound: user → posts (via authored)
const posts = await graph.User.byId('user-1').post().execute()
expect(posts).toHaveLength(2)

// 4.1.2 — inbound: post → author (via authored, cardinality '1')
const author = await graph.Post.byId('post-1').author().execute()
expect(author.name).toBe('Alice')
// Return type: User (not User[] — cardinality '1' means exactly one)

// 4.1.3 — chained traversals: user → post → comment
const comments = await graph.User.byId('user-1').post().comment().execute()

// 4.1.4 — three-hop: user → post → comment → commentAuthor
const commenters = await graph.User.byId('user-1').post().comment().commentAuthor().execute()
```

### 4.2 Optional traversal

```typescript
// 4.2.1 — optional returns null when no match
const parent = await graph.Folder.byId('folder-root').parent().execute()
expect(parent).toBeNull()
// Return type: Folder | null (cardinality '0..1')

// 4.2.2 — optional returns value when match exists
const parent = await graph.Folder.byId('folder-docs').parent().execute()
expect(parent.name).toBe('Root')

// 4.2.3 — chained optional traversals
const grandparent = await graph.Folder.byId('folder-work').parent().parent().execute()
```

### 4.3 Self-referencing edges

```typescript
// 4.3.1 — self-ref outbound: who does this user follow?
const following = await graph.User.byId('user-2').following().execute()
expect(following[0].name).toBe('Alice')

// 4.3.2 — self-ref inbound: who follows this user?
const followers = await graph.User.byId('user-1').follower().execute()
expect(followers).toHaveLength(2)

// 4.3.3 — self-loop: user following themselves
// (depends on schema constraints — follows has no noSelf)

// 4.3.4 — mutual relationships
// bob follows alice, check both directions
```

### 4.4 Edge property filtering

```typescript
// 4.4.1 — filter edges by property
const coauthored = await graph.User.byId('user-1').post({ edgeWhere: { role: 'coauthor' } }).execute()

// 4.4.2 — multiple edge property filters
graph.User.byId('user-1').post({ edgeWhere: { role: 'author' } }).execute()

// 4.4.3 — edge property IN filter
graph.User.post({ edgeWhere: { role: { in: ['author', 'coauthor'] } } }).execute()
```

### 4.5 Variable-length paths

```typescript
// 4.5.1 — unbounded depth (followers at any distance)
graph.User.byId('user-1').follower({ depth: { min: 1 } }).execute()

// 4.5.2 — bounded depth (followers at distance 2-3)
graph.User.byId('user-1').following({ depth: { min: 2, max: 3 } }).execute()

// 4.5.3 — exact depth
graph.User.byId('user-1').following({ depth: { min: 2, max: 2 } }).execute()

// 4.5.4 — zero-or-more (includes self)
graph.User.byId('user-1').following({ depth: { min: 0 } }).execute()

// 4.5.5 — distinct removes duplicates from variable-length paths
graph.User.byId('user-1').following({ depth: { min: 1, max: 3 } }).distinct().execute()
```

### 4.6 Traversal from collection

```typescript
// 4.6.1 — from filtered collection: active users → their posts
graph.User.where('status', 'eq', 'active').post().execute()

// 4.6.2 — collection traversal with further filtering
graph.User.where('status', 'eq', 'active').post().where('views', 'gt', 50).execute()
```

---

## 5 · Query — Hierarchy

### 5.1 Parent & children

```typescript
// 5.1.1 — parent (default hierarchy edge)
const parent = await graph.Folder.byId('folder-docs').parent().execute()
expect(parent.name).toBe('Root')

// 5.1.2 — parent with explicit edge
graph.Folder.byId('folder-docs').parent('hasParent').execute()

// 5.1.3 — children (default hierarchy edge)
const children = await graph.Folder.byId('folder-root').children().execute()
expect(children).toHaveLength(1)

// 5.1.4 — children with explicit edge
graph.Folder.byId('folder-root').children('hasParent').execute()
```

### 5.2 Ancestors

```typescript
// 5.2.1 — all ancestors (unbounded)
const ancestors = await graph.Folder.byId('folder-work').ancestors().execute()
expect(ancestors).toHaveLength(2) // docs + root

// 5.2.2 — ancestors with maxDepth
graph.Folder.byId('folder-work').ancestors({ maxDepth: 1 }).execute()

// 5.2.3 — ancestors with min and max depth
graph.Folder.byId('folder-work').ancestors({ minDepth: 1, maxDepth: 2 }).execute()

// 5.2.4 — ancestors with depth information
graph.Folder.byId('folder-work').ancestors({ includeDepth: true }).execute()

// 5.2.5 — ancestors with explicit edge
graph.Folder.byId('folder-work').ancestors({ edge: 'hasParent' }).execute()

// 5.2.6 — ancestors with untilKind filter
graph.Folder.byId('folder-work').ancestors({ until: 'Root' }).execute()

// 5.2.7 — ancestors with untilKind and maxDepth
graph.Folder.byId('folder-work').ancestors({ until: 'Root', maxDepth: 5 }).execute()
```

### 5.3 Descendants

```typescript
// 5.3.1 — all descendants (unbounded)
const desc = await graph.Folder.byId('folder-root').descendants().execute()
expect(desc).toHaveLength(2) // docs + work

// 5.3.2 — descendants with maxDepth
graph.Folder.byId('folder-root').descendants({ maxDepth: 1 }).execute()

// 5.3.3 — descendants with depth information
graph.Folder.byId('folder-root').descendants({ includeDepth: true }).execute()

// 5.3.4 — descendants with explicit edge
graph.Folder.byId('folder-root').descendants({ edge: 'hasParent' }).execute()
```

### 5.4 Siblings

```typescript
// 5.4.1 — siblings (nodes with same parent)
graph.Folder.byId('folder-docs').siblings().execute()

// 5.4.2 — siblings with explicit edge
graph.Folder.byId('folder-docs').siblings({ edge: 'hasParent' }).execute()
```

### 5.5 Root

```typescript
// 5.5.1 — root (topmost ancestor)
const root = await graph.Folder.byId('folder-work').root().execute()
expect(root.name).toBe('Root')

// 5.5.2 — root with explicit edge
graph.Folder.byId('folder-work').root({ edge: 'hasParent' }).execute()
```

### 5.6 Reachable (transitive closure)

```typescript
// 5.6.1 — reachable via single edge
graph.Folder.byId('folder-work').reachable('hasParent').execute()

// 5.6.2 — reachable with maxDepth
graph.Folder.byId('folder-work').reachable('hasParent', { maxDepth: 1 }).execute()

// 5.6.3 — reachable with minDepth (skip close nodes)
graph.Folder.byId('folder-work').reachable('hasParent', { minDepth: 2 }).execute()

// 5.6.4 — reachable with minDepth + maxDepth
graph.Folder.byId('folder-work').reachable('hasParent', { minDepth: 1, maxDepth: 2 }).execute()

// 5.6.5 — selfAndReachable (includes starting node)
graph.Folder.byId('folder-work').reachable('hasParent', { includeSelf: true }).execute()

// 5.6.6 — reachable with includeDepth
graph.Folder.byId('folder-work').reachable('hasParent', { includeDepth: true }).execute()

// 5.6.7 — reachable from root returns empty
const r = await graph.Folder.byId('folder-root').reachable('hasParent').execute()
expect(r).toHaveLength(0)

// 5.6.8 — reachable with direction option
graph.Folder.byId('folder-root').reachable('hasParent', { direction: 'in' }).execute()

// 5.6.9 — reachable with filtering on reachable nodes
graph.Folder.byId('folder-work').ancestors().where('name', 'eq', 'Root').execute()

// 5.6.10 — reachable with cycles does not infinite loop
// (uses follows edge on User which can have cycles)
graph.User.byId('user-1').reachable('follows').execute()
```

---

## 6 · Query — Aggregation

### 6.1 Count

```typescript
// 6.1.1 — count all
const count = await graph.User.count()
expect(count).toBe(3)

// 6.1.2 — count with filter
const active = await graph.User.where('status', 'eq', 'active').count()
expect(active).toBe(2)

// 6.1.3 — exists (true case)
const exists = await graph.User.where('name', 'eq', 'Alice').exists()
expect(exists).toBe(true)

// 6.1.4 — exists (false case)
const exists = await graph.User.where('name', 'eq', 'Nobody').exists()
expect(exists).toBe(false)
```

### 6.2 GroupBy + aggregation

```typescript
// 6.2.1 — groupBy with count (default alias)
graph.User.groupBy('status').count().execute()

// 6.2.2 — groupBy with count (custom alias)
graph.User.groupBy('status').count({ as: 'total' }).execute()

// 6.2.3 — groupBy by multiple fields
graph.Post.groupBy('views', 'title').count().execute()

// 6.2.4 — groupBy with sum
graph.Post.groupBy('title').sum('views').execute()

// 6.2.5 — groupBy with avg
graph.Post.groupBy('title').avg('views').execute()

// 6.2.6 — groupBy with min
graph.Post.groupBy('title').min('views').execute()

// 6.2.7 — groupBy with max
graph.Post.groupBy('title').max('views').execute()

// 6.2.8 — groupBy with min + max together
graph.Post.groupBy('title').min('views').max('views').execute()

// 6.2.9 — groupBy with collect
graph.User.groupBy('status').collect('name').execute()

// 6.2.10 — groupBy with collectDistinct
graph.User.groupBy('status').collectDistinct('name').execute()

// 6.2.11 — combines count + sum
graph.Post.groupBy('title').count().sum('views').execute()

// 6.2.12 — combines count + sum + avg
graph.Post.groupBy('title').count().sum('views').avg('views').execute()

// 6.2.13 — combines all numeric aggregations
graph.Post.groupBy('title').count().sum('views').avg('views').min('views').max('views').execute()

// 6.2.14 — combines count + collect
graph.User.groupBy('status').count().collect('name').execute()
```

### 6.3 Ordering & pagination with groupBy

```typescript
// 6.3.1 — orderBy group field ascending
graph.User.groupBy('status').count().orderBy('status', 'ASC').execute()

// 6.3.2 — orderBy group field descending
graph.User.groupBy('status').count().orderBy('status', 'DESC').execute()

// 6.3.3 — orderBy aggregation result
graph.User.groupBy('status').count().orderBy('count', 'DESC').execute()

// 6.3.4 — orderBy sum result
graph.Post.groupBy('title').sum('views').orderBy('sum', 'DESC').execute()

// 6.3.5 — multiple orderBy on grouped
graph.User.groupBy('status').count().orderBy('count', 'DESC').orderBy('status', 'ASC').execute()

// 6.3.6 — limit on grouped
graph.User.groupBy('status').count().limit(1).execute()

// 6.3.7 — skip on grouped
graph.User.groupBy('status').count().skip(1).execute()

// 6.3.8 — skip + limit on grouped
graph.User.groupBy('status').count().skip(1).limit(1).execute()
```

### 6.4 Filter before groupBy

```typescript
// 6.4.1 — where before groupBy
graph.User.where('status', 'eq', 'active').groupBy('status').count().execute()

// 6.4.2 — where > before sum
graph.Post.where('views', 'gt', 0).groupBy('title').sum('views').execute()

// 6.4.3 — multiple where before groupBy
graph.Post.where('views', 'gt', 0).where('views', 'lt', 300).groupBy('title').count().execute()
```

### 6.5 GroupBy after traversal

```typescript
// 6.5.1 — groupBy on traversed nodes
graph.User.byId('user-1').post().groupBy('title').count().execute()

// 6.5.2 — sum after traversal
graph.User.byId('user-1').post().groupBy('title').sum('views').execute()
```

### 6.6 Edge cases

```typescript
// 6.6.1 — groupBy returns empty when no matches
graph.User.where('name', 'eq', 'Nobody').groupBy('status').count().execute()

// 6.6.2 — groupBy without aggregation returns group keys only
graph.User.groupBy('status').execute()

// 6.6.3 — sum on zero-value field returns 0
graph.Post.where('views', 'eq', 0).groupBy('title').sum('views').execute()
```

---

## 7 · Query — Set operations

### 7.1 Union

```typescript
// 7.1.1 — union deduplicates results
const q1 = graph.User.where('status', 'eq', 'active')
const q2 = graph.User.where('name', 'eq', 'Alice')
const result = await graph.union(q1, q2).execute()

// 7.1.2 — union of disjoint sets returns all
const q1 = graph.User.where('name', 'eq', 'Alice')
const q2 = graph.User.where('name', 'eq', 'Bob')
const result = await graph.union(q1, q2).execute()
expect(result).toHaveLength(2)

// 7.1.3 — union preserves data integrity
// All properties present on returned nodes
```

### 7.2 UnionAll

```typescript
// 7.2.1 — unionAll preserves duplicates
const q1 = graph.User.where('status', 'eq', 'active')
const q2 = graph.User.where('name', 'eq', 'Alice')
const result = await graph.unionAll(q1, q2).execute()

// 7.2.2 — unionAll returns exact count from both queries
const q1 = graph.User.where('status', 'eq', 'active') // 2
const q2 = graph.User.where('name', 'eq', 'Alice')    // 1
const result = await graph.unionAll(q1, q2).execute()
expect(result).toHaveLength(3)
```

### 7.3 Intersect

```typescript
// 7.3.1 — intersect returns only common results
const q1 = graph.User.where('status', 'eq', 'active')
const q2 = graph.User.where('name', 'startsWith', 'A')
const result = await graph.intersect(q1, q2).execute()

// 7.3.2 — intersect of disjoint sets returns empty
const q1 = graph.User.where('name', 'eq', 'Alice')
const q2 = graph.User.where('name', 'eq', 'Bob')
const result = await graph.intersect(q1, q2).execute()
expect(result).toHaveLength(0)

// 7.3.3 — intersect with multiple overlapping criteria
// 7.3.4 — intersect preserves complete node data
```

### 7.4 Edge cases

```typescript
// 7.4.1 — union with empty query
graph.union(graph.User.where('name', 'eq', 'Alice'), graph.User.where('name', 'eq', 'Nobody')).execute()

// 7.4.2 — intersect with empty query returns empty
graph.intersect(graph.User, graph.User.where('name', 'eq', 'Nobody')).execute()

// 7.4.3 — set operations with 3+ queries
graph.union(q1, q2, q3).execute()
graph.unionAll(q1, q2, q3).execute()
graph.intersect(q1, q2, q3).execute()

// 7.4.4 — union result can be further queried (orderBy)
graph.union(q1, q2).orderBy('name').execute()

// 7.4.5 — intersect result can be further queried (orderBy)
graph.intersect(q1, q2).orderBy('name').execute()

// 7.4.6 — set operations on Post queries
graph.union(
  graph.Post.where('views', 'gt', 200),
  graph.Post.where('views', 'lt', 10),
).execute()
```

---

## 8 · Query — Include (replaces fork + alias + returning)

```typescript
// 8.1 — include 2 branches from single node
const result = await graph.User.byId('user-1')
  .include(u => ({
    posts: u.post(),
    following: u.following(),
  }))
  .execute()
// result.posts: Post[], result.following: User[]

// 8.2 — include 4 branches
const result = await graph.User.byId('user-1')
  .include(u => ({
    posts: u.post(),
    liked: u.liked(),
    following: u.following(),
    comments: u.comment(),
  }))
  .execute()

// 8.3 — include from collection
const results = await graph.User.where('status', 'eq', 'active')
  .include(u => ({
    posts: u.post(),
    following: u.following(),
  }))
  .execute()
// results[0].posts: Post[], results[0].following: User[]

// 8.4 — multi-hop traversal inside branch
const result = await graph.User.byId('user-1')
  .include(u => ({
    commenters: u.post().comment().commentAuthor(),
  }))
  .execute()

// 8.5 — filtering inside branch
const result = await graph.User.byId('user-1')
  .include(u => ({
    topPosts: u.post().where('views', 'gt', 100),
  }))
  .execute()

// 8.6 — include returns empty array when branch has no matches
const result = await graph.User.byId('user-3')
  .include(u => ({
    posts: u.post(), // charlie has no authored posts
  }))
  .execute()
expect(result.posts).toHaveLength(0)

// 8.7 — include with ordering before include
const results = await graph.User.orderBy('name').limit(2)
  .include(u => ({
    posts: u.post(),
  }))
  .execute()

// 8.8 — include after initial traversal
const result = await graph.User.byId('user-1').post()
  .include(p => ({
    comments: p.comment(),
    tags: p.tag(),
  }))
  .execute()

// 8.9 — social feed pattern: posts with author, likes, comments, tags
const feed = await graph.Post.orderBy('views', 'DESC').limit(10)
  .include(p => ({
    author: p.author(),
    fans: p.fan(),
    comments: p.comment().include(c => ({
      author: c.commentAuthor(),
    })),
    tags: p.tag(),
  }))
  .execute()

// 8.10 — user profile pattern: user with posts, followers, following
const profile = await graph.User.byId('user-1')
  .include(u => ({
    posts: u.post().orderBy('views', 'DESC'),
    followers: u.follower(),
    following: u.following(),
  }))
  .execute()

// 8.11 — comment thread pattern: post with comments and comment authors
const thread = await graph.Post.byId('post-1')
  .include(p => ({
    comments: p.comment().include(c => ({
      author: c.commentAuthor(),
    })),
  }))
  .execute()

// 8.12 — include with collectDistinct
const result = await graph.User.byId('user-1')
  .include(u => ({
    tagNames: u.post().tag().distinct(),
  }))
  .execute()
```

---

## 9 · Query — Execution

### 9.1 CollectionBuilder

```typescript
// 9.1.1 — execute returns array
const users = await graph.User.execute()
expect(Array.isArray(users)).toBe(true)

// 9.1.2 — execute returns empty array when no results
const none = await graph.User.where('name', 'eq', 'Nobody').execute()
expect(none).toHaveLength(0)

// 9.1.3 — count returns number
const n = await graph.User.count()
expect(typeof n).toBe('number')

// 9.1.4 — count with filter
const n = await graph.User.where('status', 'eq', 'active').count()
expect(n).toBe(2)

// 9.1.5 — count returns 0 when no results
const n = await graph.User.where('name', 'eq', 'Nobody').count()
expect(n).toBe(0)
```

### 9.2 SingleNodeBuilder

```typescript
// 9.2.1 — execute returns single node
const alice = await graph.User.byId('user-1').execute()
expect(alice.name).toBe('Alice')

// 9.2.2 — execute throws when no results
await expect(graph.User.byId('nonexistent').execute()).rejects.toThrow()

// 9.2.3 — execute throws when multiple results
// (only possible if byId somehow returns multiple — edge case)

// 9.2.4 — executeOrNull returns result when found
const alice = await graph.User.byId('user-1').executeOrNull()
expect(alice).not.toBeNull()

// 9.2.5 — executeOrNull returns null when not found
const result = await graph.User.byId('nonexistent').executeOrNull()
expect(result).toBeNull()

// 9.2.6 — exists returns true when node exists
const exists = await graph.User.byId('user-1').exists()
expect(exists).toBe(true)

// 9.2.7 — exists returns false when node does not exist
const exists = await graph.User.byId('nonexistent').exists()
expect(exists).toBe(false)
```

### 9.3 Cardinality-based return types

```typescript
// 9.3.1 — cardinality '1' → single non-null result
const author: User = await graph.Post.byId('post-1').author().execute()
// Type: User (not User[], not User | null)

// 9.3.2 — cardinality '0..1' → nullable result
const parent: Folder | null = await graph.Folder.byId('folder-root').parent().execute()
// Type: Folder | null

// 9.3.3 — cardinality '0..*' (default) → array
const posts: Post[] = await graph.User.byId('user-1').post().execute()
// Type: Post[]

// 9.3.4 — cardinality '1..*' → non-empty array
// (no such edge in test schema, but type should be T[])
```

---

## 10 · Query — Compilation

```typescript
// 10.1 — compile returns cypher + params
const compiled = graph.User.where('status', 'eq', 'active').compile()
expect(compiled.cypher).toContain('MATCH')
expect(compiled.params).toHaveProperty('p0')

// 10.2 — uses parameters for values (not inline)
const compiled = graph.User.where('name', 'eq', 'Alice').compile()
expect(compiled.cypher).not.toContain("'Alice'")

// 10.3 — includes all required clauses
const compiled = graph.Post.where('views', 'gt', 0).orderBy('views').limit(10).compile()
expect(compiled.cypher).toContain('MATCH')
expect(compiled.cypher).toContain('WHERE')
expect(compiled.cypher).toContain('ORDER BY')
expect(compiled.cypher).toContain('LIMIT')
expect(compiled.cypher).toContain('RETURN')
```

---

## 11 · Mutation — Node CRUD

```typescript
// 11.1 — create
const user = await graph.User.create({ email: 'dave@example.com', name: 'Dave' })
expect(user.id).toBeDefined()
expect(user.name).toBe('Dave')
expect(user.status).toBe('active') // default value

// 11.2 — create with custom ID
const user = await graph.User.create({ id: 'user-custom', email: 'eve@example.com', name: 'Eve' })
expect(user.id).toBe('user-custom')

// 11.3 — update
const updated = await graph.User.update('user-1', { name: 'Alice Updated' })
expect(updated.name).toBe('Alice Updated')

// 11.4 — delete (without relationships)
await graph.Tag.delete('tag-1')

// 11.5 — delete with detach (removes relationships)
await graph.User.delete('user-3', { detach: true })

// 11.6 — upsert creates when node does not exist
const result = await graph.User.upsert('user-new', { email: 'new@example.com', name: 'New' })
expect(result.created).toBe(true)

// 11.7 — upsert updates when node exists
const result = await graph.User.upsert('user-1', { email: 'alice@updated.com', name: 'Alice' })
expect(result.created).toBe(false)

// 11.8 — upsert preserves node ID
const r1 = await graph.User.upsert('user-x', { email: 'x@test.com', name: 'X' })
const r2 = await graph.User.upsert('user-x', { email: 'x@updated.com', name: 'X' })
expect(r1.id).toBe(r2.id)

// 11.9 — upsert with partial data updates only provided fields
await graph.User.upsert('user-1', { name: 'Alice V2' })
const u = await graph.User.byId('user-1').execute()
expect(u.email).toBe('alice@example.com') // unchanged

// 11.10 — multiple sequential upserts maintain consistency
```

---

## 12 · Mutation — Edge CRUD

```typescript
// 12.1 — link with properties
await graph.link(alice, 'authored', newPost, { role: 'author' })

// 12.2 — link without properties
await graph.link(bob, 'likes', post1)

// 12.3 — unlink
await graph.unlink(bob, 'likes', post1)

// 12.4 — patchLink (update edge props by endpoints)
await graph.patchLink('authored', 'user-1', 'post-1', { role: 'coauthor' })

// 12.5 — patchLinkById (update edge props by edge ID)
await graph.patchLinkById('authored', edgeId, { role: 'coauthor' })

// 12.6 — patchLinkById throws when edge not found
await expect(graph.patchLinkById('authored', 'nonexistent', { role: 'coauthor' })).rejects.toThrow()

// 12.7 — unlinkById
await graph.unlinkById('authored', edgeId)
```

---

## 13 · Mutation — Hierarchy

```typescript
// 13.1 — createChild
const sub = await graph.Folder.createChild('folder-docs', { name: 'Archive', path: '/documents/archive' })
const parent = await graph.Folder.byId(sub.id).parent().execute()
expect(parent.id).toBe('folder-docs')

// 13.2 — move node to new parent
await graph.Folder.move('folder-work', 'folder-root')
const parent = await graph.Folder.byId('folder-work').parent().execute()
expect(parent.id).toBe('folder-root')

// 13.3 — moveSubtree
await graph.Folder.moveSubtree('folder-docs', 'folder-new-root')

// 13.4 — deleteSubtree
await graph.Folder.deleteSubtree('folder-docs')
// folder-docs and folder-work both deleted
```

---

## 14 · Mutation — Clone

```typescript
// 14.1 — clone creates new node with same properties
const clone = await graph.User.clone('user-1')
expect(clone.name).toBe('Alice')
expect(clone.id).not.toBe('user-1')

// 14.2 — clone with property overrides
const clone = await graph.User.clone('user-1', { name: 'Alice Clone' })
expect(clone.name).toBe('Alice Clone')

// 14.3 — clone does not copy outgoing edges
// 14.4 — clone does not copy incoming edges
// 14.5 — clone preserves all properties including optional

// 14.6 — clone with preserveParent
const clone = await graph.Folder.clone('folder-docs', {}, { preserveParent: true })
// clone has same parent as original

// 14.7 — clone with new parentId
const clone = await graph.Folder.clone('folder-docs', {}, { parentId: 'folder-root' })

// 14.8 — clone without hierarchy options creates orphan

// 14.9 — cloneSubtree copies node and all descendants
const result = await graph.Folder.cloneSubtree('folder-root')

// 14.10 — cloneSubtree preserves internal hierarchy structure
// 14.11 — cloneSubtree with maxDepth limits clone depth
await graph.Folder.cloneSubtree('folder-root', { maxDepth: 1 })

// 14.12 — cloneSubtree with maxDepth=0 clones only root
// 14.13 — cloneSubtree with transform function
await graph.Folder.cloneSubtree('folder-root', {
  transform: (data, depth) => ({ ...data, name: `Copy of ${data.name}` }),
})

// 14.14 — cloneSubtree with parentId
// 14.15 — cloneSubtree returns correct idMapping
// 14.16 — cloneSubtree does not affect original nodes
// 14.17 — cloneSubtree handles leaf node

// 14.18 — clone throws when source does not exist
await expect(graph.User.clone('nonexistent')).rejects.toThrow()
// 14.19 — cloneSubtree throws when source root does not exist
```

---

## 15 · Mutation — Batch

```typescript
// 15.1 — createMany
const tags = await graph.Tag.createMany([
  { name: 'javascript' },
  { name: 'typescript' },
  { name: 'rust' },
])
expect(tags).toHaveLength(3)

// 15.2 — updateMany
await graph.User.updateMany([
  { id: 'user-1', data: { name: 'Alice V2' } },
  { id: 'user-2', data: { name: 'Bob V2' } },
])

// 15.3 — deleteMany
await graph.Tag.deleteMany(['tag-1', 'tag-2'])

// 15.4 — linkMany
await graph.linkMany('tagged', [
  { from: 'post-1', to: 'tag-1' },
  { from: 'post-2', to: 'tag-1' },
  { from: 'post-2', to: 'tag-2' },
])

// 15.5 — linkMany with empty array (no-op)
await graph.linkMany('tagged', [])

// 15.6 — linkMany with edge properties
await graph.linkMany('authored', [
  { from: 'user-1', to: 'post-1', data: { role: 'author' } },
  { from: 'user-2', to: 'post-3', data: { role: 'coauthor' } },
])

// 15.7 — unlinkMany
await graph.unlinkMany('tagged', [
  { from: 'post-1', to: 'tag-1' },
  { from: 'post-2', to: 'tag-2' },
])

// 15.8 — unlinkMany with empty array (no-op)
await graph.unlinkMany('tagged', [])

// 15.9 — unlinkMany returns 0 for non-existent edges
const result = await graph.unlinkMany('tagged', [{ from: 'post-1', to: 'tag-nonexistent' }])
expect(result.deleted).toBe(0)

// 15.10 — unlinkAllFrom
await graph.unlinkAllFrom('tagged', 'post-1')

// 15.11 — unlinkAllFrom returns 0 when no edges
await graph.unlinkAllFrom('tagged', 'post-nonexistent')

// 15.12 — unlinkAllFrom only deletes specified edge type
await graph.unlinkAllFrom('likes', 'user-2')
// authored edges from user-2 remain

// 15.13 — unlinkAllTo
await graph.unlinkAllTo('tagged', 'tag-1')

// 15.14 — unlinkAllTo returns 0 when no edges
// 15.15 — unlinkAllTo only deletes specified edge type
```

---

## 16 · Mutation — Transactions

```typescript
// 16.1 — commit successful transaction
await graph.transaction(async (tx) => {
  const user = await tx.User.create({ email: 'new@test.com', name: 'New' })
  await tx.link(user, 'authored', post)
})

// 16.2 — rollback on error
await expect(graph.transaction(async (tx) => {
  await tx.User.create({ email: 'rollback@test.com', name: 'Rollback' })
  throw new Error('Abort')
})).rejects.toThrow()
const found = await graph.User.where('email', 'eq', 'rollback@test.com').execute()
expect(found).toHaveLength(0) // rolled back

// 16.3 — transaction with complex query + mutation mix
await graph.transaction(async (tx) => {
  const users = await tx.User.where('status', 'eq', 'active').execute()
  for (const u of users) {
    await tx.User.update(u.id, { status: 'inactive' })
  }
})

// 16.4 — transaction rollback preserves existing data
// 16.5 — concurrent creates with different IDs succeed
// 16.6 — concurrent updates to same node (last-write behavior)
// 16.7 — concurrent link and unlink operations
// 16.8 — concurrent batch operations
// 16.9 — upsert within transaction
await graph.transaction(async (tx) => {
  await tx.User.upsert('user-tx', { email: 'tx@test.com', name: 'Tx' })
})
```

---

## 17 · Runtime — Validation

All tests below assume Zod validation from the schema props definition.

```typescript
// 17.1 — invalid email format fails
await expect(graph.User.create({ email: 'not-email', name: 'X' })).rejects.toThrow()

// 17.2 — invalid enum value fails
await expect(graph.User.create({ email: 'a@b.com', name: 'X', status: 'unknown' })).rejects.toThrow()

// 17.3 — missing required field fails
await expect(graph.User.create({ email: 'a@b.com' })).rejects.toThrow()

// 17.4 — invalid type for field fails
await expect(graph.User.create({ email: 'a@b.com', name: 123 })).rejects.toThrow()

// 17.5 — optional field as undefined succeeds
await graph.User.create({ email: 'a@b.com', name: 'X', age: undefined })

// 17.6 — default value used when not provided
const user = await graph.User.create({ email: 'a@b.com', name: 'X' })
expect(user.status).toBe('active')

// 17.7 — update with partial data preserves other fields
await graph.User.update('user-1', { name: 'Updated' })
const u = await graph.User.byId('user-1').execute()
expect(u.email).toBe('alice@example.com')

// 17.8 — update with invalid data fails
await expect(graph.User.update('user-1', { email: 'bad' })).rejects.toThrow()

// 17.9 — extra fields not in schema are stripped
const user = await graph.User.create({ email: 'a@b.com', name: 'X', unknown: 'field' } as any)
expect((user as any).unknown).toBeUndefined()

// 17.10 — batch create with mixed valid/invalid — all or nothing
await expect(graph.User.createMany([
  { email: 'ok@b.com', name: 'OK' },
  { email: 'bad', name: 'Bad' },
])).rejects.toThrow()

// 17.11 — edge props validation
await expect(graph.link(user, 'authored', post, { role: 'invalid' })).rejects.toThrow()

// 17.12 — valid edge props succeed
await graph.link(user, 'authored', post, { role: 'coauthor' })

// 17.13 — empty string for required field fails
await expect(graph.Post.create({ title: '' })).rejects.toThrow()

// 17.14 — null for required field fails
await expect(graph.User.create({ email: null, name: 'X' } as any)).rejects.toThrow()

// 17.15 — negative number where positive required fails
await expect(graph.User.create({ email: 'a@b.com', name: 'X', age: -5 })).rejects.toThrow()

// 17.16 — min length validation
await expect(graph.Post.create({ title: '' })).rejects.toThrow() // min(1)

// 17.17 — valid min length succeeds
await graph.Post.create({ title: 'A' })

// 17.18 — date field validation
// 17.19 — invalid date string fails

// 17.20 — query returns data matching schema types
const user = await graph.User.byId('user-1').execute()
expect(typeof user.email).toBe('string')
expect(typeof user.name).toBe('string')

// 17.21 — upsert with invalid data on create fails
// 17.22 — upsert with valid data creates
// 17.23 — upsert with valid data updates

// 17.24 — query with incorrect node label returns empty
// (not applicable in Builder — labels are schema-derived)

// 17.25 — traverse with wrong edge type returns empty
// (not applicable in Builder — traversals are typed methods)

// 17.26 — error messages are descriptive
```

---

## 18 · Runtime — Integrity violations

```typescript
// 18.1 — delete without detach fails when relationships exist
await expect(graph.User.delete('user-1')).rejects.toThrow()

// 18.2 — delete with detach removes node and relationships
await graph.User.delete('user-1', { detach: true })

// 18.3 — link to non-existent target fails
await expect(graph.link(alice, 'authored', { id: 'nonexistent' })).rejects.toThrow()

// 18.4 — link from non-existent source fails
await expect(graph.link({ id: 'nonexistent' }, 'authored', post)).rejects.toThrow()

// 18.5 — unlink non-existent relationship succeeds silently
await graph.unlink(alice, 'likes', post3) // no likes edge exists

// 18.6 — update non-existent node fails
await expect(graph.User.update('nonexistent', { name: 'X' })).rejects.toThrow()

// 18.7 — circular parent detection
await expect(graph.Folder.move('folder-root', 'folder-work')).rejects.toThrow()

// 18.8 — move node to itself fails
await expect(graph.Folder.move('folder-docs', 'folder-docs')).rejects.toThrow()

// 18.9 — move to non-existent parent fails
await expect(graph.Folder.move('folder-docs', 'nonexistent')).rejects.toThrow()

// 18.10 — batch create validation errors — atomic failure
await expect(graph.Tag.createMany([
  { name: 'ok' },
  { name: '' }, // invalid if min(1) constraint
])).rejects.toThrow()

// 18.11 — unlinkAll removes all relationships of type
await graph.unlinkAllFrom('tagged', 'post-1')
const tags = await graph.Post.byId('post-1').tag().execute()
expect(tags).toHaveLength(0)

// 18.12 — cascade delete via deleteSubtree
await graph.Folder.deleteSubtree('folder-root')
// folder-root, folder-docs, folder-work all deleted
```

---

## 19 · Runtime — Method dispatch & enrichment

```typescript
// 19.1 — method dispatch on node instance
const alice = await graph.User.byId('user-1').execute()
const name = await alice.displayName()
expect(name).toBe('Alice <alice@example.com>')

// 19.2 — method with params
const orders = await alice.recentOrders({ limit: 5 })

// 19.3 — edge method dispatch
const items = await graph.Order.byId('order-1').product().execute()
const sub = await items[0].subtotal()

// 19.4 — throws when method not implemented
// (compile-time error in Builder via defineMethods completeness check)

// 19.5 — dispatches with correct self context
// self has all props including inherited + id

// 19.6 — dispatches with correct args
// args are typed from method params

// 19.7 — node without methods returns raw object
const tag = await graph.Tag.byId('tag-1').execute()
// tag has no methods, just props
```

---

## 20 · Runtime — Constraint enforcement

```typescript
// 20.1 — valid edge creation allowed
await graph.link(alice, 'authored', newPost) // OK

// 20.2 — noSelf rejects self-loop
await expect(graph.link(folder, 'hasParent', folder)).rejects.toThrow()

// 20.3 — unique rejects duplicate
await graph.link(alice, 'authored', post1)
await expect(graph.link(alice, 'authored', post1)).rejects.toThrow()

// 20.4 — acyclic rejects cycle
// folder-work → folder-docs → folder-root
await expect(graph.link(root, 'hasParent', work)).rejects.toThrow()
```

---

## 21 · Runtime — Core refs

```typescript
// 21.1 — core proxy returns leaf node IDs directly
expect(typeof graph.core.someNode).toBe('string')

// 21.2 — supports nested access
expect(typeof graph.core.parent.child).toBe('string')

// 21.3 — supports multi-level nesting
expect(typeof graph.core.a.b.c).toBe('string')

// 21.4 — returns undefined for missing keys
expect(graph.core.nonexistent).toBeUndefined()

// 21.5 — installCore builds flat refs
// 21.6 — installCore builds hierarchical refs
// 21.7 — handles mixed flat and nested

// 21.8 — typed graph.core access
// graph.core.workspace is typed as NodeId from defineCore refs

// 21.9 — core refs are valid node IDs usable in mutations
await graph.User.update(graph.core.adminUser, { name: 'Admin V2' })

// 21.10 — full flow: defineCore → install → typed access
```

---

## 22 · Graph topology

```typescript
// 22.1 — disconnected components: reachable should not cross
// 22.2 — high fan-out: hub node with 100 followers
// 22.3 — high fan-in: node following 100 users
// 22.4 — cycle in non-hierarchy edges (no infinite loop)
// 22.5 — reachable with cycles (no infinite loop)
// 22.6 — fully connected clique
// 22.7 — star topology
// 22.8 — chain topology (linear sequence)
// 22.9 — isolated node (no connections)
// 22.10 — tree topology (no cycles)
```

---

## 23 · Real-world workflow patterns

```typescript
// 23.1 — soft delete: mark as deleted, still queryable with filter
await graph.User.update('user-1', { deletedAt: new Date().toISOString() })
const active = await graph.User.where('deletedAt', 'isNull').execute()

// 23.2 — audit trail: track createdBy, updatedBy, timestamps

// 23.3 — versioning: track document revisions via edges
// new_version → supersedes → old_version

// 23.4 — multi-tenancy: tenant data isolation via property
const tenantPosts = await graph.Post.where('tenantId', 'eq', 'tenant-1').execute()

// 23.5 — rate limiting: track request counts per user

// 23.6 — content moderation: flag and review workflow

// 23.7 — recommendation: friend-of-friend suggestions
const fof = await graph.User.byId('user-1')
  .following()
  .following()
  .distinct()
  .execute()

// 23.8 — activity feed: aggregate recent actions

// 23.9 — permission inheritance: folder permissions cascade down hierarchy
// permissions on root → inherited by docs → inherited by work
```

---

## 24 · Performance edge cases

```typescript
// 24.1 — large IN list with 1000 items
graph.User.where('id', 'in', Array.from({ length: 1000 }, (_, i) => `user-${i}`)).execute()

// 24.2 — deep WHERE nesting (50 levels)
// Build 50-level nested whereComplex

// 24.3 — variable-length path with bounded depth
graph.User.byId('user-1').following({ depth: { min: 1, max: 10 } }).execute()

// 24.4 — fan-out: user with many posts with many comments
// Create 50 posts with 20 comments each, query full tree

// 24.5 — batch create 100 nodes
await graph.Tag.createMany(Array.from({ length: 100 }, (_, i) => ({ name: `tag-${i}` })))

// 24.6 — batch link 500 relationships
await graph.linkMany('tagged', Array.from({ length: 500 }, (_, i) => ({
  from: `post-${i % 50}`, to: `tag-${i % 100}`,
})))

// 24.7 — deep pagination: page 50 of size 1
graph.User.orderBy('name').paginate({ page: 50, pageSize: 1 }).execute()

// 24.8 — distinct on large result set
graph.User.byId('user-1').following({ depth: { min: 1, max: 5 } }).distinct().execute()

// 24.9 — complex WHERE with many fields
graph.User
  .where('status', 'eq', 'active')
  .where('name', 'startsWith', 'A')
  .where('age', 'gt', 18)
  .where('email', 'contains', '@example')
  .execute()

// 24.10 — empty result set operations
graph.User.where('name', 'eq', 'Nobody').post().comment().execute()

// 24.11 — special characters in string filters
graph.User.where('name', 'contains', "O'Brien").execute()
graph.Post.where('title', 'contains', 'quote "here"').execute()
```

---

## 25 · Compilation pipeline

These tests verify internal compilation. The developer never sees Cypher, but we validate correctness.

```typescript
// 25.1 — concrete type match generates instance_of join
// 25.2 — traversal with non-reified edge keeps edge name
// 25.3 — traversal with reified edge generates has_link/links_to
// 25.4 — reified edge with edgeWhere generates WHERE on link node
// 25.5 — inbound reified edge reverses hops
// 25.6 — multi-hop with mixed reified/non-reified edges
// 25.7 — createNode generates instance_of link
// 25.8 — createEdge on reified edge generates link nodes
// 25.9 — updateEdge on reified edge matches link node
// 25.10 — deleteEdge on reified edge detach-deletes link node
// 25.11 — batchLink on reified edge generates link nodes with instance_of
// 25.12 — upsertNode generates MERGE with instance_of
// 25.13 — schema extension merges correctly
// 25.14 — identifier sanitization rejects invalid names
// 25.15 — identifier sanitization accepts valid names
```

---

## Summary

| Category | Tests | Status |
|---|---|---|
| 1 · Basic matching | 5 | — |
| 2 · WHERE filtering | 28 | — |
| 3 · Ordering & pagination | 13 | — |
| 4 · Edge traversal | 18 | — |
| 5 · Hierarchy | 24 | — |
| 6 · Aggregation | 31 | — |
| 7 · Set operations | 14 | — |
| 8 · Include (fork replacement) | 12 | — |
| 9 · Execution | 14 | — |
| 10 · Compilation | 3 | — |
| 11 · Node CRUD | 10 | — |
| 12 · Edge CRUD | 7 | — |
| 13 · Hierarchy mutations | 4 | — |
| 14 · Clone | 19 | — |
| 15 · Batch | 15 | — |
| 16 · Transactions | 9 | — |
| 17 · Validation | 26 | — |
| 18 · Integrity | 12 | — |
| 19 · Methods & enrichment | 7 | — |
| 20 · Constraints | 4 | — |
| 21 · Core refs | 10 | — |
| 22 · Graph topology | 10 | — |
| 23 · Real-world patterns | 9 | — |
| 24 · Performance | 11 | — |
| 25 · Compilation pipeline | 15 | — |
| **Total** | **~330** | |

> Note: TypeGraph has ~700 raw tests but many are duplicates across spec/e2e/integration files testing the same capability at different layers. This spec consolidates to ~330 unique behavioral tests. Passing all of these guarantees full feature parity with TypeGraph.
