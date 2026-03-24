/**
 * FalkorDB Adapter for TypeGraph
 *
 * @example
 * ```typescript
 * import { createGraph, defineSchema, string } from '@astrale/typegraph-client'
 * import { falkordb } from '@astrale/typegraph-adapter-falkordb'
 *
 * const schema = defineSchema({
 *   nodes: {
 *     user: { name: string() },
 *   },
 *   edges: {},
 * })
 *
 * const graph = await createGraph(schema, {
 *   adapter: falkordb({ graphName: 'my-graph' })
 * })
 *
 * const users = await graph.node('user').execute()
 * await graph.close()
 * ```
 */

import type { GraphAdapter } from '@astrale/typegraph-client'

import type { FalkorDBConfig } from './types'

import { FalkorDBAdapter } from './adapter'
import { validateGraphName } from './errors'

// Re-export types
export type { FalkorDBConfig, FalkorNode, FalkorRelationship } from './types'
export { FalkorDBAdapter }

// Re-export transform utilities (useful for custom adapters)
export {
  transformResults,
  convertValue,
  serializeProperties,
  isFalkorNode,
  isFalkorRelationship,
} from './transform'

/**
 * Create a FalkorDB adapter.
 *
 * @param config - FalkorDB connection configuration
 * @returns A GraphAdapter for use with createGraph()
 *
 * @example
 * ```typescript
 * const graph = await createGraph(schema, {
 *   adapter: falkordb({ graphName: 'my-graph' })
 * })
 * ```
 */
export function falkordb(config: FalkorDBConfig): GraphAdapter {
  return new FalkorDBAdapter(config)
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Clear all data from a graph (useful for testing).
 *
 * @example
 * ```typescript
 * await clearGraph({ graphName: 'test-graph', host: 'localhost', port: 6380 })
 * ```
 */
export async function clearGraph(config: FalkorDBConfig): Promise<void> {
  const adapter = new FalkorDBAdapter(config)
  try {
    await adapter.connect()
    await adapter.mutate('MATCH (n) DETACH DELETE n')
  } finally {
    await adapter.close()
  }
}

/**
 * List all graphs in the FalkorDB instance.
 *
 * @example
 * ```typescript
 * const graphs = await listGraphs({ graphName: 'dummy', host: 'localhost' })
 * console.log('Available graphs:', graphs)
 * ```
 */
export async function listGraphs(config: Partial<FalkorDBConfig>): Promise<string[]> {
  const tempConfig: FalkorDBConfig = {
    graphName: 'temp',
    host: config.host ?? 'localhost',
    port: config.port ?? 6379,
  }

  const adapter = new FalkorDBAdapter(tempConfig)
  try {
    await adapter.connect()
    const client = adapter.rawClient
    if (!client) throw new Error('Not connected')
    const graphs = await client.list()
    return graphs
  } finally {
    await adapter.close()
  }
}

/**
 * Delete a graph (`GRAPH.DELETE` via the falkordb client — not `CALL dbms.graph.delete`, which some servers omit).
 *
 * @example
 * ```typescript
 * await deleteGraph({ graphName: 'old-graph', host: 'localhost' })
 * ```
 */
export async function deleteGraph(config: FalkorDBConfig): Promise<void> {
  validateGraphName(config.graphName)

  const adapter = new FalkorDBAdapter(config)
  try {
    await adapter.connect()
    const graph = adapter.rawGraph
    if (!graph) throw new Error('Not connected')
    await graph.delete()
  } finally {
    await adapter.close()
  }
}
