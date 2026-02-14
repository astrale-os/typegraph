# Spec 01: Client SDK

> DX-first specification for the Astrale Typegraph Client SDK.
> Package: `@astrale/typegraph`

---

## 0. API Decisions — What We Keep, What We Change

Reviewed: legacy `typegraph/typegraph` (17 query files, full mutation system), `core/v2/specs` (pattern matching, subqueries), kernel operation system.

| Legacy API | Decision | Reason |
|-----------|----------|--------|
| `graph.node('User')` → CollectionBuilder | **Keep** | Natural entry point, directly returns builder |
| `graph.nodeById(id)` → SingleNodeBuilder | **Keep** | Common operation |
| `.to(edge)` / `.from(edge)` | **Keep** | Directional traversal — `.to()` follows from→to, `.from()` follows reverse. Far better than `.traverse()` |
| `.toOptional()` / `.fromOptional()` | **Keep** | OPTIONAL MATCH semantics, critical for left-join patterns |
| `.via(edge)` | **Keep** | Bidirectional traversal |
| `.toAny()` / `.fromAny()` / `.viaAny()` | **Keep** | Multi-edge traversal |
| Cardinality-aware builders (Single/Optional/Collection) | **Keep** | S-tier DX — return type changes based on edge cardinality |
| `.as()` + `.return(q => ...)` proxy projection | **Keep** | Best DX for multi-node projections |
| `.fork()` | **Keep** | Parallel branches from same point |
| `.pipe(fragment)` | **Keep** | Reusable query fragments |
| `graph.intersect()` / `graph.union()` | **Keep** | Set operations |
| `graph.shortestPath()` / `graph.allPaths()` | **Keep** | Path queries |
| `graph.edge(type)` | **Keep** | Edge-centric queries |
| `.ancestors()` / `.descendants()` / `.children()` / `.parent()` / `.root()` / `.siblings()` | **Keep** | Hierarchy traversal — core to Astrale's tree model |
| `.reachable()` / `.selfAndReachable()` | **Keep** | Transitive closure |
| `.whereComplex(builder)` with and/or/not | **Keep** | Complex boolean conditions |
| `.hasEdge()` / `.hasNoEdge()` | **Keep** | Edge existence — internal migration to SubqueryCondition later |
| `.whereConnectedTo()` / `.whereConnectedFrom()` | **Keep** | Connected-to-specific-node filter |
| `.groupBy()` | **Keep** | Aggregation |
| `.compile()` / `.toCypher()` | **Keep** | Debug/introspection |
| `.paginate({ page, pageSize })` | **Keep** | Convenience |
| `.executeWithMeta()` → data + count + hasMore | **Keep** | Pagination metadata |
| `graph.mutate.*` namespace | **Drop** | Flat API (`graph.create()`) is cleaner — read/write distinction isn't worth the extra nesting |
| Mutation hooks (beforeCreate, afterCreate, etc.) | **Keep** | Per-type hooks essential for business logic |
| Batch operations (createMany, linkMany, etc.) | **Keep** | Real-world need |
| Hierarchy mutations (createChild, move, clone, deleteSubtree) | **Keep** | Core to Astrale |
| Upsert | **Keep** | Common pattern |
| Dry-run mode | **Keep** | Dev/testing tool |
| `.link(edge, from, to, data?)` | **Change** | Use named endpoints from KRL: `.link(edge, { param: id, ... }, payload?)` |
| `CursorStep` / cursor pagination | **Drop** | Desugar to where+orderBy+limit at builder layer |
| `FirstStep` | **Drop** | Redundant with LimitStep |
| `graph.query('Type')` | **Drop** | `graph.node('Type')` is better |
| `.traverse(edge)` | **Drop** | `.to()` / `.from()` are more expressive |

**v2 additions:**

| v2 API | Decision | Reason |
|--------|----------|--------|
| `graph.match({ nodes, edges })` | **Add** | Declarative pattern matching for complex shapes |
| `.whereExists(subquery)` | **Add** | General subquery predicates |
| `.whereNotExists(subquery)` | **Add** | General subquery predicates |
| `.whereCount(subquery, op, value)` | **Add** | Count-based filtering |
| `.subquery(build)` | **Add** | Correlated subqueries (top-N-per-group) |
| `.unwind(field, as)` | **Add** | Array unwinding |

