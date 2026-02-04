/**
 * Graph Query Builder - Type-Safe Graph Query Builder for Cypher
 *
 * A fluent, type-safe API for building and executing graph queries and mutations.
 *
 * @example
 * ```typescript
 * import { defineSchema, node, edge, createGraph } from 'typegraph';
 * import { z } from 'zod';
 *
 * const schema = defineSchema({
 *   nodes: {
 *     user: node({ properties: { name: z.string(), email: z.string().email() } }),
 *     post: node({ properties: { title: z.string() } }),
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
 * const graph = createGraph(schema, {
 *   uri: 'bolt://localhost:7687',
 *   mutationExecutor: myAdapter,
 * });
 *
 * // QUERIES
 * const users = await graph.node('user').execute();
 * const ancestors = await graph.nodeById('post', 'post_123').ancestors().execute();
 *
 * // MUTATIONS
 * const user = await graph.mutate.create('user', { name: 'John', email: 'john@example.com' });
 * const post = await graph.mutate.createChild('post', parentId, { title: 'Hello' });
 * await graph.mutate.move(post.id, newParentId);
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// RE-EXPORT CORE (Schema, AST, Errors, Type Inference)
// For backward compatibility, all core exports are re-exported here
// =============================================================================

export * from '@astrale/typegraph-core'

// =============================================================================
// QUERY BUILDERS
// =============================================================================

export { createGraph, createGraphWithExecutors, GraphQuery } from './query'
export type { GraphConfig, ExecutorConfig, QueryExecutor } from './query/entry'
export { EdgeBuilder, EdgeWithEndpointsBuilder } from './query'
export type {
  SingleNodeBuilder,
  CollectionBuilder,
  OptionalNodeBuilder,
  PathBuilder,
  ReturningBuilder,
  GroupedBuilder,
  QueryFragment,
  EdgeFilterOptions,
  TraversalOptions,
  HierarchyTraversalOptions,
  ReachableOptions,
  WhereBuilder,
  EdgeWhereBuilder,
} from './query'

// =============================================================================
// MUTATIONS
// =============================================================================

export { GraphMutationsImpl, defaultIdGenerator, CypherTemplates } from './mutation'
export type {
  GraphMutations,
  MutationTransaction,
  MutationExecutor,
  TransactionRunner,
  MutationConfig,
  NodeInput,
  EdgeInput,
  NodeResult,
  EdgeResult,
  DeleteResult,
  MoveResult,
  SubtreeResult,
  DeleteSubtreeResult,
  CloneSubtreeResult,
  UpsertResult,
  CreateOptions,
  DeleteOptions,
  HierarchyOptions,
  CloneOptions,
  CloneSubtreeOptions,
  IdGenerator,
  // Template Provider (for custom implementations)
  MutationTemplateProvider,
  NodeTemplateProvider,
  EdgeTemplateProvider,
  HierarchyTemplateProvider,
  BatchTemplateProvider,
  TemplateUtils,
} from './mutation'

// Mutation errors
export {
  MutationError,
  NodeNotFoundError,
  EdgeExistsError,
  EdgeNotFoundError,
  CycleDetectedError,
  ParentNotFoundError,
  SourceNotFoundError,
  TransactionError,
  ValidationError,
} from './mutation'

// =============================================================================
// COMPILER
// =============================================================================

export { CypherCompiler, createCypherCompiler } from './compiler'
export type {
  CompiledQuery,
  CompilerOptions,
  QueryCompilerProvider,
  QueryCompilerFactory,
} from './compiler'

// =============================================================================
// EXECUTOR
// =============================================================================

export { Neo4jDriver, createNeo4jDriver } from './executor'
export type {
  ExecutionResult,
  ConnectionConfig,
  QueryMetadata,
  DatabaseDriverProvider,
  DatabaseDriverFactory,
  QueryResult,
  QuerySummary,
  ConnectionMetrics,
  DriverConfig,
  TransactionContext,
} from './executor'

// Note: Errors, AST, Schema, and Type Inference utilities are all re-exported
// from '@astrale/typegraph-core' above

// Export collect-related types
export type { CollectSpec, CollectSpecToReturnType } from './query'
