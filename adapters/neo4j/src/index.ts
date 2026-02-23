/**
 * Neo4j Adapter for TypeGraph
 *
 * @example
 * ```typescript
 * import { createGraph, defineSchema, string } from '@astrale/typegraph-client'
 * import { neo4j } from '@astrale/typegraph-adapter-neo4j'
 *
 * const schema = defineSchema({
 *   nodes: {
 *     user: { name: string() },
 *   },
 *   edges: {},
 * })
 *
 * const graph = await createGraph(schema, {
 *   adapter: neo4j({
 *     uri: 'bolt://localhost:7687',
 *     auth: { username: 'neo4j', password: 'password' }
 *   })
 * })
 *
 * const users = await graph.node('user').execute()
 * await graph.close()
 * ```
 */

import type { GraphAdapter } from '@astrale/typegraph-client'
import { Neo4jAdapter } from './adapter'

// Types
export type { Neo4jConfig } from './types'

// Classes
export { Neo4jAdapter }

// Utilities (for testing/advanced use)
export { validateConfig, connectionError } from './errors'
export { withRetry, DEFAULT_RETRY, type RetryOptions } from './retry'
export { transformRecord, transformValue } from './transform'

/**
 * Create a Neo4j adapter.
 *
 * @param config - Neo4j connection configuration
 * @returns A GraphAdapter for use with createGraph()
 *
 * @example
 * ```typescript
 * const graph = await createGraph(schema, {
 *   adapter: neo4j({
 *     uri: 'bolt://localhost:7687',
 *     auth: { username: 'neo4j', password: 'password' },
 *     retry: { maxAttempts: 5 }
 *   })
 * })
 * ```
 */
export function neo4j(config: ConstructorParameters<typeof Neo4jAdapter>[0]): GraphAdapter {
  return new Neo4jAdapter(config)
}
