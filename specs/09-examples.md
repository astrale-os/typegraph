# 09 — Examples Directory

> Concrete, runnable examples showing every stage of the typegraph pipeline.
> Each example is a self-contained domain model that demonstrates:
> KRL → IR → Generated TypeScript → Core definition → Method implementations → SDK usage.

---

## Problem

The pipeline has 5 distinct stages, each producing a different artifact. Reading specs and tests individually doesn't give a clear sense of "here's what you write, here's what the toolchain produces, here's what you write on top of it, here's how you use it." We need end-to-end walkthroughs with real output.

---

## Directory Layout

```
typegraph/examples/
├── generate.ts              ← helper script: KRL → IR + generated TS
├── README.md                ← brief index of examples
│
├── e-commerce/
│   ├── schema.krl           ← [source]    hand-written KRL
│   ├── schema.ir.json       ← [generated] compiler output
│   ├── schema.generated.ts  ← [generated] codegen output
│   ├── core.ts              ← [hand-written] defineCore() genesis data
│   ├── methods.ts           ← [hand-written] method implementations
│   └── usage.ts             ← [hand-written] createGraph() + queries
│
├── social/
│   ├── schema.krl
│   ├── schema.ir.json
│   ├── schema.generated.ts
│   ├── core.ts
│   ├── methods.ts
│   └── usage.ts
│
└── kernel/
    ├── schema.krl           ← extends the kernel prelude
    ├── schema.ir.json
    ├── schema.generated.ts
    ├── core.ts
    └── usage.ts             ← kernel-level operations (spaces, perm checks)
```

Each example directory has the same structure. Files are clearly split into two categories:

| Tag | Meaning |
|-----|---------|
| `[generated]` | Produced by `generate.ts`, committed for reading convenience, re-generatable |
| `[hand-written]` | Written by a human to show the developer experience |

---

## File Responsibilities

### 1. `schema.krl` — The source of truth

The KRL schema. This is what a developer writes. Each example domain should exercise different typegraph features:

| Example | Features demonstrated |
|---------|----------------------|
| **e-commerce** | Interfaces, inheritance, type aliases, edge constraints, cardinality, edge attributes, methods |
| **social** | Self-referencing edges (`follows`), symmetric edges, methods, `no_self`/`unique` constraints |
| **kernel** | Extending the kernel prelude, `Identity`, permission edges, meta-model usage |

### 2. `schema.ir.json` — Compiler output

The SchemaIR JSON produced by `krl compile schema.krl`. Shows the intermediate representation — useful for understanding what the compiler extracts from KRL, and what the codegen consumes.

### 3. `schema.generated.ts` — Codegen output

The single TypeScript file produced by `typegraph-codegen schema.ir.json`. This contains:

- Enums + type aliases
- Node interfaces + edge payloads
- Zod validators
- Method interfaces + `MethodsConfig`
- `schema` const (runtime topology)
- Schema type unions
- Enriched node types (`CustomerNode`)
- Core DSL (`defineCore`, `node`, `edge`, `Refs`)

This file is **read-only** for the developer — never hand-edited.

### 4. `core.ts` — Genesis data (hand-written)

Uses the generated `defineCore()`, `node()`, `edge()` helpers to define the initial graph state. Shows how the Core DSL works in practice:

```typescript
import { defineCore, node, edge } from './schema.generated'

export const core = defineCore({
  nodes: {
    admin: node('Customer', { email: 'admin@store.com', name: 'Admin' }),
    electronics: node('Category', { name: 'Electronics', slug: 'electronics' }, {
      children: {
        phones: node('Category', { name: 'Phones', slug: 'phones' }),
      },
    }),
  },
  edges: [
    edge('in_category', { product: 'flagship-phone', category: 'phones' }),
  ],
})
```

### 5. `methods.ts` — Method implementations (hand-written)

Shows how KRL method contracts get concrete implementations:

```typescript
import type { MethodsConfig } from './schema.generated'

export const methods: MethodsConfig = {
  Customer: {
    displayName(ctx) {
      return `${ctx.self.name} <${ctx.self.email}>`
    },
    async recentOrders(ctx) {
      const orders = await ctx.graph
        .node('Customer')
        .byId(ctx.self.id)
        .to('placed_order', 'Order')
        .orderBy('created_at', 'desc')
        .limit(ctx.args.limit ?? 10)
        .execute()
      return orders
    },
  },
  order_item: {
    subtotal(ctx) {
      return ctx.payload.quantity * ctx.payload.unit_price_cents
    },
  },
}
```

