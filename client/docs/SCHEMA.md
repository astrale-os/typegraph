# TypeGraph Schema System

A comprehensive guide to defining type-safe graph schemas with TypeGraph.

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Defining Nodes](#defining-nodes)
3. [Defining Edges](#defining-edges)
4. [Defining a Schema](#defining-a-schema)
5. [Inheritance via Labels](#inheritance-via-labels)
6. [Cardinality System](#cardinality-system)
7. [Type Inference](#type-inference)
8. [Query Building](#query-building)
9. [Comparison with Kernel DSL](#comparison-with-kernel-dsl)

---

## Core Concepts

TypeGraph is a **type-safe graph query builder** that compiles to Cypher (Neo4j). The schema system serves three purposes:

1. **Type inference** - Compile-time validation of queries
2. **Label resolution** - Multi-label inheritance for polymorphic queries
3. **Query compilation** - Schema-aware Cypher generation

### Architecture Flow

```
Schema Definition → Type Inference → AST Building → Cypher Compilation → Neo4j Execution
       ↓                 ↓              ↓               ↓                    ↓
    builders.ts    inference.ts    ast/builder.ts  cypher/compiler.ts   executor/
```

---

## Defining Nodes

Nodes represent vertices in the graph. Use the `node()` builder:

```typescript
import { node } from '@astrale/typegraph-client'
import { z } from 'zod'

const userNode = node({
  properties: {
    email: z.string().email(),
    name: z.string(),
    status: z.enum(['active', 'inactive']),
    createdAt: z.date(),
  },
  indexes: ['email'],                    // Simple index
  description: 'User account',           // Optional documentation
  labels: ['entity', 'auditable'],       // Inheritance (IS-A relationships)
})
```

### Node Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `properties` | `z.ZodRawShape` | Zod schemas for node properties |
| `indexes` | `(string \| IndexConfig)[]` | Properties to index |
| `description` | `string` | Documentation |
| `labels` | `string[]` | Parent node types (inheritance) |

### Implicit Properties

All nodes automatically have:
- `id: string` - Unique identifier (indexed)

### Index Types

```typescript
const postNode = node({
  properties: {
    title: z.string(),
    content: z.string(),
  },
  indexes: [
    'title',                              // Simple index
    { property: 'content', type: 'fulltext' },  // Fulltext search index
  ],
})
```

---

## Defining Edges

Edges represent directed relationships between nodes. Use the `edge()` builder:

```typescript
import { edge } from '@astrale/typegraph-client'

const authoredEdge = edge({
  from: 'user',
  to: 'post',
  cardinality: { outbound: 'many', inbound: 'one' },
  properties: {
    role: z.enum(['author', 'coauthor', 'editor']),
    createdAt: z.date(),
  },
})
```

### Edge Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `from` | `string \| string[]` | Source node type(s) |
| `to` | `string \| string[]` | Target node type(s) |
| `cardinality` | `{ outbound, inbound }` | Relationship multiplicity |
| `properties` | `z.ZodRawShape` | Optional edge properties |
| `indexes` | `(string \| IndexConfig)[]` | Properties to index |

### Polymorphic Edges

Edges can connect multiple node types:

```typescript
const createdEdge = edge({
  from: ['user', 'admin', 'bot'],        // Union of sources
  to: ['post', 'comment', 'tag'],        // Union of targets
  cardinality: { outbound: 'many', inbound: 'many' },
})
```

---

## Defining a Schema

Combine nodes and edges with `defineSchema()`:

```typescript
import { defineSchema, node, edge } from '@astrale/typegraph-client'
import { z } from 'zod'

export const blogSchema = defineSchema({
  nodes: {
    user: node({
      properties: {
        email: z.string().email(),
        name: z.string(),
        status: z.enum(['active', 'inactive']),
      },
      indexes: ['email'],
      labels: ['entity'],
    }),

    post: node({
      properties: {
        title: z.string(),
        content: z.string(),
        publishedAt: z.date().optional(),
      },
      indexes: ['title'],
    }),

    comment: node({
      properties: {
        body: z.string(),
        createdAt: z.date(),
      },
    }),
  },

  edges: {
    authored: edge({
      from: 'user',
      to: 'post',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),

    commented: edge({
      from: 'user',
      to: 'comment',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),

    hasComment: edge({
      from: 'post',
      to: 'comment',
      cardinality: { outbound: 'many', inbound: 'one' },
    }),

    hasParent: edge({
      from: 'post',
      to: 'post',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },

  // Optional: configure hierarchy traversal
  hierarchy: {
    defaultEdge: 'hasParent',
    direction: 'up',
  },

  // Optional: configure base labels
  labels: {
    baseLabels: ['Node'],
    includeBaseLabels: true,
  },
})
```

### Schema Validation

`defineSchema()` validates:
- All `from`/`to` references in edges exist as nodes
- All label references in nodes exist and form no cycles
- The hierarchy edge exists if specified

---

## Inheritance via Labels

TypeGraph supports **transitive** multiple inheritance through the `labels` array.

### How It Works

When a node references other nodes in its `labels` array, it gains those labels **and all their inherited labels** in Cypher:

```typescript
const schema = defineSchema({
  nodes: {
    entity: node({ properties: { createdAt: z.date() } }),
    auditable: node({ properties: { modifiedBy: z.string() } }),

    user: node({
      properties: {
        name: z.string(),
        email: z.string().email(),
      },
      labels: ['entity', 'auditable'],  // User IS-A Entity AND Auditable
    }),
  },
  edges: {},
})
```

### Generated Cypher Labels

```cypher
-- Creating a user generates these labels:
CREATE (u:Node:User:Entity:Auditable {id: '123', name: 'John', email: 'john@example.com'})

-- Queryable as:
MATCH (u:User)        -- Specific user query
MATCH (u:Entity)      -- Any entity (includes users)
MATCH (u:Auditable)   -- Any auditable (includes users)
MATCH (u:Node)        -- Any node (includes users)
```

### Transitive Inheritance

Label inheritance is **transitive**. If `agent` labels `module`, and `module` labels `entity`, then `agent` automatically inherits `entity`:

```typescript
const schema = defineSchema({
  nodes: {
    entity: node({ properties: {} }),
    module: node({ properties: {}, labels: ['entity'] }),
    agent: node({ properties: {}, labels: ['module'] }),  // Inherits entity too!
  },
  edges: {},
})

resolveNodeLabels(schema, 'agent')
// Returns: ['Node', 'Agent', 'Module', 'Entity']
```

### Cycle Detection

Circular label references are detected at schema definition time:

```typescript
// This throws SchemaValidationError:
defineSchema({
  nodes: {
    a: node({ properties: {}, labels: ['b'] }),
    b: node({ properties: {}, labels: ['a'] }),  // Circular!
  },
  edges: {},
})
// Error: "Circular label inheritance: a -> b -> a"
```

### Label Resolution Order

Labels are resolved in this order:
1. **Base labels** (default: `['Node']`) - Universal node matching
2. **Type label** (PascalCase) - e.g., `'user'` → `'User'`
3. **Referenced labels** from `labels` array (PascalCase)

### Polymorphic Edge Queries

Edges targeting a label will match all nodes satisfying that label:

```typescript
const schema = defineSchema({
  nodes: {
    entity: node({ properties: {} }),
    user: node({ properties: { name: z.string() }, labels: ['entity'] }),
    org: node({ properties: { title: z.string() }, labels: ['entity'] }),
  },
  edges: {
    owns: edge({
      from: 'entity',           // Matches user OR org
      to: 'resource',
      cardinality: { outbound: 'many', inbound: 'many' },
    }),
  },
})
```

### Base Label Optimization

The `:Node` base label enables O(1) ID lookups:

```cypher
-- Fast (indexed on Node + id):
MATCH (n:Node {id: $id})

-- Slow (full scan):
MATCH (n {id: $id})
```

Disable if needed:

```typescript
defineSchema({
  nodes: { ... },
  edges: { ... },
  labels: {
    includeBaseLabels: false,  // No :Node label
  },
})
```

---

## Cardinality System

Cardinality defines relationship multiplicity and **determines query return types**.

### Cardinality Values

| Value | Meaning |
|-------|---------|
| `'one'` | Exactly one (required) |
| `'optional'` | Zero or one |
| `'many'` | Zero or more |

### Directional Semantics

Cardinality is defined per direction:

```typescript
const authored = edge({
  from: 'user',
  to: 'post',
  cardinality: {
    outbound: 'many',    // One user → many posts
    inbound: 'one',      // One post ← one user (author)
  },
})
```

### Return Type Inference

The query builder uses cardinality to determine return types:

```typescript
// outbound: 'many' → CollectionBuilder (multiple results)
user.to('authored')

// inbound: 'one' → SingleNodeBuilder (single result)
post.from('authored')

// outbound: 'optional' → OptionalNodeBuilder (0 or 1 result)
post.to('hasParent')
```

### Type Safety Example

```typescript
const graph = createGraph(schema, config)

// CollectionBuilder - returns Post[]
const posts = await graph
  .node('user')
  .where('id', 'eq', '123')
  .to('authored')  // outbound: 'many'
  .execute()

// SingleNodeBuilder - returns User (not User[])
const author = await graph
  .node('post')
  .where('id', 'eq', '456')
  .from('authored')  // inbound: 'one'
  .execute()

// OptionalNodeBuilder - returns Post | null
const parent = await graph
  .node('post')
  .where('id', 'eq', '789')
  .to('hasParent')  // outbound: 'optional'
  .execute()
```

---

## Type Inference

TypeGraph provides comprehensive type inference from your schema.

### Extracting Node Properties

```typescript
import { NodeProps } from '@astrale/typegraph-client'

type UserProps = NodeProps<typeof schema, 'user'>
// = {
//     id: string
//     email: string
//     name: string
//     status: 'active' | 'inactive'
//   }
```

### Extracting Edge Properties

```typescript
import { EdgeProps } from '@astrale/typegraph-client'

type AuthoredProps = EdgeProps<typeof schema, 'authored'>
// = {
//     id: string
//     role: 'author' | 'coauthor' | 'editor'
//     createdAt: Date
//   }
```

### Edge Relationship Types

```typescript
import { OutgoingEdges, IncomingEdges, EdgeTargetsFrom } from '@astrale/typegraph-client'

// Edges that can leave a user node
type UserOutgoing = OutgoingEdges<typeof schema, 'user'>
// = 'authored' | 'commented'

// Edges that can arrive at a post node
type PostIncoming = IncomingEdges<typeof schema, 'post'>
// = 'authored' | 'hasComment'

// Target nodes when following 'authored' from 'user'
type AuthoredTargets = EdgeTargetsFrom<typeof schema, 'authored', 'user'>
// = 'post'
```

### Cardinality Types

```typescript
import { EdgeOutboundCardinality, EdgeInboundCardinality } from '@astrale/typegraph-client'

type AuthoredOut = EdgeOutboundCardinality<typeof schema, 'authored'>
// = 'many'

type AuthoredIn = EdgeInboundCardinality<typeof schema, 'authored'>
// = 'one'
```

---

## Query Building

The schema enables type-safe query construction.

### Basic Query

```typescript
const graph = createGraph(schema, { uri: 'bolt://localhost:7687' })

const activeUsers = await graph
  .node('user')
  .where('status', 'eq', 'active')
  .execute()
// Type: User[]
```

### Traversal Query

```typescript
const userPosts = await graph
  .node('user')
  .where('email', 'eq', 'john@example.com')
  .to('authored')
  .execute()
// Type: Post[]
```

### Multi-Node Returns

```typescript
const results = await graph
  .node('user')
  .as('author')
  .to('authored')
  .as('post')
  .to('hasComment')
  .as('comment')
  .returning('author', 'post', 'comment')
  .execute()
// Type: Array<{ author: User; post: Post; comment: Comment }>
```

### Query Fragments (Reusable)

```typescript
const activeUsers = (builder) =>
  builder.where('status', 'eq', 'active')

const recentPosts = (builder) =>
  builder.where('publishedAt', 'gt', new Date('2024-01-01'))

const results = await graph
  .node('user')
  .pipe(activeUsers)
  .to('authored')
  .pipe(recentPosts)
  .execute()
```

---

## Comparison with Kernel DSL

Both TypeGraph and the Kernel DSL define graph schemas, but serve different purposes.

### Purpose

| Aspect | TypeGraph | Kernel DSL |
|--------|-----------|------------|
| **Primary Use** | Query building | Ontology definition |
| **Target** | Neo4j/Cypher | Kernel storage layer |
| **Focus** | Runtime queries | Schema serialization |

### Node Definition

**TypeGraph:**
```typescript
const userNode = node({
  properties: {
    email: z.string().email(),
    name: z.string(),
  },
  indexes: ['email'],
  labels: ['entity'],
})
```

**Kernel DSL:**
```typescript
// Using kernel kinds (references existing definitions)
PROVISIONED_IDENTITY: node(identity, 'Provisioned Identity', {
  metadata: ProvisionedIdentityMetadataSchema,
})

// Using user-defined types
PROJECT: container('Project'),
TASK: item('Task'),
```

### Key Differences

| Feature | TypeGraph | Kernel DSL |
|---------|-----------|------------|
| **Node Types** | Single `node()` builder | `container()`, `item()`, `node()` (ref) |
| **Inheritance** | `labels` array (multiple) | `extends` field (single) |
| **Properties** | Inline Zod schemas | `metadata` + `data` schemas |
| **IDs** | Implicit `id: string` | Derived via `deriveOntologyIds()` |
| **Kind System** | None (labels only) | Full kind registry with inheritance |
| **Serialization** | Internal AST only | JSON export via serializer |
| **Bootstrap** | None | `bootstrap()` for pre-created nodes |

### Cardinality Comparison

**TypeGraph (directional):**
```typescript
cardinality: { outbound: 'many', inbound: 'one' }
```

**Kernel DSL (shorthand):**
```typescript
// Using link() builder
link()({ from: 'TASK', to: 'USER' })  // Defaults apply
link({ from: 'one', to: 'many' })({ from: 'TASK', to: 'USER' })

// Serializes to: '1:N', 'N:N', etc.
```

### Inheritance Model

**TypeGraph (multi-label):**
```typescript
const user = node({
  properties: { ... },
  labels: ['entity', 'auditable'],  // Multiple parents
})
// Cypher: (u:Node:User:Entity:Auditable)
```

**Kernel DSL (single extends):**
```typescript
export const identity = defineNode('identity', {
  properties: { ... },
  extends: moduleDef,  // Single parent
})
```

### Schema Structure

**TypeGraph:**
```typescript
defineSchema({
  nodes: { user, post },
  edges: { authored, hasComment },
  hierarchy: { defaultEdge: 'hasParent', direction: 'up' },
  labels: { baseLabels: ['Node'] },
})
```

**Kernel DSL:**
```typescript
defineOntology({
  nodes: { PROJECT, TASK },
  edges: { ASSIGNED_TO },
  bootstraps: {
    workspace: bootstrap((m) => ({
      root: m.node('PROJECT', 'My Workspace'),
    })),
  },
})
```

### When to Use Which

**Use TypeGraph when:**
- Building queries against Neo4j
- Need compile-time query validation
- Working with polymorphic queries
- Need cardinality-aware return types

**Use Kernel DSL when:**
- Defining ontologies for the kernel
- Need JSON-serializable schemas
- Referencing kernel node/edge kinds
- Pre-creating bootstrap node hierarchies
- Need derived type IDs

### Potential Overlap

Both systems could benefit from shared concepts:

1. **Zod integration** - Both use Zod for property validation
2. **Label/kind resolution** - Similar inheritance resolution logic
3. **Cardinality** - Both express relationship multiplicity
4. **Index definitions** - Both support property indexing

A unified schema definition could potentially:
- Define once, use in both systems
- Share type inference utilities
- Common serialization format

---

## File Reference

### TypeGraph Schema Files
- `src/schema/types.ts` - Core type definitions
- `src/schema/builders.ts` - DSL builder functions
- `src/schema/labels.ts` - Label resolution utilities
- `src/schema/inference.ts` - TypeScript type inference

### Kernel DSL Files
- `core/dsl/kinds.ts` - Node/edge kind definitions
- `core/dsl/ontology.ts` - High-level ontology DSL
- `core/dsl/types.ts` - DSL input types
- `core/dsl/serializer.ts` - JSON serialization
- `core/dsl/ids.ts` - ID derivation utilities
