# Graph Query Builder

A type-safe, fluent API for building and executing Cypher queries against Neo4j databases.

## Features

- **Full Type Safety**: Schema-driven type inference for nodes, edges, and query results
- **Fluent API**: Intuitive method chaining for building complex graph queries
- **Edge Property Filtering**: Filter on edge properties during traversal
- **Multi-Node Returns**: Return multiple aliased nodes from a single query with `.as()` and `.returning()`
- **Query Composition**: Reusable query fragments with `.pipe()`
- **Implicit IDs**: All nodes and edges have an implicit `id` field
- **Directional Traversal**: Clear semantics for forward, backward, and both-direction edge traversal
- **Read-Only**: Safe query building without mutations

## Installation

```bash
pnpm add typegraph zod
pnpm add neo4j-driver
```

## Quick Start

```typescript
import { defineSchema, node, edge, createGraph } from 'typegraph'
import { z } from 'zod'

// Define your graph schema
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
  },
  edges: {
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { from: 'many', to: 'one' },
      properties: {
        role: z.enum(['author', 'coauthor']),
      },
    }),
    friendOf: edge({
      from: 'user',
      to: 'user',
      cardinality: { from: 'many', to: 'many' },
      properties: {
        since: z.date(),
      },
    }),
  },
})

// Create a graph instance
const graph = createGraph(schema, {
  uri: 'bolt://localhost:7687',
  auth: { username: 'neo4j', password: 'password' },
})

// Simple queries
const users = await graph.node('user').execute()
const user = await graph.node('user').byId('user_123').execute()

// Traversal with edge filtering
const authoredPosts = await graph
  .node('user')
  .byId('user_123')
  .follow('authored', { where: { role: { eq: 'author' } } })
  .execute()

// Multi-node returns with aliases
const results = await graph
  .node('post')
  .as('post')
  .follow('authored')
  .as('author')
  .returning('post', 'author')
  .execute()
// Type: Array<{ post: Post, author: User }>

// Bidirectional traversal
const friends = await graph.node('user').byId('user_123').followBoth('friendOf').execute()

// Query composition
const activeUsers = (builder) => builder.where('status', 'eq', 'active')

const activeUserPosts = await graph.node('user').pipe(activeUsers).follow('authored').execute()
```

## API Overview

### Schema Definition

All nodes and edges implicitly have an `id: string` field. Do not declare it in properties.

```typescript
const schema = defineSchema({
  nodes: {
    user: node({
      properties: {
        /* Zod schemas */
      },
      indexes: ['email'],
    }),
  },
  edges: {
    follows: edge({
      from: 'user',
      to: 'user',
      cardinality: { from: 'many', to: 'many' },
      properties: {
        /* Optional edge properties */
      },
    }),
  },
})
```

### Builders

- **`SingleNodeBuilder`**: Returns exactly one node
- **`CollectionBuilder`**: Returns multiple nodes
- **`OptionalNodeBuilder`**: Returns zero or one node
- **`ReturningBuilder`**: Returns multiple aliased nodes
- **`PathBuilder`**: Returns paths between nodes
- **`GroupedBuilder`**: Returns aggregated results

### Traversal

```typescript
// Follow outgoing edges (respects declared direction: from → to)
.follow('edgeType', { where: { prop: { eq: value } } })

// Follow incoming edges (reverse direction: to → from)
.followInverse('edgeType')

// Follow in both directions (works on any edge)
.followBoth('edgeType')

// Variable-length paths
.followPath('edgeType', { min: 1, max: 3, uniqueness: 'nodes' })
```

### Filtering

```typescript
// Simple conditions
.where('field', 'eq', value)
.where('age', 'gt', 18)

// Complex conditions
.whereComplex(w => w.or(
  w.eq('role', 'admin'),
  w.and(
    w.eq('role', 'user'),
    w.gt('score', 100)
  )
))

// Edge existence
.hasEdge('follows')
.hasNoEdge('blockedBy')
```

### Aliasing and Multi-Node Returns

```typescript
const results = await graph
  .node('thread')
  .as('thread') // Bookmark the thread node
  .follow('createdBy')
  .as('author') // Bookmark the author node
  .follow('department')
  .as('dept') // Bookmark the department node
  .returning('thread', 'author', 'dept') // Return all three
  .execute()

// Type: Array<{ thread: Thread, author: User, dept: Department }>
```

### Aggregation

```typescript
// Group by and aggregate
const stats = await graph
  .node('message')
  .groupBy('threadId')
  .count()
  .avg('wordCount', { alias: 'avgWords' })
  .execute()

// Count shorthand
const count = await graph.node('user').count()
```

### Pagination & Ordering

```typescript
await graph.node('post').orderBy('publishedAt', 'DESC').limit(10).skip(20).execute()

// Or use paginate helper
await graph.node('post').paginate({ page: 3, pageSize: 10 }).execute()
```

## Development

### Prerequisites

- Node.js >= 18.0.0
- Docker (for integration tests)

### Setup

```bash
npm install
```

### Scripts

```bash
npm run build        # Build the library
npm run typecheck    # Type check without emitting
npm run lint         # Run ESLint
npm run test         # Run unit tests
npm run test:watch   # Run tests in watch mode
npm run test:integration  # Run integration tests (requires Memgraph)
```

### Running Integration Tests

Integration tests run against a real Memgraph instance. Start the database first:

```bash
# Start Memgraph (via docker-compose)
npm run memgraph:up

# Run integration tests
npm run test:integration

# Stop Memgraph when done
npm run memgraph:down
```

The Memgraph Lab UI is available at http://localhost:3000 for debugging.

**Environment variables:**

- `MEMGRAPH_URI` - Bolt URI (default: `bolt://localhost:7687`)
- `MEMGRAPH_USER` - Username (optional)
- `MEMGRAPH_PASSWORD` - Password (optional)

## Architecture

The library follows a clean architecture with clear separation of concerns:

```
Schema → AST → Compiler → Executor
  ↓       ↓       ↓          ↓
Types  Query   Cypher    Neo4j
       Builder
```

1. **Schema**: Define your graph structure with Zod schemas
2. **AST**: Immutable query representation
3. **Compiler**: Transform AST to Cypher
4. **Executor**: Execute queries against Neo4j

## License

MIT
