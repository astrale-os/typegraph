# Schema as source of truth — no codegen for the TS client

> Design decision for the v2 implementation.

## Decision

The `Schema` object returned by `defineSchema()` is consumed **directly** by `createClient()`.
No intermediate `schema.generated.ts` file is produced for the TypeScript client.

## Why the v1 system needed codegen

The v1 runtime expected a `SchemaShape` — a plain object where every type reference is a **string**:

```typescript
// v1 generated output
interface SchemaShape {
  nodes: Record<string, { implements?: string[]; attributes?: string[] }>
  edges: Record<string, { endpoints: Record<string, { types: string[] }> }>
  methods?: Record<string, Record<string, { params: Record<string, { type: string }> }>>
}
```

TypeScript cannot infer concrete types from strings, so codegen also emitted a `TypeMap` — a
phantom generic bridging string names to concrete types. This required a build step after every
schema change, and introduced a window where the generated file was stale.

## Why v2 doesn't need it

With the v2 builder API, all references are **object references**, not strings:

```typescript
const Customer = node({ implements: [Identity, Timestamped], props: { email: string() } })
const Schema   = defineSchema({ nodes: { Customer }, edges: { placedOrder } })
//    ^── TypeScript already knows:
//          Schema.nodes.Customer → NodeDef<{ email: StringB }>
//          Schema.edges.placedOrder.from → { as: 'customer', types: [Customer] }
```

The `Schema` object carries everything the runtime needs — node names (as record keys), property
shapes (as builder objects), edge endpoints (as object refs), cardinality, methods — all
accessible both at compile time and at runtime, without any serialization step.

## New pipeline

```
@astrale/builder/kernel ──┐
                           ├─ defineSchema() ──▶ Schema ──▶ createClient(Schema)
app.schema.ts ─────────────┘                        │
                                                    └──▶ serialize(Schema) ──▶ schema.json   (optional)
```

`createClient(Schema)` infers all types directly from the Schema object:

```typescript
import { Schema } from './schema'
import { createClient } from '@astrale/builder'

const db = createClient(Schema)

const c = await db.Customer.findById(id)
c.email          // string        — inferred from string() builder
c.phone          // string | undefined — inferred from string().opt()
c.recentOrders   // (args: { limit?: number }) => Promise<Order[]>
```

## What serialize() is for

`serialize(Schema)` produces a JSON (or TS const) snapshot for **external tooling only**:

- database migration planning (diff between two serialized snapshots)
- documentation generators
- non-TypeScript consumers (other languages, introspection APIs)

It is **not** a prerequisite for the TypeScript client. The `builder diff` command (see [diff](../diff.md))
uses `serialize()` internally; developers never need to run it manually.

## Properties of this approach

| Property | Effect |
|---|---|
| No build step | Schema changes are immediately reflected in the client types |
| Rename safety | Renaming `Customer → Account` in the schema is a TypeScript error everywhere at once — no stale generated file |
| Single source | `schema.ts` is the only file to maintain |
| Runtime cost | Negligible — builder objects are small plain objects with no heavy dependencies |
