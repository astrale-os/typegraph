# Schema assembly — authoring and composing schema files

> Design decisions for how schema files are authored and merged into a single `Schema` object.

---

## Problem

The naive approach requires manually maintaining three export buckets per schema file:

```typescript
export const ifaces = { Node, Link, Identity }
export const nodes  = { Class, Interface, Operation }
export const edges  = { hasParent, instanceOf, hasPerm }
```

This creates two DX problems:
1. **Boilerplate** — every new def requires an update in two places (declaration + bucket)
2. **Silent omission** — adding `const Foo = node(...)` without adding it to `nodes` means `defineSchema()` never sees it, with no error

---

## Decision: flat export + auto-categorisation

`defineSchema()` accepts a flat record. Each builder carries a `.__kind` discriminant (`'iface' | 'node' | 'edge'`). `defineSchema()` categorises automatically — non-def exports (helpers, scalar consts) are silently ignored.

```typescript
defineSchema(defs: Record<string, IfaceDef | NodeDef | EdgeDef>): Schema
```

The kernel schema ships as `@astrale/builder/kernel` — its defs follow the same flat export convention. Distribution schema files export named consts directly — no bucket grouping:

```typescript
// ecommerce.schema.ts
export const Timestamped = iface({ props: { createdAt: z.string().default('now') } })
export const Customer    = node({ implements: [Identity, Timestamped], ... })
export const placedOrder = edge(...)

// helpers — declared but NOT exported, so they don't appear in import *
const email = z.string().email()
```

Assembly in `schema.ts` uses `import *`:

```typescript
// schema.ts
import * as kernel    from '@astrale/builder/kernel'
import * as ecommerce from './ecommerce.schema'

export const Schema = defineSchema({ ...kernel, ...ecommerce })
```

`defineSchema()` receives `{ Node: IfaceDef, Class: NodeDef, hasParent: EdgeDef, Customer: NodeDef, ... }` and picks only the defs.

---

## Authoring rules

**Defs** — export at top level:
```typescript
export const Customer = node({ ... })   // picked up by defineSchema()
export const placedOrder = edge(...)    // picked up by defineSchema()
```

**Helpers** (reusable builders, not schema types) — declare without export:
```typescript
const email = string({ format: 'email' })  // internal, not picked up
const sku   = string().min(3).max(20)       // internal, not picked up
```

**Cross-file refs** — standard named imports:
```typescript
// ecommerce.schema.ts
import { Identity } from '@astrale/builder/kernel'

export const Customer = node({ implements: [Identity, Timestamped], ... })
```

This works because `Identity` is a plain exported `const` — no wrapping, no registry, no indirection.

**Forward/circular refs in one file** — use config thunks on defs:
```typescript
export const Node = iface(() => ({
  methods: {
    create: method({ params: { parent: ref(Node), class: ref(Class) }, returns: NodeCreateResult }),
  },
}))
```

`defineSchema()` resolves def config thunks before validating endpoints and method refs.

---

## Correspondence with GSL

The TypeScript-native API maps directly to GSL concepts. The only structural difference is that GSL uses a single `class` keyword for both concrete nodes and edges (distinguished by whether endpoints are present), whereas the TypeScript API uses two separate builders — forced by `class` being a reserved word in JavaScript, and beneficial because `NodeDef` and `EdgeDef` carry different capabilities in the type system.

In GSL, the compiler infers categorisation from syntax (`class Foo {}` vs `class foo(a, b) []`). The TypeScript API makes this explicit via the `.__kind` discriminant on each builder return value. The authoring experience is equivalent — declare, export, done.

```
GSL                                              TypeScript API
────────────────────────────────────────────     ──────────────────────────────────────────
interface Foo {}                             →   iface({})
interface Foo: Bar {}                        →   iface({ extends: [Bar] })
class Foo: Bar, Baz {}                       →   node({ implements: [Bar, Baz] })
class foo(a: A, b: B) [constraints] { ... } →   edge({ as:'a', types:[A] },
                                                       { as:'b', types:[B] }, opts)
```

Constraint syntax maps as follows:

```
GSL constraint          TypeScript opts
───────────────────     ───────────────────
[no_self]           →   { noSelf: true }
[acyclic]           →   { acyclic: true }
[unique]            →   { unique: true }
[a -> 1]            →   { as: 'a', ..., cardinality: '1' }
[a -> 0..1]         →   { as: 'a', ..., cardinality: '0..1' }
[a -> 0..*]         →   { as: 'a', ..., cardinality: '0..*' }
[a -> 1..*]         →   { as: 'a', ..., cardinality: '1..*' }
```

---

## Alternatives considered

| Approach | Why not chosen |
|----------|---------------|
| Three manual buckets (current) | Boilerplate + silent omission risk |
| `$schema` named export convention | Boilerplate reduced but omission risk remains |
| Schema builder with `createModule()` | Stateful module instance, order-sensitive declarations |
| `defineSchemaModule()` callback | Cross-file refs require destructuring the return value — awkward |

---

## Properties

| Property | Effect |
|---|---|
| No bucket maintenance | Adding a def = one line, never two |
| No silent omissions | Exported def is always in the schema |
| Standard imports | Cross-file refs are plain `import { X }` — rename-safe, IDE-navigable |
| Helper isolation | Non-exported consts are never accidentally included |
| `import *` merge | Adding a new schema file = one spread in `schema.ts` |
