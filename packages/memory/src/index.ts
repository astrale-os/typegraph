/**
 * Typegraph In-Memory Adapter
 *
 * Zero-infrastructure in-memory graph database for typegraph.
 *
 * @example
 * ```typescript
 * import { defineSchema, node, edge } from 'typegraph';
 * import { createInMemoryGraph } from '@astrale/typegraph-memory';
 * import { z } from 'zod';
 *
 * const schema = defineSchema({
 *   nodes: {
 *     user: node({ properties: { name: z.string(), email: z.string() } }),
 *     post: node({ properties: { title: z.string(), content: z.string() } }),
 *   },
 *   edges: {
 *     authored: edge({
 *       from: 'user',
 *       to: 'post',
 *       cardinality: { outbound: 'many', inbound: 'one' },
 *     }),
 *     hasParent: edge({
 *       from: 'post',
 *       to: 'post',
 *       cardinality: { outbound: 'optional', inbound: 'many' },
 *     }),
 *   },
 *   hierarchy: { defaultEdge: 'hasParent', direction: 'up' },
 * });
 *
 * // Create in-memory graph - no database required!
 * const graph = createInMemoryGraph(schema);
 *
 * // Mutations work the same as with Neo4j
 * const user = await graph.mutate.create('user', { name: 'John', email: 'john@example.com' });
 * const post = await graph.mutate.create('post', { title: 'Hello', content: 'World' });
 * await graph.mutate.link('authored', user.id, post.id);
 *
 * // Queries work the same way
 * const users = await graph.node('user').execute();
 * const userById = await graph.nodeById('user', user.id).execute();
 *
 * // In-memory specific features
 * graph.clear(); // Clear all data
 * const data = graph.export(); // Export for serialization
 * graph.import(data); // Import from serialization
 * const stats = graph.stats(); // Get statistics
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// MAIN API
// =============================================================================

export { createInMemoryGraph } from "./graph"
export type { InMemoryGraph, InMemoryGraphConfig } from "./graph"

// =============================================================================
// STORE
// =============================================================================

export { GraphStore } from "./store"
export type { StoredNode, StoredEdge, TransactionSnapshot, IndexConfig, IndexEntry } from "./store"

// =============================================================================
// ENGINE
// =============================================================================

export { QueryEngine } from "./engine"
export type { QueryEngineConfig } from "./engine"

// =============================================================================
// DRIVER (for advanced use cases)
// =============================================================================

export { InMemoryDriver, createInMemoryDriver } from "./driver"

// =============================================================================
// TEMPLATES (for advanced use cases)
// =============================================================================

export { InMemoryTemplates, createInMemoryTemplates } from "./templates"
