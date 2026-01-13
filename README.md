# Typegraph

Type-safe graph DSL for Cypher (Neo4j/Memgraph/FalkorDB).

[![CI](https://github.com/astrale-os/typegraph/actions/workflows/ci.yml/badge.svg)](https://github.com/astrale-os/typegraph/actions/workflows/ci.yml)

## Packages

| Package                                          | Description                         |
| ------------------------------------------------ | ----------------------------------- |
| [`@astrale/typegraph`](./packages/typegraph)     | Core query builder and mutation DSL |
| [`@astrale/typegraph-memory`](./packages/memory) | In-memory adapter for testing       |

## Installation

```bash
# Core package
pnpm add @astrale/typegraph

# In-memory adapter (for testing)
pnpm add @astrale/typegraph-memory
```

## Usage

### Define a Schema

```typescript
import { defineSchema, node, edge } from '@astrale/typegraph'
import { z } from 'zod'

const schema = defineSchema({
  nodes: {
    user: node({ properties: { name: z.string(), email: z.string().email() } }),
    post: node({ properties: { title: z.string(), content: z.string() } }),
  },
  edges: {
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),
    hasParent: edge({
      from: 'post',
      to: 'post',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },
  hierarchy: { defaultEdge: 'hasParent', direction: 'up' },
})
```

### Create a Graph Instance

```typescript
import { createGraph } from '@astrale/typegraph'

const graph = createGraph(schema, {
  uri: 'bolt://localhost:7687',
  mutationExecutor: myAdapter,
})
```

### Queries

```typescript
// All users
const users = await graph.node('user').execute()

// User by ID
const user = await graph.node('user').byId(userId).execute()

// Users with filter
const activeUsers = await graph.node('user').where('status', 'eq', 'active').execute()

// Traverse edges
const posts = await graph.node('user').byId(userId).to('authored').execute()

// Hierarchy traversal
const ancestors = await graph.node('post').byId(postId).ancestors().execute()
```

### Mutations

```typescript
// Create
const user = await graph.mutate.create('user', {
  name: 'John',
  email: 'john@example.com',
})

// Create with parent
const post = await graph.mutate.createChild('post', parentId, {
  title: 'Hello World',
  content: 'My first post',
})

// Update
await graph.mutate.update('user', userId, { name: 'Jane' })

// Link
await graph.mutate.link('authored', userId, postId)

// Delete
await graph.mutate.delete('post', postId)
```

### In-Memory (Testing)

```typescript
import { createInMemoryGraph } from '@astrale/typegraph-memory'

const graph = createInMemoryGraph(schema)

// Same API as production
const user = await graph.mutate.create('user', { name: 'Test' })
const users = await graph.node('user').execute()

// In-memory specific
graph.clear() // Clear all data
const data = graph.export() // Export for serialization
graph.import(data) // Import from serialization
const stats = graph.stats() // Get statistics
```

## Development

### Prerequisites

- Node.js 22+
- pnpm 10+

### Setup

```bash
git clone https://github.com/astrale-os/typegraph.git
cd typegraph
pnpm install
```

### Commands

```bash
pnpm build        # Build all packages
pnpm typecheck    # TypeScript type checking
pnpm lint         # Run ESLint
pnpm lint:fix     # Fix linting issues
pnpm format       # Format with Prettier
pnpm test         # Run tests
pnpm test:watch   # Watch mode
```

## License

MIT