### 6. `usage.ts` — SDK usage (hand-written)

The final developer-facing code. Creates the graph, runs queries, shows what the DX looks like:

```typescript
import { createGraph } from './schema.generated'
import { core } from './core'
import { methods } from './methods'
import { MemoryAdapter } from '@astrale/typegraph-adapter-memory'

const graph = createGraph(schema, {
  adapter: new MemoryAdapter(),
  core,
  methods,
})

// Query — typed results
const goldCustomers = await graph
  .node('Customer')
  .where('tier', 'eq', 'gold')
  .execute()
// → CustomerNode[] (with .displayName(), .recentOrders(), etc.)

// Traversal — follow edges
const orders = await graph
  .node('Customer')
  .byId('cust-1')
  .to('placed_order', 'Order')
  .where('status', 'eq', 'pending')
  .execute()

// Method call — on enriched node
const customer = await graph.node('Customer').byId('cust-1').one()
const name = customer.displayName()
const recent = await customer.recentOrders({ limit: 5 })
```

---

## Helper Script: `generate.ts`

A single script that takes an example directory, finds the `.krl` file, and produces the two generated files.

### Interface

```bash
# Generate a single example
npx tsx examples/generate.ts examples/e-commerce

# Generate all examples
npx tsx examples/generate.ts --all

# Verify generated files are up-to-date (CI check)
npx tsx examples/generate.ts --check
```

### Implementation outline

```
1. Find schema.krl in the given directory
2. compile(source, { prelude: KERNEL_PRELUDE }) → SchemaIR
3. Write schema.ir.json (pretty-printed)
4. generate([ir]) → source string
5. Write schema.generated.ts
6. If --check: compare with existing files, exit 1 if stale
```

The script uses the compiler and codegen packages programmatically (not via CLI) so it works in the monorepo without a build step, using `tsx` for direct TS execution.

### Dependencies

- `@astrale/kernel-compiler` — `compile()`, `KERNEL_PRELUDE`
- `@astrale/typegraph-codegen` — `generate()`, `normalizeIR()`
- Both are workspace packages, already available

---

## Example Domains

### e-commerce (primary, most features)

The fullest example. Reuse the e-commerce schema from the codegen test (`codegen/__tests__/e-commerce.test.ts`) but as a standalone `.krl` file — it already covers interfaces, inheritance, type aliases, edge constraints, cardinality, and edge attributes. Add methods.

KRL additions over the test schema:

```krl
class Customer: Identity, Timestamped {
  email: Email [unique],
  name: String,
  phone: String?,
  fn displayName(): String,
  fn recentOrders(limit: Int = 10): Order[]
}

class Order: Timestamped {
  status: OrderStatus = "pending",
  total_cents: Int,
  notes: String?,
  fn cancel(): Boolean
}

class order_item(order: Order, product: Product) [] {
  quantity: Int = 1,
  unit_price_cents: Int,
  fn subtotal(): Int
}
```

### social (self-referencing, constraints)

A focused schema exercising features the e-commerce example doesn't emphasize:

```krl
extend "https://kernel.astrale.ai/v1" { Identity }

interface Timestamped {
  created_at: Timestamp = now()
}

class User: Identity, Timestamped {
  username: String [unique],
  bio: String?,
  fn followerCount(): Int,
  fn isFollowing(other: User): Boolean
}

class Post: Timestamped {
  body: String,
  fn likeCount(): Int
}

class follows(follower: User, followed: User) [no_self, unique] {
  since: Timestamp = now()
}

class liked(user: User, post: Post) [unique]

class authored(author: User, post: Post) [post -> 1]
```

### kernel (extending the prelude)

Shows how the kernel prelude's `Identity`, `Node`, `has_perm` etc. are used in an application schema. This is particularly relevant for the authorization system. The `.krl` file extends the kernel prelude and defines application-level types that integrate with the permission model.

---

## What Gets Committed

Everything. Both generated and hand-written files are committed to the repo. The generated files are there for **reading convenience** — a developer browsing the repo can see the full output without running anything. The `--check` flag ensures they stay in sync in CI.

---

## Not In Scope

- The `usage.ts` files are **not runnable** out of the box — they're illustrative TypeScript showing the intended DX. They may reference APIs that aren't fully wired yet (e.g., `createGraph` factory from codegen, TypeMap integration). That's fine — they serve as a north-star reference for what the end-to-end experience looks like.
- No test runner integration. These are not tests — they're documentation artifacts. The codegen and SDK test suites handle correctness.
