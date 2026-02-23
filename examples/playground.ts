#!/usr/bin/env tsx
/**
 * E2E Playground — Full pipeline: codegen schema → FalkorDB → SDK
 *
 * Uses the e-commerce example (schema.gsl → schema.generated.ts).
 *
 * Run:
 *   pnpm playground            (from examples/)
 *   npx tsx playground.ts      (from examples/)
 */

import {
  createTypedGraph,
  schema,
  type CustomerNode,
  type ProductNode,
  type OrderNode,
} from './e-commerce/schema.generated'
import { core } from './e-commerce/core'
import { installCore } from '@astrale/typegraph-client'
import { falkordb, clearGraph } from '@astrale/typegraph-adapter-falkordb'

// ─── Config ──────────────────────────────────────────────────────────────────

const GRAPH_NAME = 'playground'
const PORT = 6379

const adapterConfig = { graphName: GRAPH_NAME, host: 'localhost', port: PORT }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function section(title: string) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  ${title}`)
  console.log(`${'─'.repeat(60)}`)
}

function log(label: string, data: unknown) {
  console.log(`  ${label}:`, JSON.stringify(data, null, 2))
}

// ─── Types ───────────────────────────────────────────────────────────────────

type Refs = Record<string, string>

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  // ── Setup ─────────────────────────────────────────────────────────────────

  section('Setup')

  try {
    await clearGraph(adapterConfig)
  } catch {
    /* no-op if graph doesn't exist */
  }

  const graph = await createTypedGraph({
    adapter: falkordb(adapterConfig),
  })

  console.log('  Connected to FalkorDB')
  console.log(
    '  Schema nodes:',
    Object.keys(schema.nodes).filter((n) => !(schema.nodes as any)[n].abstract),
  )
  console.log('  Schema edges:', Object.keys(schema.edges))

  // ── Seed core data ────────────────────────────────────────────────────────

  section('Seed — Core Data (from core.ts)')

  const { refs } = await installCore(graph, core, {
    beforeCreate: (_type: string, props: Record<string, unknown>) => ({
      createdAt: new Date().toISOString(),
      ...props,
    }),
    onNode: (ref: string, type: string, id: string) => console.log(`  ${type} "${ref}" → ${id}`),
    onEdge: (type: string, from: string, to: string) => console.log(`  ${type}: ${from} → ${to}`),
  })

  // ── Seed extra data via mutations ─────────────────────────────────────────

  section('Seed — Additional Data (mutations)')

  const now = new Date().toISOString()

  const alice = await graph.mutate.create('Customer', {
    createdAt: now,
    email: 'alice@shop.com',
    name: 'Alice',
  })
  refs['alice'] = alice.id
  console.log(`  Customer "alice" → ${alice.id}`)

  const bob = await graph.mutate.create('Customer', {
    createdAt: now,
    email: 'bob@shop.com',
    name: 'Bob',
  })
  refs['bob'] = bob.id
  console.log(`  Customer "bob" → ${bob.id}`)

  const order1 = await graph.mutate.create('Order', {
    createdAt: now,
    status: 'confirmed',
    totalCents: 99900,
  })
  refs['order1'] = order1.id
  console.log(`  Order "order1" → ${order1.id}`)

  const order2 = await graph.mutate.create('Order', {
    createdAt: now,
    status: 'pending',
    totalCents: 229800,
  })
  refs['order2'] = order2.id
  console.log(`  Order "order2" → ${order2.id}`)

  // Link orders
  await graph.mutate.link('placedOrder', refs['alice']!, refs['order1']!)
  console.log('  placedOrder: alice → order1')

  await graph.mutate.link('placedOrder', refs['bob']!, refs['order2']!)
  console.log('  placedOrder: bob → order2')

  // Link order items
  await graph.mutate.link('orderItem', refs['order1']!, refs['iphone']!, {
    quantity: 1,
    unitPriceCents: 99900,
  })
  console.log('  orderItem: order1 → iphone (qty: 1)')

  await graph.mutate.link('orderItem', refs['order2']!, refs['iphone']!, {
    quantity: 1,
    unitPriceCents: 99900,
  })
  await graph.mutate.link('orderItem', refs['order2']!, refs['macbook']!, {
    quantity: 1,
    unitPriceCents: 129900,
  })
  console.log('  orderItem: order2 → iphone + macbook')

  // ── Queries ───────────────────────────────────────────────────────────────

  section('Query — All Customers')
  const allCustomers = await graph.node('Customer').execute()
  log('result', allCustomers)

  section('Query — All Products')
  const allProducts = await graph.node('Product').execute()
  log('result', allProducts)

  section('Query — All Categories')
  const allCategories = await graph.node('Category').execute()
  log('result', allCategories)

  section('Query — By ID')
  const aliceById = await graph.node('Customer').byId(refs['alice']!).execute()
  log(`Customer ${refs['alice']}`, aliceById)

  section('Query — Where (filter)')
  const confirmedOrders = await graph.node('Order').where('status', 'eq', 'confirmed').execute()
  log('Confirmed orders', confirmedOrders)

  section('Traversal — Alice → placedOrder → Orders')
  const aliceOrders = await graph.node('Customer').byId(refs['alice']!).to('placedOrder').execute()
  log("Alice's orders", aliceOrders)

  section('Traversal — Bob → placedOrder → orderItem → Products (multi-hop)')
  const bobProducts = await graph
    .node('Customer')
    .byId(refs['bob']!)
    .to('placedOrder')
    .to('orderItem')
    .execute()
  log("Bob's order products", bobProducts)

  section('Traversal — Reverse: Phones ← inCategory ← Products')
  const phonesProducts = await graph
    .node('Category')
    .byId(refs['phones']!)
    .from('inCategory')
    .execute()
  log('Products in Phones', phonesProducts)

  section('Compile — Inspect generated Cypher')
  const compiled = graph
    .node('Customer')
    .where('name', 'eq', 'Alice')
    .to('placedOrder')
    .where('status', 'eq', 'confirmed')
    .to('orderItem')
    .compile()
  log('Cypher', { cypher: compiled.cypher, params: compiled.params })

  // ── Mutations — Update ────────────────────────────────────────────────────

  section('Mutation — Update order status')
  const updated = await graph.mutate.update('Order', refs['order2']!, { status: 'confirmed' })
  log('Updated order2', updated)

  const verified = await graph.node('Order').byId(refs['order2']!).execute()
  log('Verified order2', verified)

  // ── Done ──────────────────────────────────────────────────────────────────

  section('Done')
  console.log('  All operations completed successfully.')
  console.log('  Refs:', refs)

  await graph.close()
  console.log('  Connection closed.\n')
}

main().catch((err) => {
  console.error('\nPlayground failed:', err)
  process.exit(1)
})
