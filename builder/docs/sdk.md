# SDK — Typed Graph Client

The SDK is a typed graph client derived from the schema. It lets you query nodes, traverse edges, call methods, and link/unlink — all with **strict compile-time validation** of edge endpoints, including through deep inheritance chains. Zero codegen.

## Setup

```typescript
import { createClient } from '@astrale/builder'
import { Schema } from './schema'

export const db = createClient(Schema)
```

All types flow from `Schema`. The compiler knows every node, edge, interface, prop, method, cardinality constraint, and inheritance relationship.

---

## Querying nodes

```typescript
const customers = await db.Customer.findMany()
const customer  = await db.Customer.findById(id)
const active    = await db.Customer.findMany({ where: { inStock: true } })
```

Props on the returned instances are fully typed from the schema definition (own props + inherited interface props):

```typescript
const c = await db.Customer.findById(id)
c.email      // string          (own prop)
c.phone      // string | undefined (own prop, optional)
c.createdAt  // string          (from Timestamped interface)
c.updatedAt  // string | undefined (from Timestamped interface)
```

---

## Traversing edges — strict endpoint filtering

Edge traversals are methods on node instances. Traversal is **bidirectional**: edges appear when the node (or one of its ancestors) matches either endpoint. The method is named after the **opposite** endpoint's `as`. The compiler resolves the full inheritance chain.

```typescript
const customer = await db.Customer.findById(id)

// placedOrder: from = { as: 'customer', types: [Customer] } → method named to.as = 'order'
const orders = await customer.order()          // Order[]

// hasPerm: from = { as: 'identity', types: [Identity] } → Customer implements Identity → method named to.as = 'target'
const perms = await customer.target()          // available

// inCategory: neither endpoint matches Customer → no method
// customer.category()                         // ✗ TS error: property does not exist
```

### Cardinality-aware return types

The return type reflects the **traversing endpoint's** cardinality — it encodes how many edge instances that endpoint participates in:

```typescript
// placedOrder: to = { as: 'order', cardinality: '1' } — Order has exactly 1 edge → returns single Customer
const customer = await order.customer()              // Customer (never null)

// parentCategory: from = { as: 'child', cardinality: '0..1' } — child has 0..1 edges → returns nullable
const parent = await category.parent()               // Category | null

// inCategory: to = { as: 'category' } — no cardinality (defaults to '0..*') → returns array
const products = await category.product()            // Product[]
```

### Chained traversals

```typescript
const categories = await db.Customer.findById(id)
  .order()
  .flatMap(o => o.product())
  .flatMap(p => p.category())
```

Each step is strictly typed: `.order()` returns `Order[]` (from `placedOrder`, `to.as`), `.product()` is available on `Order` and returns `Product[]` (from `orderItem`, `to.as`), `.category()` is available on `Product` and returns `Category[]` (from `inCategory`, `to.as`).

---

## Calling methods

Methods declared in the schema are bound to the node instance:

```typescript
const customer = await db.Customer.findById(id)
const name     = await customer.displayName()            // string
const recent   = await customer.recentOrders({ limit: 5 }) // Order[]
```

Edge methods work the same way — accessed on edge instances returned by traversal:

```typescript
const items = await order.product()  // edge instances from orderItem
const sub   = await items[0].subtotal()  // number (edge method)
```

---

## Datastore-backed node content (`node.data`)

`props` stay in the graph and are returned directly by query methods. `node.data` / `iface.data` describe datastore-backed content exposed through typed methods (for example `method({ returns: data() })`).

```typescript
const product = await db.Product.findById(id)
const content = await product.content() // { description: string, images: string[] }
```

`content()` here is a regular typed method; the datastore payload shape is defined in the schema `data` field of the target node/interface.

---

## Mutations

```typescript
const product = await db.Product.create({
  title: 'Laptop Pro',
  sku:   'LP-001',
  priceCents: 129900,
})

await db.Product.update(id, { inStock: false })
await db.Product.delete(id)
```

Create and update validate props against the full prop shape (own + inherited).

---

## Linking — strict endpoint validation

`db.link()` and `db.unlink()` validate **both** source and target against the edge's declared endpoint types at compile time.

### Valid calls

