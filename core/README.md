# @astrale/typegraph-core

Core schema DSL and AST for TypeGraph. A lightweight package for schema definitions, code generation, and tooling without the full query execution stack.

## Installation

```bash
npm install @astrale/typegraph-core
# or
pnpm add @astrale/typegraph-core
```

## What's Included

- **Schema DSL** - `defineSchema()`, `node()`, `edge()` builders
- **Schema Types** - TypeScript types for schema definitions
- **AST Types** - Query AST representation for programmatic query building
- **Error Types** - Core error definitions

## Use Cases

### 1. Schema Sharing Across Services

```typescript
import { defineSchema, node, edge } from '@astrale/typegraph-core'
import { z } from 'zod'

export const userSchema = defineSchema({
  nodes: {
    user: node({
      properties: { name: z.string() }
    }),
  },
  edges: {
    follows: edge({
      from: 'user',
      to: 'user',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
  },
})
```

### 2. Code Generation

```typescript
import type { Schema, NodeDefinition } from '@astrale/typegraph-core'

function generateGraphQLSchema(schema: Schema): string {
  // Generate GraphQL SDL from TypeGraph schema
  // No need to install full typegraph package
}
```

### 3. Query AST Introspection

```typescript
import { QueryAST } from '@astrale/typegraph-core'

const ast = new QueryAST()
  .addMatch('user')
  .addWhere({ field: 'status', op: 'eq', value: 'active' })

console.log(ast.steps) // Inspect query structure
```

## When to Use This vs Full TypeGraph

- **Use `@astrale/typegraph-core`** when you need:
  - Schema definitions only
  - Code generation tools
  - Schema validation/introspection
  - Custom query builders
  - Minimal bundle size

- **Use `@astrale/typegraph-client`** when you need:
  - Full query execution
  - Database connectivity
  - Mutations
  - The fluent query builder API

## License

MIT
