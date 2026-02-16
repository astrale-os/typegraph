# Spec 08: TypeMap Wiring

> How generated TypeScript types flow from codegen output into the SDK builder chain,
> replacing `Record<string, unknown>` with concrete types at every `.execute()` and `.create()` call.

---

## 0. Problem

Today, every terminal operation returns untyped data:

```typescript
const customers = await graph.node('Customer').execute()
// Type: Array<{ id: string; kind: 'Customer' } & Record<string, unknown>>

customers[0].email   // ✗ Property 'email' does not exist
customers[0]['email'] // ✓ but `unknown`
```

The codegen produces concrete types (`CustomerNode`, `OrderItemPayload`), and the SDK defines a `TypeMap` interface (`src/schema.ts`), but nothing connects them. The result: the query builder autocompletes node/edge *names* from the schema, but all property access is untyped.

---

## 1. Desired Developer Experience

### 1.1 Zero-config (codegen factory)

```typescript
import { createGraph } from './generated/shop'
import { memgraph } from '@astrale/typegraph-adapter-memgraph'

const graph = await createGraph({
  adapter: memgraph({ uri: 'bolt://localhost:7687' }),
})

// ✓ Full autocompletion & type checking on results
const customers = await graph.node('Customer').execute()
customers[0].email        // string
customers[0].tier         // string
customers[0].created_at   // string

// ✓ Typed mutations
await graph.mutate.create('Customer', {
  email: 'alice@shop.io',  // ✓ autocomplete
  username: 'alice',
  tier: 'gold',
})

await graph.mutate.create('Customer', {
  email: 'alice@shop.io',
  bogus: 123,               // ✗ Type error: 'bogus' does not exist
})
```

The codegen-emitted `createGraph` is a thin wrapper that locks in `S` and `T`:

```typescript
// generated/shop.ts (codegen output)
import { createGraph as _createGraph, type GraphOptions } from '@astrale/typegraph'
import { schema } from './schema'
import type { ShopTypeMap } from './types'

export function createGraph(options: Omit<GraphOptions, 'schema'>) {
  return _createGraph<typeof schema, ShopTypeMap>(schema, options)
}
```

### 1.2 Explicit generics (advanced)

```typescript
import { createGraph } from '@astrale/typegraph'
import { schema } from './generated/shop/schema'
import type { ShopTypeMap } from './generated/shop/types'

const graph = await createGraph<typeof schema, ShopTypeMap>(schema, { adapter })
graph.node('Customer').execute()  // → Promise<CustomerNode[]>
```

### 1.3 Untyped fallback (backward compatible)

```typescript
import { createGraph } from '@astrale/typegraph'
import { schema } from './generated/shop/schema'

// No TypeMap → everything works, results are Record<string, unknown>
const graph = await createGraph(schema, { adapter })
graph.node('Customer').execute()
// → Promise<Array<{ id: string; kind: 'Customer' } & Record<string, unknown>>>
```

### 1.4 Traversal preserves types

```typescript
const items = await graph.node('Customer')
  .where('email', 'eq', 'alice@shop.io')
  .to('placed_order')         // → CollectionBuilder<..., 'Order', ...>
  .to('order_item')           // → CollectionBuilder<..., 'Product', ...>
  .execute()
// items: ProductNode[]

items[0].name       // string
items[0].price      // number
items[0].sku        // string
```

### 1.5 Cardinality-aware return types (unchanged, now typed)

```typescript
// placed_order [order → 1]
const order = await graph.node('Customer')
  .byId(aliceId)
  .to('placed_order')
  .execute()
// order: OrderNode (not OrderNode[])

order.status      // string
order.total       // number

// category_parent [child → 0..1]
const parent = await graph.node('Category')
  .byId(leafId)
  .to('category_parent')
  .execute()
// parent: CategoryNode | null

parent?.name      // string | undefined
```

### 1.6 Mutation input typing

```typescript
// create — input is all writable attributes (excludes id, __type, readonly)
await graph.mutate.create('Product', {
  name: 'Laptop',
  price: 1299.99,
  sku: 'LAP-001',
  active: true,
})

// update — input is Partial of writable attributes
await graph.mutate.update('Product', laptopId, {
  price: 999.99,
})

// link — payload typed per edge
await graph.mutate.link('order_item', alice.id, laptop.id, {
  quantity: 2,
  unit_price: 1299.99,
})
```

### 1.7 Projection still works (proxy types independent of TypeMap)

