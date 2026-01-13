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
// SCHEMA
// =============================================================================

export { defineSchema, node, edge } from './schema'
export type {
  SchemaDefinition,
  AnySchema,
  NodeDefinition,
  EdgeDefinition,
  Cardinality,
  PropertyType,
  HierarchyConfig,
  HasHierarchy,
  HierarchyEdge,
  HierarchyDirection,
  ResolveHierarchyEdge,
} from './schema'

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

// =============================================================================
// ERRORS
// =============================================================================

export {
  GraphQueryError,
  SchemaValidationError,
  CardinalityError,
  NotFoundError,
  ConnectionError,
  CompilationError,
  ExecutionError,
  TimeoutError,
  AliasError,
} from './errors'

// =============================================================================
// TYPE INFERENCE UTILITIES
// =============================================================================

export type {
  NodeLabels,
  EdgeTypes,
  NodeProps,
  EdgeProps,
  OutgoingEdges,
  IncomingEdges,
  EdgeTarget,
  EdgeSource,
  EdgeOutboundCardinality,
  EdgeInboundCardinality,
  EdgeCardinality,
  EdgeTargetsFrom,
  EdgeSourcesTo,
  InferSchema,
  AliasMap,
  AliasMapToReturnType,
  EdgeAliasMap,
  EdgeAliasMapToReturnType,
  NormalizeEdgeEndpoint,
  MultiEdgeTargets,
  MultiEdgeSources,
  MultiEdgeBidirectional,
  CardinalityToBuilder,
} from './schema/inference'

// =============================================================================
// AST (for custom query engines and compilers)
// =============================================================================

export { QueryAST } from './ast'
export type {
  ASTNode,
  MatchStep,
  TraversalStep,
  WhereStep,
  BranchStep,
  PathStep,
  AggregateStep,
  OrderByStep,
  LimitStep,
  SkipStep,
  AliasStep,
  HierarchyStep,
  CursorStep,
  FirstStep,
  DistinctStep,
  ReachableStep,
  MatchByIdStep,
  ForkStep,
  Projection,
  ProjectionType,
  WhereCondition,
  ComparisonCondition,
  LogicalCondition,
  ExistsCondition,
  ConnectedToCondition,
  EdgeWhereCondition,
  ComparisonOperator,
  VariableLengthConfig,
} from './ast'

// Export collect-related types
export type { CollectSpec, CollectSpecToReturnType } from './query'