---

## 1. Developer Experience

### 1.1 KRL Schema with Methods

```krl
extend "https://kernel.astrale.ai/v1" { Identity }

type Email = String [format: email]
type OrderStatus = String [in: ["pending", "confirmed", "shipped", "delivered"]]

interface Timestamped {
  created_at: Timestamp = now(),
  updated_at: Timestamp?,

  fn age(): Int
}

class Customer: Identity, Timestamped {
  email: Email [unique],
  name: String,
  phone: String?,

  fn displayName(): String
  fn canPurchase(product: Product): Boolean
  fn recentOrders(limit: Int = 10): Order[]
}

class Product: Timestamped {
  title: String,
  sku: String [unique],
  price_cents: Int,
  in_stock: Boolean = true,

  fn formattedPrice(currency: String = "USD"): String
}

class Order: Timestamped {
  status: OrderStatus = "pending",
  total_cents: Int,

  fn cancel(): Boolean
  fn summary(): String
}

class placed_order(customer: Customer, order: Order) [order -> 1, unique]
class order_item(order: Order, product: Product) [] {
  quantity: Int = 1,
  unit_price_cents: Int,

  fn subtotal(): Int
}
class wishlisted(customer: Customer, product: Product) [unique]
class parent_category(child: Category, parent: Category) [no_self, acyclic, child -> 0..1]
```

### 1.2 Setup

```typescript
import { createGraph, defineCore, node } from './generated/shop.schema'
import { memgraph } from '@astrale/typegraph-adapter-memgraph'

const core = defineCore({
  nodes: {
    shop: node('Application', { name: 'Online Store' }),
  },
})

const graph = await createGraph({
  core,
  adapter: memgraph({ uri: 'bolt://localhost:7687' }),
  methods: {
    Customer: {
      displayName: ({ self }) => self.name,
      canPurchase: async ({ self, args, graph }) => args.product.in_stock,
      recentOrders: async ({ self, args, graph }) => {
        return graph.node('Order')
          .whereConnectedFrom('placed_order', self.id)
          .orderBy('created_at', 'DESC')
          .limit(args.limit)
          .execute()
      },
      age: ({ self }) => Math.floor((Date.now() - new Date(self.created_at).getTime()) / 1000),
    },
    Product: {
      formattedPrice: ({ self, args }) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: args.currency })
          .format(self.price_cents / 100),
      age: ({ self }) => Math.floor((Date.now() - new Date(self.created_at).getTime()) / 1000),
    },
    Order: {
      cancel: async ({ self, graph }) => {
        if (self.status !== 'pending') return false
        await graph.update('Order', self.id, { status: 'cancelled' })
        return true
      },
      summary: ({ self }) => `Order #${self.id} — ${self.status} ($${(self.total_cents / 100).toFixed(2)})`,
      age: ({ self }) => Math.floor((Date.now() - new Date(self.created_at).getTime()) / 1000),
    },
    // Edge methods
    order_item: {
      subtotal: ({ self }) => self.quantity * self.unit_price_cents,
    },
  },
})
```

### 1.3 Query Entry Points

```typescript
// Start from a node type → CollectionBuilder
graph.node('Customer')

// Start from a node by ID → SingleNodeBuilder
graph.nodeById(someId)

// Start from a node by ID with known type → SingleNodeBuilder (typed)
graph.get('Customer', someId)

// Pattern match (v2) → MatchBuilder
graph.match({
  nodes: { u: 'Customer', p: 'Product', c: 'Category' },
  edges: [
    { from: 'u', to: 'p', type: 'wishlisted' },
    { from: 'p', to: 'c', type: 'in_category' },
  ],
})

// Edge-centric query → EdgeBuilder
graph.edge('wishlisted')

// Set operations
graph.intersect(
  graph.node('Customer').where('status', 'eq', 'active'),
  graph.node('Customer').hasEdge('wishlisted', 'out'),
)
graph.union(queryA, queryB)

// Path queries
graph.shortestPath({
  from: { label: 'Category', id: catA },
  to: { label: 'Category', id: catB },
  via: 'parent_category',
})
```

### 1.4 Traversal — `.to()` / `.from()` / `.via()`

```typescript
// .to(edge) — follow from→to direction
const wishlist = graph.node('Customer')
  .where('email', 'eq', 'alice@example.com')
  .to('wishlisted')      // Customer is 'customer' endpoint (from), traverse to 'product' (to)
  .execute()
