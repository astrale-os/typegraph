# @astrale/typegraph-adapter-falkordb

FalkorDB adapter for TypeGraph - bring type-safe graph queries to your Redis-based graph database.

## Features

- 🚀 **Zero Configuration** - Connect and start querying in seconds
- 🔒 **Type-Safe** - Full TypeScript support with schema-driven types
- ⚡ **Performance** - Uses `roQuery()` for read-only optimization
- 🧪 **Testing Utilities** - Built-in helpers for tests
- 📊 **Health Checks** - Monitor connection health and latency
- 🔄 **Transaction Support** - Simulated transactions for sequential operations

## Installation

```bash
npm install @astrale/typegraph-adapter-falkordb falkordb
# or
pnpm add @astrale/typegraph-adapter-falkordb falkordb
```

## Quick Start

```typescript
import { defineSchema, node, edge, createGraph } from '@astrale/typegraph-client'
import { falkordb } from '@astrale/typegraph-adapter-falkordb'
import { z } from 'zod'

const schema = defineSchema({
  nodes: {
    user: node({ properties: { name: z.string() } }),
  },
  edges: {},
})

const graph = await createGraph(schema, {
  adapter: falkordb({
    host: 'localhost',
    port: 6379,
    graphName: 'my-graph',
  }),
})

const user = await graph.mutate.create('user', { name: 'Alice' })
console.log(user)

await graph.close()
```

## Configuration

The adapter accepts the following configuration options:

```typescript
interface FalkorDBConfig {
  /** FalkorDB host (default: 'localhost') */
  host?: string
  /** FalkorDB port (default: 6379) */
  port?: number
  /** Graph name (required) */
  graphName: string
  /** Optional authentication */
  auth?: {
    username?: string
    password?: string
  }
  /** Connection retry configuration */
  retry?: {
    maxRetries?: number
    delayMs?: number
    backoffMultiplier?: number
  }
  /** Connection timeout in ms (default: 5000) */
  timeout?: number
}
```

## Examples

See the [examples/](./examples) directory for complete usage examples:

- **basic.ts** - Basic CRUD operations and queries
- **mutations.ts** - Update, delete, and batch operations
- **hierarchy.ts** - Working with tree structures

## Running Examples

Start FalkorDB:

```bash
docker-compose up -d
```

Run examples:

```bash
pnpm example:basic
pnpm example:mutations
pnpm example:hierarchy
```

## Testing

The adapter includes Docker-based integration tests:

```bash
# Run all tests
pnpm test

# Run specific test suites
pnpm test:integration
pnpm test:unit
pnpm test:perf
```

## API Reference

### `falkordb(config)`

Create a FalkorDB adapter for use with `createGraph()`.

### `clearGraph(config)`

Clear all data from a graph (useful for testing).

### `listGraphs(config)`

List all graphs in the FalkorDB instance.

### `deleteGraph(config)`

Delete a graph from the FalkorDB instance.

## Requirements

- Node.js >= 22
- FalkorDB server running (Redis protocol)

## License

MIT