```typescript
const result = await graph.node('Customer')
  .as('c')
  .to('placed_order')
  .as('o')
  .return(q => ({
    email: q.c.email,
    total: q.o.total,
  }))
  .execute()
// result: Array<{ email: unknown; total: unknown }>
// (proxy projection is structural — TypeMap doesn't apply here, same as today)
```

TypeMap typing flows through `.execute()`, not `.return()`. The `.return()` proxy system is orthogonal.

---

## 2. Codegen Output

The codegen emits a `TypeMap` object type alongside the schema and concrete types.

### 2.1 Generated file structure

```
generated/shop/
├── schema.ts        # schema const (satisfies SchemaShape) — exists today
├── types.ts         # NEW: concrete types + TypeMap
├── validators.ts    # Zod validators — exists today
└── index.ts         # barrel + createGraph wrapper
```

### 2.2 `types.ts` — concrete types and TypeMap

```typescript
// generated/shop/types.ts
// AUTO-GENERATED — DO NOT EDIT

// ── Node output types ──────────────────────────────────────

export interface Customer {
  email: string
  username: string
  tier: string
  created_at: string
  updated_at: string | null
}

export interface CustomerNode extends Customer {
  readonly id: string
  readonly __type: 'Customer'
}

export interface Product {
  name: string
  price: number
  sku: string
  active: boolean
  created_at: string
  updated_at: string | null
}

export interface ProductNode extends Product {
  readonly id: string
  readonly __type: 'Product'
}

// ... (all concrete node types)

// ── Edge payload types ─────────────────────────────────────

export interface OrderItemPayload {
  quantity: number
  unit_price: number
}

export interface FollowsPayload {
  since: string
}

export interface StockedInPayload {
  quantity: number
}

// ── Node input types (for mutations) ───────────────────────

export type CustomerInput = Omit<Customer, 'created_at' | 'updated_at'>
export type ProductInput = Omit<Product, 'created_at' | 'updated_at'>
// ... (readonly/computed fields stripped)

// ── TypeMap ────────────────────────────────────────────────

export interface ShopTypeMap {
  nodes: {
    Customer: CustomerNode
    Product: ProductNode
    Order: OrderNode
    Review: ReviewNode
    Category: CategoryNode
    Warehouse: WarehouseNode
  }
  edges: {
    order_item: OrderItemPayload
    follows: FollowsPayload
    stocked_in: StockedInPayload
    // edges without attributes → Record<string, never>
    placed_order: Record<string, never>
    reviewed: Record<string, never>
    wrote_review: Record<string, never>
    review_of: Record<string, never>
    categorized_as: Record<string, never>
    category_parent: Record<string, never>
  }
  nodeInputs: {
    Customer: CustomerInput
    Product: ProductInput
    Order: OrderInput
    Review: ReviewInput
    Category: CategoryInput
    Warehouse: WarehouseInput
  }
}
```

### 2.3 `index.ts` — typed createGraph wrapper

```typescript
// generated/shop/index.ts
// AUTO-GENERATED — DO NOT EDIT

export { schema } from './schema'
export type { ShopTypeMap } from './types'
export * from './types'

import { createGraph as _createGraph, type GraphOptions } from '@astrale/typegraph'
import { schema } from './schema'
import type { ShopTypeMap } from './types'

export type ShopSchema = typeof schema

export function createGraph(options: Omit<GraphOptions, 'schema'>) {
  return _createGraph<ShopSchema, ShopTypeMap>(schema, options)
}
```

---

## 3. Type Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  1. KRL Source                                                  │
│     class Customer: Timestamped { email: Email, ... }           │
│     class order_item(order: Order, product: Product) { ... }    │
└─────────────────────────────────────────────────────────────────┘
                              ↓  compiler
┌─────────────────────────────────────────────────────────────────┐
│  2. SchemaIR                                                    │
│     NodeDef { name: 'Customer', attributes: [...] }             │
│     EdgeDef { name: 'order_item', endpoints: [...] }            │
└─────────────────────────────────────────────────────────────────┘
                              ↓  codegen
┌─────────────────────────────────────────────────────────────────┐
│  3. Generated TypeScript                                        │
│     a. schema const (SchemaShape) — runtime topology            │
│     b. TypeMap interface — type-level node/edge/input maps      │
│     c. createGraph() wrapper — locks in S + T                   │
└─────────────────────────────────────────────────────────────────┘
                              ↓  SDK