// wishlist: ProductNode[]

// .from(edge) — follow reverse direction
const customers = graph.node('Product')
  .where('sku', 'eq', 'MBP-16')
  .from('wishlisted')    // Product is 'product' endpoint (to), traverse to 'customer' (from)
  .execute()
// customers: CustomerNode[]

// Chained traversal
const categories = graph.node('Customer')
  .where('email', 'eq', 'alice@example.com')
  .to('wishlisted')         // → Product
  .to('in_category')        // → Category
  .execute()

// .via(edge) — bidirectional (both directions)
const related = graph.node('Category')
  .via('parent_category')
  .execute()
// related: CategoryNode[] (both parents and children)

// Optional traversal (LEFT JOIN — node still returned if no match)
const withParent = graph.node('Category')
  .toOptional('parent_category')
  .execute()

// Multi-edge traversal
const connected = graph.node('Customer')
  .toAny(['wishlisted', 'reviewed'])
  .execute()
// connected: ProductNode[] (via either edge)
```

### 1.5 Cardinality-Aware Return Types

The builder type changes based on edge cardinality declared in KRL:

```typescript
// placed_order has [order -> 1] (max 1 order per link)
const order = graph.node('Customer')
  .where('email', 'eq', 'alice@example.com')
  .to('placed_order')    // → SingleNodeBuilder (cardinality 'one')
  .execute()
// order: OrderNode (not OrderNode[], throws if not found)

// parent_category has [child -> 0..1] (optional parent)
const parent = graph.node('Category')
  .to('parent_category')  // → OptionalNodeBuilder (cardinality 'optional')
  .execute()
// parent: CategoryNode | null

// wishlisted has no cardinality constraint (many)
const products = graph.node('Customer')
  .to('wishlisted')       // → CollectionBuilder (cardinality 'many')
  .execute()
// products: ProductNode[]
```

### 1.6 SingleNodeBuilder / OptionalNodeBuilder

```typescript
// SingleNodeBuilder — exactly one result
const alice = graph.get('Customer', aliceId)   // → SingleNodeBuilder
await alice.execute()                           // → CustomerNode (throws if not found)
await alice.executeOrNull()                     // → CustomerNode | null

// OptionalNodeBuilder — zero or one result
const parent = graph.node('Category')
  .where('name', 'eq', 'Electronics')
  .to('parent_category')                       // → OptionalNodeBuilder
await parent.execute()                          // → CategoryNode | null
await parent.required().execute()               // → CategoryNode (throws if null)

// From CollectionBuilder → SingleNodeBuilder
const first = graph.node('Customer')
  .orderBy('created_at', 'DESC')
  .first()                                      // → SingleNodeBuilder
await first.execute()                           // → CustomerNode

const byId = graph.node('Customer')
  .byId(aliceId)                                // → SingleNodeBuilder
```

### 1.7 Filtering

```typescript
// Simple field comparison
graph.node('Customer').where('email', 'eq', 'alice@example.com')
graph.node('Product').where('price_cents', 'gte', 10000)
graph.node('Product').where('in_stock', 'eq', true)

// Complex conditions with boolean logic
graph.node('Product').whereComplex(w =>
  w.and(
    w.eq('in_stock', true),
    w.or(
      w.gte('price_cents', 10000),
      w.contains('title', 'Pro'),
    ),
  )
)

// Edge existence
graph.node('Customer').hasEdge('wishlisted', 'out')        // has outgoing wishlisted
graph.node('Product').hasNoEdge('reviewed', 'in')          // no incoming reviewed

// Connected to specific node
graph.node('Customer').whereConnectedTo('wishlisted', laptop.id)
graph.node('Product').whereConnectedFrom('wishlisted', alice.id)

// v2: Subquery-based filters
graph.node('Customer')
  .whereExists(q => q.to('wishlisted').where('in_stock', 'eq', true))

graph.node('Customer')
  .whereCount(q => q.to('placed_order'), 'gte', 5)  // customers with 5+ orders

// Label filtering (for polymorphic queries)
graph.node('Timestamped').withLabels('Customer', 'Product')
```

### 1.8 Hierarchy

```typescript
// Tree traversal (uses schema's hierarchy edge)
graph.get('Category', electronicsId)
  .children()                           // direct children
  .execute()

