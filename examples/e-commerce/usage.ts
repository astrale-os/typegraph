// SDK usage — createGraph(), queries, traversals, method calls.
// This file shows the developer-facing API and intended DX.

import { schema } from './schema.generated'
import { core } from './core'
import { methods } from './methods'

// ─── Graph Setup ─────────────────────────────────────────────
// createGraph wires the schema, adapter, core data, and method
// implementations into a fully typed graph client.

const graph = await createGraph(schema, {
  adapter: new MemoryAdapter(),
  core,
  methods,
})

// ─── Basic Queries ───────────────────────────────────────────

// Find all gold-tier customers
const goldCustomers = await graph.node('Customer').where('tier', 'eq', 'gold').execute()
// → CustomerNode[] (typed: { id, __type, email, name, ... } & CustomerMethods)

// Get a single product by ID
const product = await graph.node('Product').byId('iphone').execute()
// → ProductNode (typed: { id, __type, title, sku, priceCents, ... })

// ─── Traversals ──────────────────────────────────────────────

// Customer → placedOrder → Order (follow edges)
const pendingOrders = await graph
  .node('Customer')
  .byId('cust-1')
  .to('placedOrder')
  .where('status', 'eq', 'pending')
  .execute()
// → OrderNode[] (& OrderMethods)

// Order → orderItem → Product (multi-hop with edge payload)
const orderProducts = await graph.node('Order').byId('order-42').to('orderItem').execute()

// ─── Method Calls ────────────────────────────────────────────

// Methods are bound directly on enriched node instances.
const customer = await graph.node('Customer').byId('cust-1').execute()

const name = customer.displayName()
// → "Alice <alice@example.com>"

const recent = await customer.recentOrders({ limit: 5 })
// → OrderNode[] (last 5 orders)

// ─── Mutations ───────────────────────────────────────────────

// Create a new order
const order = await graph.mutate.create('Order', {
  status: 'pending',
  totalCents: 4999,
})
// → OrderNode (validators run automatically via codegen-generated Zod schemas)

// Link customer to order
await graph.mutate.link('placedOrder', 'cust-1', order.id)

// Cancel via method
const cancelled = await order.cancel()
// → true | false