┌─────────────────────────────────────────────────────────────────┐
│  4. createGraph<S, T>(schema, options) → Graph<S, T>            │
│     T defaults to UntypedMap when not provided                  │
│                                                                 │
│     graph.node('Customer')                                      │
│       → CollectionBuilder<S, 'Customer', {}, {}, T>             │
│       .to('placed_order')                                       │
│       → CollectionBuilder<S, 'Order', {}, {}, T>                │
│       .execute()                                                │
│       → Promise<ResolveNode<T, 'Order'>[]>                      │
│       → Promise<OrderNode[]>                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Core Type Definitions

### 4.1 TypeMap interface (update `src/schema.ts`)

```typescript
// src/schema.ts

export interface TypeMap {
  readonly nodes: Record<string, unknown>
  readonly edges: Record<string, unknown>
  readonly nodeInputs?: Record<string, unknown>
}

export interface UntypedMap extends TypeMap {
  readonly nodes: Record<string, Record<string, unknown>>
  readonly edges: Record<string, Record<string, unknown>>
}
```

Adds optional `nodeInputs` to existing `TypeMap`. Removes unused `UntypedMap.edges` and `UntypedMap.nodes` refinements (they stay `Record<string, unknown>` for max compat).

### 4.2 Resolution types (new `src/resolve.ts`)

```typescript
// src/resolve.ts

import type { TypeMap, UntypedMap } from './schema'

/**
 * Resolve the output type for a node label.
 * If TypeMap has a concrete type for N, use it. Otherwise fall back to untyped.
 */
export type ResolveNode<T extends TypeMap, N extends string> =
  N extends keyof T['nodes']
    ? T['nodes'][N]
    : { id: string; kind: N } & Record<string, unknown>

/**
 * Resolve the output type for an edge type.
 */
export type ResolveEdge<T extends TypeMap, E extends string> =
  E extends keyof T['edges']
    ? T['edges'][E] & { id: string; kind: E }
    : { id: string; kind: E } & Record<string, unknown>

/**
 * Resolve the input type for creating/updating a node.
 * Falls back to Record<string, unknown> when nodeInputs isn't provided.
 */
export type ResolveNodeInput<T extends TypeMap, N extends string> =
  T extends { nodeInputs: infer I }
    ? N extends keyof I
      ? I[N]
      : Record<string, unknown>
    : Record<string, unknown>

/**
 * Resolve the input type for an edge payload.
 */
export type ResolveEdgeInput<T extends TypeMap, E extends string> =
  E extends keyof T['edges']
    ? T['edges'][E] extends Record<string, never>
      ? never      // edge has no payload → data param is omitted
      : T['edges'][E]
    : Record<string, unknown>

/**
 * Check if T is the untyped fallback.
 */
export type IsUntyped<T extends TypeMap> = T extends UntypedMap ? true : false
```

### 4.3 Graph interface (update `src/graph.ts`)

```typescript
// Key change: add T as second generic with default

export interface Graph<S extends SchemaShape, T extends TypeMap = UntypedMap>
  extends GraphQuery<S, T> {

  readonly mutate: GraphMutations<S, T>

  transaction<R>(fn: (tx: TransactionScope<S, T>) => Promise<R>): Promise<R>

  // ... rest unchanged
}

export async function createGraph<
  S extends SchemaShape,
  T extends TypeMap = UntypedMap,
>(schema: S, options: GraphOptions<S>): Promise<Graph<S, T>> {
  // ... implementation unchanged — T is phantom (type-level only)
}
```

### 4.4 GraphQuery interface (update `src/query/types.ts`)

```typescript
export interface GraphQuery<S extends SchemaShape, T extends TypeMap = UntypedMap> {
  readonly schema: S
  readonly executor: QueryExecutor | null

  node<N extends NodeLabels<S>>(
    label: N,
  ): CollectionBuilder<S, N, Record<string, never>, Record<string, never>, T>

  nodeById(
    id: string,
  ): SingleNodeBuilder<S, NodeLabels<S>, Record<string, never>, Record<string, never>, T>

  nodeByIdWithLabel<N extends NodeLabels<S>>(
    label: N,
    id: string,
  ): SingleNodeBuilder<S, N, Record<string, never>, Record<string, never>, T>

  edge<E extends EdgeTypes<S>>(
    edgeType: E,
  ): EdgeBuilder<S, E, Record<string, never>, Record<string, never>, T>

  // ... rest unchanged, T propagated
}
```

### 4.5 Builder chain (5th generic)

Every builder gets `T extends TypeMap = UntypedMap` as 5th generic:

