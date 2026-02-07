/**
 * Mutation examples for FalkorDB adapter.
 */

import { defineSchema, node, edge, createGraph } from '@astrale/typegraph'
import { falkordb, clearGraph } from '../src/index'
import { z } from 'zod'

const entityNode = node({
  properties: {
    id: z.string(),
  },
})

const schema = defineSchema({
  nodes: {
    entity: entityNode,
    product: node({
      properties: {
        name: z.string(),
        price: z.number(),
        stock: z.number(),
      },
      extends: [entityNode],
    }),
    category: node({
      properties: {
        name: z.string(),
      },
    }),
  },
  edges: {
    inCategory: edge({
      from: 'product',
      to: 'category',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },
})

async function main() {
  const config = {
    host: 'localhost' as const,
    port: 6379,
    graphName: 'shop',
  }

  // Clear existing data
  await clearGraph(config)

  const graph = await createGraph(schema, { adapter: falkordb(config) })

  // Batch create
  const products = await Promise.all([
    graph.mutate.create('product', { name: 'Laptop', price: 999, stock: 10 }),
    graph.mutate.create('product', { name: 'Mouse', price: 29, stock: 50 }),
    graph.mutate.create('product', { name: 'Keyboard', price: 79, stock: 30 }),
  ])

  console.log('Created products:', products.length)

  // Update
  const updated = await graph.mutate.update('product', products[0]!.id, {
    price: 899, // Price drop!
  })
  console.log('Updated product:', updated.data.name, '- new price:', updated.data.price)

  // Delete
  await graph.mutate.delete('product', products[2]!.id)
  console.log('Deleted keyboard')

  // Verify deletion
  const remainingProducts = await graph.node('product').execute()
  console.log('Remaining products:', remainingProducts.length)

  // Create category and link
  const electronics = await graph.mutate.create('category', { name: 'Electronics' })
  await graph.mutate.link('inCategory', products[0]!.id, electronics.id)
  await graph.mutate.link('inCategory', products[1]!.id, electronics.id)

  // Query products in category
  const electronicsProducts = await graph.nodeById(electronics.id).from('inCategory').execute()

  console.log('Electronics products:', electronicsProducts.length)

  await graph.close()
}

main().catch(console.error)