```typescript
await db.link(customer, 'placedOrder', order)    // ✓ Customer matches source, Order matches target
await db.link(product, 'inCategory', category)   // ✓ Product matches source, Category matches target
```

### Compile-time errors

```typescript
await db.link(customer, 'inCategory', category)  // ✗ Customer is not a valid source for inCategory
await db.link(product, 'placedOrder', order)     // ✗ Product is not a valid source for placedOrder
await db.link(customer, 'placedOrder', product)  // ✗ Product is not a valid target for placedOrder
```

### Edge props on link

If the edge has props, they are passed as an optional typed `data` argument:

```typescript
await db.link(order, 'orderItem', product, {
  quantity: 2,
  unitPriceCents: 4999,
})
// data is typed as { quantity?: number, unitPriceCents: number }
```

---

## Deep inheritance resolution

The strict validation resolves through the **full inheritance chain**, not just direct implements. This is the key DX guarantee.

### Example: `hasPerm` edge

```
hasPerm edge:
  from = { types: [Identity] }
  to   = { types: [Node] }

Customer implements [Identity, Timestamped]
  → Identity is a direct ancestor → Customer is a valid source

Product implements [Timestamped, HasSlug, Priceable]
  → none of these ancestors match Identity → Product is NOT a valid source
```

```typescript
await db.link(customer, 'hasPerm', targetNode)   // ✓ Customer → Identity → valid
await db.link(product, 'hasPerm', targetNode)    // ✗ TS error: Product has no Identity ancestor
```

### Example: multi-level chain

```
// Given:
//   Auditable extends [Timestamped]
//   Trackable extends [Auditable]
//   Invoice implements [Trackable]
//   someEdge: from = { types: [Timestamped] }
//
// WalkAncestors<typeof Invoice> =
//   typeof Invoice | typeof Trackable | typeof Auditable | typeof Timestamped
//
// IsCompatible<typeof Invoice, [typeof Timestamped]> = true
//   because typeof Timestamped ∈ WalkAncestors<typeof Invoice>

await db.link(invoice, 'someEdge', target)       // ✓ works through 3-level chain
```

---

## Type safety summary

```typescript
const c = await db.Customer.findById(id)
c.email          // string
c.phone          // string | undefined
c.createdAt      // string (inherited from Timestamped)
c.displayName()  // Promise<string>
c.recentOrders({ limit: 5 }) // Promise<Order[]>

// Edge traversals — named after opposite endpoint's as, only compatible edges appear:
c.order          // ✓ Customer matches from → method = to.as
c.target         // ✓ Customer → Identity → matches from of hasPerm → method = to.as
// c.category    // ✗ does not exist (Customer matches neither endpoint of inCategory)
```

---

## Type-level mechanism

The strict validation is powered by three type utilities in `@astrale/builder` (see [typing-strategy](design/typing-strategy.md) §"Strict endpoint validation"):

1. **`WalkAncestors<D>`** — recursively flattens a def's full inheritance tree into a single union. Uses TypeScript's distributive conditional types over `readonly` tuples.

2. **`IsCompatible<D, AllowedTypes>`** — checks if any ancestor of `D` appears in the endpoint's `types` array. A single `Extract` on the flattened union — O(1) for the TS compiler.

3. **`ValidNodesForEndpoint<S, Endpoint>`** — maps over all nodes in the schema, keeps only those where `IsCompatible` returns `true`. Produces the union of all concrete nodes valid for a given endpoint.

4. **`EdgeMethods<S, CurrentNode>`** — bidirectional: maps over all edges, filters to those where `CurrentNode` matches either endpoint. Method is named after the opposite endpoint's `as`. Return type reflects the traversing endpoint's cardinality.

5. **`StrictLink<S>`** — constrains both `from` and `to` to the computed valid node unions for the edge's endpoints. Edge props are typed when present.

These utilities require `readonly` tuple inference in the builder configs (see [typing-strategy](design/typing-strategy.md) §"Builder config types"). Without it, TypeScript loses track of which specific interfaces are implemented and the filtering becomes impossible.

---

## What is NOT in the SDK

- Authorization logic (handled by the kernel)
- Transport configuration (handled by `createClient` config)
- Raw graph access or query building
