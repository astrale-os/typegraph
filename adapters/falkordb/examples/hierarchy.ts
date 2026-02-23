/**
 * Hierarchy examples for FalkorDB adapter.
 *
 * Note: Hierarchy traversal methods (parent, ancestors, children, descendants)
 * return nodes with inferred types. Type assertions may be needed due to
 * TypeScript's limitations with complex conditional return types.
 */

import { defineSchema, node, edge, createGraph } from '@astrale/typegraph-client'
import { falkordb, clearGraph } from '../src/index'
import type { NodeProps } from '@astrale/typegraph-client'
import { z } from 'zod'

const schema = defineSchema({
  nodes: {
    folder: node({
      properties: {
        name: z.string(),
      },
    }),
  },
  edges: {
    hasParent: edge({
      from: 'folder',
      to: 'folder',
      cardinality: { outbound: 'optional', inbound: 'many' },
    }),
  },
  hierarchy: {
    defaultEdge: 'hasParent',
    direction: 'up',
  },
})

async function main() {
  const config = {
    host: 'localhost' as const,
    port: 6379,
    graphName: 'filesystem',
  }

  // Clear existing data
  await clearGraph(config)

  const graph = await createGraph(schema, { adapter: falkordb(config) })

  // Create hierarchy
  const root = await graph.mutate.create('folder', { name: 'root' })
  const docs = await graph.mutate.createChild('folder', root.id, { name: 'Documents' })
  const work = await graph.mutate.createChild('folder', docs.id, { name: 'Work' })
  await graph.mutate.createChild('folder', docs.id, { name: 'Personal' })

  console.log('Created folder hierarchy:')
  console.log('  root/')
  console.log('    Documents/')
  console.log('      Work/')
  console.log('      Personal/')

  // Navigate hierarchy - results are properly typed as folder nodes
  type FolderNode = NodeProps<typeof schema, 'folder'>

  const parent = await graph.nodeById(work.id).parent().execute()
  console.log('\nWork parent:', parent ? (parent as unknown as FolderNode).name : 'none') // "Documents"

  const ancestors = await graph.nodeById(work.id).ancestors().execute()
  console.log('Work ancestors:', ancestors.map((a) => (a as unknown as FolderNode).name)) // ["Documents", "root"]

  const children = await graph.nodeById(docs.id).children().execute()
  console.log('Docs children:', children.map((c) => (c as unknown as FolderNode).name)) // ["Work", "Personal"]

  const descendants = await graph.nodeById(root.id).descendants().execute()
  console.log('Root descendants:', descendants.length) // 3

  await graph.close()
}

main().catch(console.error)