```typescript
// NodeQueryBuilder — abstract base
abstract class NodeQueryBuilder<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  Aliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
  T extends TypeMap = UntypedMap,
> extends BaseBuilder<S, N> { ... }

// CollectionBuilder
class CollectionBuilder<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  Aliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
  T extends TypeMap = UntypedMap,
> extends NodeQueryBuilder<S, N, Aliases, EdgeAliases, T> {

  execute(): Promise<ResolveNode<T, N>[]> { ... }

  to<E extends EdgeTypes<S>>(
    edge: E,
    target?: NodeLabels<S>,
    options?: TraversalOptions,
  ): CollectionBuilder<S, EdgeTargetsFrom<S, E, N>, Aliases, EdgeAliases & { ... }, T> {
    //                                                                              ^^^
    //                                              T propagates to the new builder
  }
}

// SingleNodeBuilder
class SingleNodeBuilder<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  Aliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
  T extends TypeMap = UntypedMap,
> extends NodeQueryBuilder<S, N, Aliases, EdgeAliases, T> {

  execute(): Promise<ResolveNode<T, N>> { ... }
  executeOrNull(): Promise<ResolveNode<T, N> | null> { ... }
}

// OptionalNodeBuilder
class OptionalNodeBuilder<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  Aliases extends AliasMap<S> = Record<string, never>,
  EdgeAliases extends EdgeAliasMap<S> = Record<string, never>,
  T extends TypeMap = UntypedMap,
> extends NodeQueryBuilder<S, N, Aliases, EdgeAliases, T> {

  execute(): Promise<ResolveNode<T, N> | null> { ... }
}
```

### 4.6 Mutation types (update `src/mutation/types.ts`)

```typescript
export type NodeInput<S extends SchemaShape, N extends NodeLabels<S>, T extends TypeMap = UntypedMap> =
  ResolveNodeInput<T, N & string>

export type EdgeInput<S extends SchemaShape, E extends EdgeTypes<S>, T extends TypeMap = UntypedMap> =
  ResolveEdgeInput<T, E & string>

export interface NodeResult<S extends SchemaShape, N extends NodeLabels<S>, T extends TypeMap = UntypedMap> {
  id: string
  data: ResolveNode<T, N & string>
}

export interface EdgeResult<S extends SchemaShape, E extends EdgeTypes<S>, T extends TypeMap = UntypedMap> {
  id: string
  from: string
  to: string
  data: ResolveEdge<T, E & string>
}

export interface GraphMutations<S extends SchemaShape, T extends TypeMap = UntypedMap> {
  create<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N, T>,
    options?: CreateOptions,
  ): Promise<NodeResult<S, N, T>>

  update<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N, T>>,
  ): Promise<NodeResult<S, N, T>>

  link<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data?: EdgeInput<S, E, T>,
  ): Promise<EdgeResult<S, E, T>>

  // ... same pattern for all mutation methods
}
```

---

## 5. Implementation Plan

### 5.1 What changes (SDK)

| File | Change | Scope |
|------|--------|-------|
| `src/schema.ts` | Add `nodeInputs?` to `TypeMap` | 2 lines |
| `src/resolve.ts` | **New file.** Resolution types: `ResolveNode`, `ResolveEdge`, `ResolveNodeInput`, `ResolveEdgeInput` | ~40 lines |
| `src/graph.ts` | Add `T` generic to `Graph`, `GraphImpl`, `createGraph`, `TransactionScope` | Signature-only |
| `src/query/types.ts` | Add `T` to `GraphQuery` | Signature-only |
| `src/query/impl.ts` | Add `T` to `GraphQueryImpl` | Signature-only |
| `src/query/node-query-builder.ts` | Add `T` as 5th generic to `NodeQueryBuilder` | Signature-only |
| `src/query/collection.ts` | Add `T` to `CollectionBuilder`, update `execute()` return, propagate `T` in `.to()`/`.from()` | Signatures + return types |
| `src/query/single-node.ts` | Add `T` to `SingleNodeBuilder`, update `execute()`/`executeOrNull()` return | Signatures + return types |
| `src/query/optional-node.ts` | Add `T` to `OptionalNodeBuilder`, update `execute()` return | Signatures + return types |
| `src/query/edge.ts` | Add `T` to `EdgeBuilder`, update `execute()` return | Signatures + return types |
| `src/query/path.ts` | Add `T` to `PathBuilder` | Signature-only |
| `src/mutation/types.ts` | Add `T` to `GraphMutations`, `MutationTransaction`, `NodeInput`, `NodeResult`, `EdgeInput`, `EdgeResult` | Signatures + return types |
| `src/mutation/mutations.ts` | Add `T` to `GraphMutationsImpl` | Signature-only |
| `src/index.ts` | Re-export `ResolveNode`, `ResolveEdge`, etc. | 1 line |