graph.get('Category', leafId)
  .parent()                             // → SingleNodeBuilder or OptionalNodeBuilder
  .execute()

graph.get('Category', leafId)
  .ancestors()                          // all ancestors to root
  .execute()

graph.get('Category', rootId)
  .descendants()                        // all descendants recursively
  .execute()

graph.get('Category', someId)
  .root()                               // root ancestor → SingleNodeBuilder
  .execute()

graph.get('Category', someId)
  .siblings()                           // same parent
  .execute()

// With options
graph.get('Category', leafId)
  .ancestors({ maxDepth: 3, includeDepth: true })
  .execute()

// Transitive closure
graph.get('Customer', aliceId)
  .reachable(['wishlisted', 'reviewed'], { maxDepth: 3 })
  .execute()
```

### 1.9 Projection — `.as()` + `.return()`

```typescript
const result = await graph.node('Customer')
  .where('email', 'eq', 'alice@example.com')
  .as('customer')
  .to('wishlisted')
  .as('product')
  .to('in_category')
  .as('category')
  .return(q => ({
    name: q.customer.name,
    productTitle: q.product.title,
    price: q.product.price_cents,
    categoryName: q.category.name,
    allProducts: collect(q.product),   // aggregation
  }))
  .execute()
// result: Array<{ name: string, productTitle: string, price: number, ... }>
```

### 1.10 Sorting, Pagination, Aggregation

```typescript
// Ordering
graph.node('Product').orderBy('price_cents', 'ASC')
graph.node('Product').orderByMultiple([
  { field: 'in_stock', direction: 'DESC' },
  { field: 'price_cents', direction: 'ASC' },
])

// Pagination
graph.node('Product').limit(20).skip(40)
graph.node('Product').paginate({ page: 3, pageSize: 20 })

// Count & exists
await graph.node('Customer').count()    // → number
await graph.node('Customer').exists()   // → boolean

// With metadata
await graph.node('Product')
  .where('in_stock', 'eq', true)
  .orderBy('price_cents', 'ASC')
  .paginate({ page: 1, pageSize: 20 })
  .executeWithMeta()
// → { data: ProductNode[], meta: { count: number, hasMore: boolean } }

// Aggregation
await graph.node('Product')
  .groupBy('category_id')
  .aggregate({ avgPrice: avg('price_cents'), count: count() })
  .execute()

// Distinct
graph.node('Product').to('in_category').distinct().execute()
```

### 1.11 Composition — `.fork()` / `.pipe()`

```typescript
// Fork: parallel branches from the same starting point
const result = await graph.get('Customer', aliceId)
  .as('customer')
  .fork(
    q => q.to('wishlisted').as('wishlisted'),
    q => q.to('placed_order').to('order_item').as('purchased'),
  )
  .return(q => ({
    wishlisted: collect(q.wishlisted),
    purchased: collect(q.purchased),
  }))
  .execute()

// Pipe: reusable query fragments
const activeCustomers = (q: CollectionBuilder<S, 'Customer'>) =>
  q.where('status', 'eq', 'active').hasEdge('placed_order', 'out')

graph.node('Customer').pipe(activeCustomers).execute()
```

### 1.12 Pattern Match (v2)

```typescript
// Declarative multi-node pattern
const diamonds = await graph.match({
  nodes: {
    customer: 'Customer',
    productA: 'Product',
    productB: 'Product',
    category: 'Category',
  },
  edges: [
    { from: 'customer', to: 'productA', type: 'wishlisted' },
    { from: 'customer', to: 'productB', type: 'reviewed' },
    { from: 'productA', to: 'category', type: 'in_category' },
    { from: 'productB', to: 'category', type: 'in_category' },
  ],
})
  .where('customer', 'email', 'eq', 'alice@example.com')
  .return(q => ({
    category: q.category.name,
    wishlisted: q.productA.title,
    reviewed: q.productB.title,
  }))
  .execute()
```

### 1.13 Creating Nodes

```typescript
const alice = await graph.create('Customer', {
  email: 'alice@example.com',
  name: 'Alice',
})
// alice: CustomerNode (enriched: { id, __type, ...props, ...methods })

// With options
const child = await graph.createChild('Module', parentId, {
  name: 'Submodule',
})

