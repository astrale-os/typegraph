# Developer flow

> End-to-end guide for a developer setting up a distribution on top of the kernel.

---

## Overview

```
schema.ts          define the graph shape
core.ts            define initial production data
methods.ts         implement method logic
seed.ts            define dev fixtures (optional)
      │
      ▼
bootstrap()        provision the kernel
applyCore()        insert production data
applySeed()        insert dev fixtures
      │
      ▼
createClient()     typed SDK — query, mutate, traverse
```

---

## Step 1 — schema.ts

The kernel schema ships as `@astrale/builder/kernel`. The developer imports it and spreads it into `defineSchema()` alongside their own definitions.

```typescript
import { z } from 'zod'
import { iface, node, edge, method, ref, data, defineSchema } from '@astrale/builder'
import * as kernel from '@astrale/builder/kernel'

const OrderStatus = z.enum(['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'])

const Timestamped = iface({
  props: { createdAt: z.string().default('now'), updatedAt: z.string().optional() },
})

export const Customer = node({
  implements: [kernel.Identity, Timestamped],
  props: {
    email: z.string().email(),
    name:  z.string(),
  },
  methods: {
    displayName:  method({ returns: z.string() }),
    recentOrders: method({ params: { limit: z.number().int().default(10) }, returns: z.array(ref(Order)), access: 'private' }),
  },
})

export const Order = node({
  implements: [Timestamped],
  props: { status: OrderStatus.default('pending'), totalCents: z.number().int() },
})

export const Product = node({
  implements: [Timestamped],
  props: { title: z.string(), sku: z.string() },
  data:  { description: z.string(), images: z.array(z.string().url()) },
  methods: {
    content: method({ returns: data() }),
  },
})

export const placedOrder = edge(
  { as: 'customer', types: [Customer] },
  { as: 'order',    types: [Order], cardinality: '1' },
  { unique: true },
)

export const Schema = defineSchema({ ...kernel, Customer, Order, Product, placedOrder })
```

---

## Step 2 — methods.ts

Implement the logic for every method declared in the schema. Bootstrap fails if any method is missing.

```typescript
import { defineMethods } from '@astrale/builder'
import { Schema } from './schema'

export const methods = defineMethods(Schema, {
  Customer: {
    displayName: (ctx) => `${ctx.self.name} <${ctx.self.email}>`,

    recentOrders: async (ctx) => {
      return ctx.graph.Order
        .findMany({ where: { customer: ctx.self.id } })
        .orderBy('createdAt', 'desc')
        .limit(ctx.args.limit)
    },
  },
  Product: {
    content: (ctx) => ctx.data(),
  },
})
```

`ctx.self` is the node instance. `ctx.args` are the method params. `ctx.graph` is the typed SDK client (`Client<S>`), the same API as `createClient(Schema)`. `ctx.data()` (and `ctx.data(target)`) resolves datastore-backed content typed from schema `data` fields. All four are fully typed from the schema.

**Completeness is enforced twice:** TypeScript flags missing methods in the IDE (via `MethodsImpl<S>` required keys), and `defineMethods()` performs a runtime check at import time as a safety net. If you forget `Customer.recentOrders`, the dev server fails immediately with `'Customer' is missing methods: recentOrders`.

---

## Step 3 — core.ts

Initial data that must exist in production from day one: default workspaces, roles, system policies, etc.

```typescript
import { defineCore, create, link, kernelRefs } from '@astrale/builder'
import { Schema, Workspace, Role } from './schema'

const workspace = create(Workspace, { name: 'default' })
const adminRole = create(Role, { name: 'admin' })

export const core = defineCore(Schema, 'myapp', {
  nodes: { workspace, adminRole },
  links: [
    link(workspace, 'hasParent', kernelRefs.root),
    link(kernelRefs.system, 'hasPerm', workspace, { perm: 'admin' }),
  ],
})
```

Created refs are exposed as `core.refs.<name>` and stay fully typed.

---

## Step 4 — seed.ts (dev only)

Test fixtures. Never deployed to production.

```typescript
import { defineSeed, create, link } from '@astrale/builder'
import { Schema, User } from './schema'
import { core } from './core'

const alice = create(User, { email: 'alice@test.com', name: 'Alice' })

export const seed = defineSeed(Schema, core, {
  nodes: { alice },
  links: [link(alice, 'belongsTo', core.refs.workspace)],
})
```

---

## Step 5 — Bootstrap and seed

```typescript
import { bootstrap, applyCore, applySeed, createClient } from '@astrale/builder'
import { Schema } from './schema'
import { methods } from './methods'
import { core } from './core'
import { seed } from './seed'

// Provision the kernel (idempotent — safe to run on every deploy)
await bootstrap(Schema, { methods, adapter: 'in-memory' })

// Insert production data
await applyCore(core)

// Insert dev fixtures (dev only)
if (process.env.NODE_ENV === 'development') {
  await applySeed(seed)
}

// Typed SDK
export const db = createClient(Schema)
```

---

## Step 6 — Use the SDK

```typescript
import { db } from './app'

// Query
const customer = await db.Customer.findById(id)
customer.email          // string
customer.phone          // string | undefined
customer.displayName()  // Promise<string>

// Traverse edges (method named after opposite endpoint's as)
const orders = await db.Customer.findById(id).order()

// Mutate
const product = await db.Product.create({ title: 'Laptop', sku: 'LP-001', priceCents: 129900 })
await db.link(product, 'inCategory', category)
```

---

## Schema evolution

When the schema changes:

```typescript
import { diff, apply } from '@astrale/builder'
import { Schema } from './schema'

// 1. See what changed
const plan = await diff(Schema)
plan.print()
// [+] node    Product
// [~] node    Customer   added prop: phone (optional)
// [-] node    LegacyItem  ← BREAKING: has 42 instances

// 2. Declare strategies for breaking changes, then apply
const plan = await diff(Schema, {
  migrations: {
    'LegacyItem': strategy.deleteAll(),
  }
})
await apply(plan)

// 3. Re-bootstrap (registers new types)
await bootstrap(Schema, { methods, adapter: 'in-memory' })
```

Additive changes (`[+]`) are applied automatically. Only `[~]` and `[-]` require a strategy.

---

## File summary

| File | Written by | Deployed | Purpose |
|------|-----------|----------|---------|
| `schema.ts` | Developer | Yes | Graph shape (imports kernel from `@astrale/builder/kernel`) |
| `methods.ts` | Developer | Yes | Method logic |
| `core.ts` | Developer | Yes | Initial production data |
| `seed.ts` | Developer | No (dev only) | Test fixtures |