**No runtime changes.** `T` is phantom — it only exists at the TypeScript type level. The actual `.execute()` implementation remains `this._executor.run<Record<string, unknown>>(...)` with a type assertion in the return.

### 5.2 What changes (codegen)

| File | Change |
|------|--------|
| `codegen/src/emit/types.ts` | **New emitter.** Produces `TypeMap` interface, node input types |
| `codegen/src/generate.ts` | Call new emitter, emit `createGraph` wrapper in barrel |

The codegen already produces `SchemaNodeTypeMap` and enriched `*Node` types. The new emitter restructures these into the `TypeMap` shape and adds `nodeInputs`.

### 5.3 What doesn't change

- `.return()` / `.as()` proxy system — operates on structural types, independent of TypeMap
- `.where()` argument types — remains `(field: string, op: string, value: unknown)` for v1
- `.compile()` / `.toCypher()` — produces strings, no type involvement
- Runtime execution path — all `Record<string, unknown>` casts stay in place
- All existing tests — `UntypedMap` default means zero breakage

---

## 6. Edge Cases

### 6.1 Abstract node queries

```typescript
const all = await graph.node('Timestamped').execute()
// TypeMap.nodes has no 'Timestamped' entry (it's abstract)
// Falls back to: Array<{ id: string; kind: 'Timestamped' } & Record<string, unknown>>
```

Abstract types are not in `TypeMap.nodes`. The fallback is intentional — codegen only maps concrete types. Discriminated union return types for abstract queries (`CustomerNode | ProductNode | ...`) are a separate concern (polymorphic return typing, future spec).

### 6.2 Polymorphic edge targets

```typescript
// If an edge endpoint allows multiple types:
// class interacts_with(user: Customer, target: Product | Category)
const targets = await graph.node('Customer').to('interacts_with').execute()
// The inferred N is `Product | Category` (union from schema)
// ResolveNode<T, 'Product' | 'Category'> distributes:
//   → ProductNode | CategoryNode
```

Conditional types distribute over unions. This works automatically.

### 6.3 TypeMap mismatch with schema

```typescript
interface WrongTypeMap extends TypeMap {
  nodes: { Customer: CustomerNode }  // Missing Product, Order, etc.
  edges: {}
}

const graph = await createGraph<typeof schema, WrongTypeMap>(schema, { adapter })
graph.node('Product').execute()
// ResolveNode<WrongTypeMap, 'Product'> → 'Product' not in nodes
// Falls back to: { id: string; kind: 'Product' } & Record<string, unknown>
```

Graceful degradation per-type. No compile error — just weaker typing for unmapped types. Codegen always produces a complete TypeMap, so this only happens with hand-written maps.

### 6.4 Mutation input for edges without attributes

```typescript
await graph.mutate.link('placed_order', aliceId, orderId)
// ResolveEdgeInput<T, 'placed_order'> → Record<string, never> → never
// The `data?` parameter disappears from the signature (conditional)
```

Edges with no payload (`Record<string, never>` in TypeMap) omit the `data` parameter via conditional typing.

### 6.5 Traversal through reified edges

When an edge is reified (expanded to link nodes), the intermediate link node won't be in `TypeMap.nodes`. The `ResolveNode` fallback handles this — link node properties come back as `Record<string, unknown>` until the reification system has its own typing story.

---

## 7. Summary

| Aspect | Approach |
|--------|----------|
| **TypeMap location** | Separate generic `T` on `Graph<S, T>`, not embedded in `SchemaShape` |
| **Default** | `UntypedMap` — zero breakage for existing code |
| **Propagation** | 5th generic on all builders, always defaulted, auto-propagated by `.to()`/`.from()` |
| **Resolution** | `ResolveNode<T, N>` / `ResolveEdge<T, E>` — conditional with fallback |
| **Runtime cost** | Zero. `T` is phantom. Execution path unchanged |
| **Codegen output** | `TypeMap` interface + `createGraph()` wrapper per schema |
| **Node output** | `T['nodes'][N]` when mapped, `{ id, kind } & Record<string, unknown>` otherwise |
| **Edge output** | `T['edges'][E] & { id, kind }` when mapped, fallback otherwise |
| **Mutation input** | `T['nodeInputs'][N]` when mapped, `Record<string, unknown>` otherwise |
| **Projection** | Unchanged — `.return()` proxy is independent of TypeMap |
| **`.where()` typing** | Unchanged for v1 — `(field: string, op: string, value: unknown)` |
| **Breaking changes** | None |