// Batch
const products = await graph.createMany('Product', [
  { title: 'Laptop', sku: 'LAP-1', price_cents: 99900, slug: 'laptop' },
  { title: 'Mouse', sku: 'MOU-1', price_cents: 2900, slug: 'mouse' },
])
```

### 1.14 Links (Edges)

```typescript
// Create edge (using named KRL endpoints)
await graph.link('wishlisted', {
  customer: alice.id,
  product: laptop.id,
})

// Edge with payload
await graph.link('order_item', {
  order: order.id,
  product: laptop.id,
}, { quantity: 2, unit_price_cents: 12900 })

// Update edge payload
await graph.patchLink('order_item', {
  order: order.id,
  product: laptop.id,
}, { quantity: 3 })

// Remove edge
await graph.unlink('wishlisted', {
  customer: alice.id,
  product: laptop.id,
})

// Batch
await graph.linkMany('wishlisted', [
  { customer: alice.id, product: laptop.id },
  { customer: alice.id, product: mouse.id },
])

// Remove all outgoing edges of a type
await graph.unlinkAllFrom('wishlisted', { customer: alice.id })
```

### 1.15 Updates, Deletes, Upsert

```typescript
// Partial update
await graph.update('Customer', alice.id, { phone: '+1-555-0123' })

// Delete (type-safe)
await graph.delete('Customer', alice.id)

// Delete subtree
await graph.deleteSubtree('Category', rootCatId)

// Upsert (create or update)
const result = await graph.upsert('Product', existingId, {
  title: 'Updated Laptop',
  sku: 'LAP-1',
  price_cents: 89900,
  slug: 'laptop',
})
// result.created: boolean — true if new, false if updated

// Move node to new parent
await graph.move(nodeId, newParentId)

// Clone
const cloned = await graph.clone('Product', laptop.id, { title: 'Laptop Copy' })
```

### 1.16 Transactions

```typescript
const order = await graph.transaction(async (tx) => {
  const order = await tx.create('Order', { status: 'pending', total_cents: 249900 })
  await tx.link('placed_order', { customer: alice.id, order: order.id })
  await tx.link('order_item', {
    order: order.id,
    product: laptop.id,
  }, { quantity: 1, unit_price_cents: 249900 })
  return order
})
```

### 1.17 Methods on Enriched Nodes

```typescript
const customer = await graph.get('Customer', aliceId)
const name = await customer.displayName()
const orders = await customer.recentOrders({ limit: 5 })
const canBuy = await customer.canPurchase({ product: laptop })

// Direct call (skips loading the full node)
const name = await graph.call('Customer', aliceId, 'displayName')

// Polymorphic dispatch
const nodes = await graph.node('Timestamped').execute()
for (const node of nodes) {
  const age = await node.age()  // works on all Timestamped implementors
}
```

### 1.18 Edge Methods

Edges with methods return enriched edge instances:

```typescript
// Query edges → enriched with methods
const items = await graph.edge('order_item')
  .where('order', 'eq', orderId)
  .execute()

for (const item of items) {
  const sub = await item.subtotal()   // bound method on edge
}

// Direct edge method call (by endpoints)
const sub = await graph.callEdge('order_item', {
  order: orderId,
  product: laptopId,
}, 'subtotal')
```

Edge method context includes endpoint IDs (see [03-krl-methods.md §3.2](./03-krl-methods.md)):
```typescript
// Handler receives { self: { ...payload, endpoints: { order, product } }, args, graph }
order_item: {
  subtotal: ({ self }) => self.quantity * self.unit_price_cents,
}
```

### 1.19 Debug / Introspection

```typescript
const query = graph.node('Customer').where('email', 'eq', 'alice@example.com').to('wishlisted')
console.log(query.toCypher())   // MATCH (n0:Customer) WHERE n0.email = $p0 ...
console.log(query.toParams())   // { p0: 'alice@example.com' }
const compiled = query.compile() // { cypher: string, params: Record<string, unknown> }
```

### 1.20 Interface / Polymorphic Queries

```typescript
const all = await graph.node('Timestamped').execute()
// all: (CustomerNode | ProductNode | OrderNode)[]

