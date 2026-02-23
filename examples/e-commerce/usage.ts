// SDK usage — createGraph(), queries, traversals, method calls.
// This file shows the developer-facing API and intended DX.

import { schema } from './schema.generated'
import { core } from './core'
import { createGraph } from '@astrale/typegraph-client'

// ─── Graph Setup ─────────────────────────────────────────────
// createGraph wires the schema, adapter, core data, and operation
// dispatch into a fully typed graph client.

const graph = await createGraph(schema, {
  adapter: new MemoryAdapter(),
  core,
  dispatch: kernel.call,
})

// ─── Basic Queries ───────────────────────────────────────────

// Find all gold-tier customers
const goldCustomers = await graph.node('Customer').where('tier', 'eq', 'gold').execute()
// → CustomerNode[] (typed: { id, __type, email, name, ... })

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
// → OrderNode[]

// Order → orderItem → Product (multi-hop with edge payload)
const orderProducts = await graph.node('Order').byId('order-42').to('orderItem').execute()

// ─── Method Calls ────────────────────────────────────────────

// Methods dispatch through the kernel. Use graph.as(auth) to scope.
const g = graph.as(auth)

const customer = await g.node('Customer').byId('cust-1').execute()

const name = customer.displayName()
// → dispatches: kernel.call('Customer.displayName', auth, undefined, customer)
// → "Alice <alice@example.com>"

const recent = await customer.recentOrders({ limit: 5 })
// → dispatches: kernel.call('Customer.recentOrders', auth, { limit: 5 }, customer)
// → OrderNode[] (last 5 orders)

// ─── Mutations ───────────────────────────────────────────────

// Create a new order
const order = await g.mutate.create('Order', {
  status: 'pending',
  totalCents: 4999,
})

// Link customer to order
await g.mutate.link('placedOrder', 'cust-1', order.id)

// Cancel via method
const cancelled = await order.cancel()
// → dispatches: kernel.call('Order.cancel', auth, undefined, order)
// → true | false
