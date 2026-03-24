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
export { transformResults, convertValue, isFalkorNode, isFalkorRelationship } from './transform'

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
 * Delete a graph from the FalkorDB instance.
 *
 * @example
 * ```typescript
 * await deleteGraph({ graphName: 'old-graph', host: 'localhost' })
 * ```
 */
export async function deleteGraph(config: FalkorDBConfig): Promise<void> {
  // Validate graphName to prevent injection (defense-in-depth, also validated in connect())
  validateGraphName(config.graphName)

  const adapter = new FalkorDBAdapter(config)
  try {
    await adapter.connect()
    await adapter.mutate(`CALL dbms.graph.delete('${config.graphName}')`)
  } finally {
    await adapter.close()
  }
}