for (const node of all) {
  console.log(node.__type, await node.age())
  if (node.__type === 'Customer') {
    console.log(await node.displayName())
  }
}
```

### 1.21 Refs

```typescript
graph.refs.core.shop           // core instance ID
graph.refs.schema.Customer     // schema meta-node ID
```

---

## 2. Enriched Nodes & Edges

Every node returned from the SDK is enriched with `id`, `__type`, and method proxies (own + inherited):

```typescript
type CustomerNode = Customer & {
  readonly id: string
  readonly __type: 'Customer'
} & CustomerMethods & TimestampedMethods

type OrderNode = Order & {
  readonly id: string
  readonly __type: 'Order'
} & OrderMethods & TimestampedMethods

type AnyNode = CustomerNode | ProductNode | OrderNode | CategoryNode
```

Edges with methods get enriched too:

```typescript
type OrderItemEdge = OrderItemPayload & {
  readonly endpoints: { order: string; product: string }
} & OrderItemMethods
```

Types with no methods: enriched with `{ id, __type }` only — no proxy overhead.

`.select()` and `.return()` return raw projections (no enrichment).

---

## 3. Codegen Additions

Full codegen contract: see [03-krl-methods.md §3](./03-krl-methods.md).

SDK-facing outputs from the new `emit/methods.ts` emitter:

| Output | What |
|--------|------|
| `*Methods` interfaces | `CustomerMethods`, `TimestampedMethods`, `OrderItemMethods` — one per type with methods |
| `MethodContext<Self, Args>` | Handler receives `{ self, args, graph }` |
| `EdgeMethodContext<Payload, Args>` | Edge handler receives `{ self: { ...payload, endpoints }, args, graph }` |
| `MethodsConfig` | Concrete classes + edges with methods; includes inherited methods |
| `schema.methods` | Metadata: param types, defaults, return types — used at startup validation + `graph.call()` |
| Enriched node types | `CustomerNode = Customer & { id, __type } & CustomerMethods & TimestampedMethods` |
| `SchemaNodeTypeMap` | Maps type name → enriched node type |

**Parameter encoding** — codegen follows these rules:
- 0 params → no `args` on method interface
- All params required → `args: { name: Type }`
- Some/all have defaults → `args?: { name?: Type }` (optional params get `?`)
- Return type always `T | Promise<T>` — allows sync and async implementations

---

## 4. Builder Types (Cardinality-Aware)

```typescript
// CollectionBuilder — 0..N results
interface CollectionBuilder<S, N, Aliases, EdgeAliases, M> {
  // Terminal
  execute(): Promise<SchemaNodeTypeMap[N][]>
  executeWithMeta(): Promise<{ data: SchemaNodeTypeMap[N][]; meta: { count: number; hasMore: boolean } }>
  count(): Promise<number>
  exists(): Promise<boolean>

  // Narrow
  first(): SingleNodeBuilder<S, N, Aliases, EdgeAliases, M>
  byId(id: string): SingleNodeBuilder<S, N, Aliases, EdgeAliases, M>
  take(count: number): CollectionBuilder<S, N, Aliases, EdgeAliases, M>

  // Traversal (always returns Collection from Collection)
  to<E extends OutgoingEdges<S, N>>(edge: E, opts?): CollectionBuilder<S, EdgeTargetsFrom<S, E, N>, ...>
  from<E extends IncomingEdges<S, N>>(edge: E, opts?): CollectionBuilder<S, EdgeSourcesTo<S, E, N>, ...>
  toOptional<E>(edge: E, opts?): CollectionBuilder<...>
  fromOptional<E>(edge: E, opts?): CollectionBuilder<...>
  via<E>(edge: E, opts?): CollectionBuilder<...>
  toAny<Edges>(edges: Edges, opts?): CollectionBuilder<...>
  fromAny<Edges>(edges: Edges, opts?): CollectionBuilder<...>

  // Filter, sort, paginate, alias, project, fork, pipe, hierarchy...
}

// SingleNodeBuilder — exactly 1 result
interface SingleNodeBuilder<S, N, Aliases, EdgeAliases, M> {
  execute(): Promise<SchemaNodeTypeMap[N]>
  executeOrNull(): Promise<SchemaNodeTypeMap[N] | null>

  // Traversal (cardinality-aware return type!)
  to<E extends OutgoingEdges<S, N>>(edge: E, opts?):
    EdgeOutboundCardinality<S, E> extends 'one' ? SingleNodeBuilder<...> :
    EdgeOutboundCardinality<S, E> extends 'optional' ? OptionalNodeBuilder<...> :
    CollectionBuilder<...>

