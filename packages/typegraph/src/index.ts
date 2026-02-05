/**
 * TypeGraph - Type-Safe Graph Query Builder for Cypher
 *
 * A fluent, type-safe API for building and executing graph queries and mutations.
 *
 * @example
 * ```typescript
 * import { createGraph, defineSchema, string } from '@astrale/typegraph'
 * import { neo4j } from '@astrale/typegraph-adapter-neo4j'
 *
 * const schema = defineSchema({
 *   nodes: {
 *     user: { name: string(), email: string() },
 *     post: { title: string() },
 *   },
 *   edges: {
 *     authored: { from: 'user', to: 'post' },
 *   },
 * })
 *
 * const graph = await createGraph(schema, {
 *   adapter: neo4j({ uri: 'bolt://localhost:7687', auth: { ... } })
 * })
 *
 * // Query
 * const users = await graph.node('user').execute()
 *
 * // Mutate
 * const user = await graph.mutate.create('user', { name: 'John', email: 'john@example.com' })
 *
 * // Transaction
 * await graph.transaction(async (tx) => {
 *   const post = await tx.mutate.create('post', { title: 'Hello' })
 *   await tx.mutate.link('authored', user.id, post.id)
 * })
 *
 * await graph.close()
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// RE-EXPORT CORE (Schema, AST, Errors, Type Inference)
// =============================================================================

export * from '@astrale/typegraph-core'

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export { createGraph } from './graph'
export type { Graph, GraphOptions, TransactionScope } from './graph'

import type { AnySchema } from '@astrale/typegraph-core'
import type { GraphQuery } from './query'
import { GraphQueryImpl } from './query'

/**
 * Create a query builder for compile-only usage (no database connection).
 * Use this for testing query compilation without an adapter.
 *
 * @example
 * ```typescript
 * const query = createQueryBuilder(schema)
 * const compiled = query.node('user').where('status', 'eq', 'active').compile()
 * ```
 */
export function createQueryBuilder<S extends AnySchema>(schema: S): GraphQuery<S> {
  return new GraphQueryImpl(schema, null)
}

// =============================================================================
// ADAPTER INTERFACE
// =============================================================================

export type { GraphAdapter, TransactionContext, AdapterMetrics } from './adapter'

// =============================================================================
// QUERY
// =============================================================================

// Query interface and implementation (for advanced use)
export type { GraphQuery, QueryExecutor } from './query'
export { GraphQueryImpl, EdgeBuilder, EdgeWithEndpointsBuilder, PathBuilder } from './query'

// Query builder types
export type {
  NodeQueryBuilder,
  SingleNodeBuilder,
  CollectionBuilder,
  OptionalNodeBuilder,
  GroupedBuilder,
  QueryFragment,
  EdgeFilterOptions,
  TraversalOptions,
  HierarchyTraversalOptions,
  ReachableOptions,
  WhereBuilder,
  EdgeWhereBuilder,
  CollectMarker,
  PathResult,
  PathNode,
  PathEdge,
} from './query'
export { collect, collectDistinct, isCollectMarker, TypedReturningBuilder } from './query'

// =============================================================================
// MUTATIONS
// =============================================================================

export { GraphMutationsImpl, defaultIdGenerator, CypherTemplates } from './mutation'
export type {
  GraphMutations,
  MutationTransaction,
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
