/**
 * FalkorDB adapter for TypeGraph.
 *
 * @example
 * ```typescript
 * import { defineSchema, node } from '@astrale/typegraph'
 * import { createFalkorDBGraph } from '@astrale/typegraph-adapter-falkordb'
 * import { z } from 'zod'
 *
 * const schema = defineSchema({
 *   nodes: {
 *     user: node({ properties: { name: z.string() } }),
 *   },
 *   edges: {},
 * })
 *
 * const { graph, close } = await createFalkorDBGraph(schema, {
 *   graphName: 'my-graph'
 * })
 *
 * const user = await graph.mutate.create('user', { name: 'Alice' })
 * await close()
 * ```
 */

import { createGraphWithExecutors, type GraphQuery, type IdGenerator } from '@astrale/typegraph'
import type { AnySchema } from '@astrale/typegraph'
import { createFalkorDBDriver } from './driver'
import { createQueryExecutor, createMutationExecutor } from './executors'
import type { FalkorDBConfig, FalkorDBDriver } from './types'

// Re-export types
export type { FalkorDBConfig, FalkorDBDriver, FalkorNode, FalkorRelationship } from './types'
export type { QueryExecutor, MutationExecutor, TransactionRunner } from './executors'

/**
 * FalkorDB graph instance with type-safe query/mutation API.
 */
export interface FalkorDBGraphInstance<S extends AnySchema> {
  /** Type-safe graph query API */
  graph: GraphQuery<S>
  /** Close the database connection */
  close: () => Promise<void>
  /** Verify connection is alive */
  verifyConnection: () => Promise<boolean>
  /** Health check with latency measurement */
  healthCheck: () => Promise<{ healthy: boolean; latencyMs: number; version?: string }>
  /** Get connection statistics */
  getStats: () => { queriesExecuted: number; totalLatencyMs: number; avgLatencyMs: number }
  /** Raw FalkorDB driver */
  driver: FalkorDBDriver
}

/**
 * Create a FalkorDB graph with full TypeScript type inference.
 *
 * @param schema - TypeGraph schema definition
 * @param config - FalkorDB connection configuration
 * @param options - Optional ID generator and other settings
 * @returns Graph instance with type-safe query/mutation API
 *
 * @example Basic usage
 * ```typescript
 * const { graph, close } = await createFalkorDBGraph(schema, {
 *   graphName: 'my-graph'
 * })
 *
 * const users = await graph.node('user').execute()
 * await close()
 * ```
 *
 * @example With custom ID generator
 * ```typescript
 * import { nanoid } from 'nanoid'
 *
 * const { graph } = await createFalkorDBGraph(schema, config, {
 *   idGenerator: () => nanoid()
 * })
 * ```
 *
 * @throws {Error} If connection fails or config is invalid
 */
export async function createFalkorDBGraph<S extends AnySchema>(
  schema: S,
  config: FalkorDBConfig,
  options?: {
    idGenerator?: IdGenerator
  }
): Promise<FalkorDBGraphInstance<S>> {
  // Create driver with connection pooling
  const driver = await createFalkorDBDriver(config)

  // Create executors
  const queryExecutor = createQueryExecutor(driver.graph)
  const mutationExecutor = createMutationExecutor(driver.graph)

  // Create graph instance
  const graph = createGraphWithExecutors(schema, {
    queryExecutor,
    mutationExecutor,
    idGenerator: options?.idGenerator,
  })

  return {
    graph,
    close: () => driver.close(),
    verifyConnection: () => driver.verifyConnection(),
    healthCheck: () => driver.healthCheck(),
    getStats: () => driver.getStats(),
    driver,
  }
}

/**
 * Clear all data from a graph (useful for testing).
 *
 * @example
 * ```typescript
 * await clearGraph({ graphName: 'test-graph', host: 'localhost', port: 6380 })
 * ```
 */
export async function clearGraph(config: FalkorDBConfig): Promise<void> {
  const driver = await createFalkorDBDriver(config)
  try {
    await driver.graph.query('MATCH (n) DETACH DELETE n')
  } finally {
    await driver.close()
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

  const driver = await createFalkorDBDriver(tempConfig)
  try {
    const graphs = await driver.client.list()
    return graphs
  } finally {
    await driver.close()
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
  const driver = await createFalkorDBDriver(config)
  try {
    await driver.graph.query(`CALL dbms.graph.delete('${config.graphName}')`)
  } finally {
    await driver.close()
  }
}