  from<E extends IncomingEdges<S, N>>(edge: E, opts?):
    EdgeInboundCardinality<S, E> extends 'one' ? SingleNodeBuilder<...> :
    EdgeInboundCardinality<S, E> extends 'optional' ? OptionalNodeBuilder<...> :
    CollectionBuilder<...>

  // Hierarchy (single-specific)
  parent(edge?): SingleNodeBuilder | OptionalNodeBuilder
  root(edge?): SingleNodeBuilder

  // ...filter, alias, project, fork, pipe
}

// OptionalNodeBuilder — 0 or 1 result
interface OptionalNodeBuilder<S, N, Aliases, EdgeAliases, M> {
  execute(): Promise<SchemaNodeTypeMap[N] | null>
  required(): SingleNodeBuilder<S, N, Aliases, EdgeAliases, M>

  to<E extends OutgoingEdges<S, N>>(edge: E, opts?):
    EdgeOutboundCardinality<S, E> extends 'one' ? OptionalNodeBuilder<...> :
    CollectionBuilder<...>

  // ...filter, alias, project
}
```

---

## 5. Full Graph Interface

```typescript
interface Graph<S> {
  // ── Query entry points ──────────────────────────────────────
  node<N extends NodeLabels<S>>(label: N): CollectionBuilder<S, N>
  nodeById(id: string): SingleNodeBuilder<S, NodeLabels<S>>
  get<N extends ConcreteNodeType<S>>(type: N, id: string): Promise<SchemaNodeTypeMap[N]>
  get(id: string): Promise<AnyNode>
  edge<E extends SchemaEdgeType>(type: E): EdgeBuilder<S, E>
  match(config: MatchConfig<S>): MatchBuilder<S>
  intersect<N>(...queries: CollectionBuilder<S, N>[]): CollectionBuilder<S, N>
  union<N>(...queries: CollectionBuilder<S, N>[]): CollectionBuilder<S, N>
  shortestPath(config: PathConfig<S>): PathBuilder<S>
  allPaths(config: PathConfig<S>): PathBuilder<S>
  raw<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>

  // ── Mutations ───────────────────────────────────────────────
  create<N extends ConcreteNodeType<S>>(type: N, input: NodeInput<S, N>, opts?: CreateOptions): Promise<SchemaNodeTypeMap[N]>
  createChild<N extends ConcreteNodeType<S>>(type: N, parentId: string, input: NodeInput<S, N>, opts?): Promise<SchemaNodeTypeMap[N]>
  createMany<N extends ConcreteNodeType<S>>(type: N, inputs: NodeInput<S, N>[], opts?): Promise<SchemaNodeTypeMap[N][]>
  update<N extends ConcreteNodeType<S>>(type: N, id: string, input: Partial<NodeInput<S, N>>): Promise<void>
  upsert<N extends ConcreteNodeType<S>>(type: N, id: string, input: NodeInput<S, N>): Promise<{ node: SchemaNodeTypeMap[N]; created: boolean }>
  delete<N extends ConcreteNodeType<S>>(type: N, id: string): Promise<void>
  deleteSubtree<N extends ConcreteNodeType<S>>(type: N, rootId: string): Promise<{ deletedCount: number }>
  move(nodeId: string, newParentId: string): Promise<void>
  clone<N extends ConcreteNodeType<S>>(type: N, sourceId: string, overrides?: Partial<NodeInput<S, N>>): Promise<SchemaNodeTypeMap[N]>

  // ── Edges ───────────────────────────────────────────────────
  link<E extends SchemaEdgeType>(edge: E, endpoints: CoreEdgeEndpoints[E], payload?: EdgePayloadInput<S, E>): Promise<void>
  patchLink<E extends SchemaEdgeType>(edge: E, endpoints: CoreEdgeEndpoints[E], payload: Partial<EdgePayloadInput<S, E>>): Promise<void>
  unlink<E extends SchemaEdgeType>(edge: E, endpoints: CoreEdgeEndpoints[E]): Promise<void>
  linkMany<E extends SchemaEdgeType>(edge: E, items: Array<{ endpoints: CoreEdgeEndpoints[E]; payload?: EdgePayloadInput<S, E> }>): Promise<void>
  unlinkAllFrom<E extends SchemaEdgeType>(edge: E, endpoints: Partial<CoreEdgeEndpoints[E]>): Promise<void>

  // ── Methods ─────────────────────────────────────────────────
  call<N extends ConcreteNodeType<S>, M extends MethodName<N>>(
    type: N, id: string, method: M,
    ...args: MethodArgs<N, M> extends void ? [] : [MethodArgs<N, M>]
  ): Promise<MethodReturn<N, M>>

  callEdge<E extends SchemaEdgeType, M extends EdgeMethodName<E>>(
    edge: E, endpoints: CoreEdgeEndpoints[E], method: M,
    ...args: EdgeMethodArgs<E, M> extends void ? [] : [EdgeMethodArgs<E, M>]
  ): Promise<EdgeMethodReturn<E, M>>

  // ── Transaction ─────────────────────────────────────────────
  transaction<T>(fn: (tx: Transaction<S>) => Promise<T>): Promise<T>

  // ── Refs ────────────────────────────────────────────────────
  refs: { core: Record<string, string>; schema: Record<SchemaType, string> }

  // ── Lifecycle ───────────────────────────────────────────────
  close(): Promise<void>
}
```

---

## 6. Method System

Full specification: [03-krl-methods.md](./03-krl-methods.md).

| Aspect | Decision |
|--------|----------|
| **Keyword** | `fn` — visual separation from attributes, 1-token lookahead |
| **Return type** | Mandatory. `Type[]` for list, `Type?` for nullable (mutually exclusive) |
| **Body** | Never. KRL is contract-only. Implementation is TypeScript |
| **Edge methods** | Supported. `EdgeMethodContext` includes `self.endpoints` |
| **Modifiers** | None for v1. Grammar slot reserved for future `[authorized]`, `[audited]` |
| **Override** | Implicit inheritance. Redeclaration with identical signature allowed |
| **Diamond** | Same signature required across conflicting interfaces; validator catches conflicts |
| **IR** | `MethodDef[]` on both `NodeDef` and `EdgeDef`. `List` variant added to `TypeRef` |
| **Codegen** | 5 outputs: method interfaces, context types, `MethodsConfig`, schema metadata, enriched node types |
| **Pipeline** | Lexer unchanged; parser + lower + resolver + validator + serializer all extended |

Runtime wiring (see [02-schema-runtime.md §6](./02-schema-runtime.md)):
- Startup: `validateMethodImplementations()` fails fast if any concrete type or edge is missing handlers
- Query results: `enrichNode()` / `enrichEdge()` wraps results with Proxy binding methods to handlers
- Direct call: `graph.call()` / `graph.callEdge()` loads node/edge, validates args, invokes handler

---

## 7. Summary

| Aspect | Approach |
|--------|----------|
| **Query entry** | `graph.node(type)`, `graph.match({...})`, `graph.get(type, id)` |
| **Traversal** | `.to(edge)` / `.from(edge)` / `.via(edge)` — directional, cardinality-aware |
| **Builders** | `CollectionBuilder`, `SingleNodeBuilder`, `OptionalNodeBuilder` — return type changes with cardinality |
| **Pattern match** | `graph.match({ nodes, edges })` for complex multi-node shapes |
| **Filtering** | `.where()`, `.whereComplex()`, `.hasEdge()`, `.whereExists()`, `.whereCount()` |
| **Hierarchy** | `.ancestors()`, `.descendants()`, `.children()`, `.parent()`, `.root()`, `.siblings()` |
| **Projection** | `.as()` + `.return(q => ...)` with proxy-based property tracking |
| **Composition** | `.fork()` for parallel branches, `.pipe()` for reusable fragments |
| **Mutations** | Flat API: `graph.create()`, `graph.link()`, batch ops, hierarchy ops, upsert |
| **Methods** | KRL `fn` contracts → typed handlers → enriched nodes/edges with bound methods |
| **Transactions** | `graph.transaction(async tx => { ... })` |
| **Set ops** | `graph.intersect()`, `graph.union()` |
| **Paths** | `graph.shortestPath()`, `graph.allPaths()` |
| **Debug** | `.compile()`, `.toCypher()`, `.toParams()` |
| **Enrichment** | Nodes: `{ id, __type, ...props, ...methods }`. Edges with methods: `{ endpoints, ...payload, ...methods }` |
