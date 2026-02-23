/**
 * TypeGraph - Type-Safe Graph Query Builder for Cypher
 *
 * Fluent, type-safe API for graph queries and mutations over Cypher databases.
 * Schema is defined in KRL, compiled to IR, and codegen produces TypeScript types.
 *
 * @example
 * ```typescript
 * import { createGraph } from '@astrale/typegraph-client'
 * import { schema } from './generated/schema'
 * import { neo4j } from '@astrale/typegraph-adapter-neo4j'
 *
 * const graph = await createGraph(schema, {
 *   adapter: neo4j({ uri: 'bolt://localhost:7687' })
 * })
 *
 * const users = await graph.node('User').execute()
 * const user = await graph.mutate.create('User', { username: 'alice', email: 'alice@example.com' })
 *
 * await graph.close()
 * ```
 *
 * @packageDocumentation
 */

// =============================================================================
// SCHEMA & TYPE SYSTEM
// =============================================================================

export type {
  SchemaShape,
  SchemaNodeDef,
  SchemaEdgeDef,
  SchemaEndpointDef,
  SchemaConstraints,
  SchemaMethodDef,
  TypeMap,
  UntypedMap,
  Cardinality,
  ClassRefs,
} from './schema'

// Branded ID types and constructors
export { NodeId, ClassId, InterfaceId } from './schema'

export type { ResolveNode, ResolveEdge, ResolveNodeInput, ResolveEdgeInput } from './resolve'

export type {
  NodeLabels,
  EdgeTypes,
  NodeProps,
  EdgeProps,
  OutgoingEdges,
  IncomingEdges,
  ConnectedEdges,
  EdgeTargetsFrom,
  EdgeSourcesTo,
  EdgeTarget,
  EdgeSource,
  EdgeOutboundCardinality,
  EdgeInboundCardinality,
  MultiEdgeTargets,
  MultiEdgeSources,
  MultiEdgeBidirectional,
  AliasMap,
  EdgeAliasMap,
  AliasMapToReturnType,
  EdgeAliasMapToReturnType,
  CardinalityToBuilder,
  HierarchyChildren,
  HierarchyParent,
  AncestorResult,
  NodeProxy,
  OptionalNodeProxy,
  EdgeProxy,
  OptionalEdgeProxy,
  QueryContext,
  InferReturnType,
  TypedReturnQuery,
} from './inference'

// =============================================================================
// AST
// =============================================================================

export { QueryAST, createDefaultProjection, createEdgeProjection, ASTVisitor } from './query/ast'
export type {
  ASTNode,
  MatchStep,
  MatchByIdStep,
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
  DistinctStep,
  ReachableStep,
  ForkStep,
  Projection,
  ProjectionType,
  WhereCondition,
  ComparisonCondition,
  LogicalCondition,
  LabelCondition,
  EdgeWhereCondition,
  ComparisonOperator,
  VariableLengthConfig,
  // v2 types
  PatternStep,
  SubqueryStep,
  SubqueryCondition,
  UnwindStep,
  ReturnStep,
  ProjectionExpression,
  AliasComparisonCondition,
} from './query/ast'

// =============================================================================
// ERRORS
// =============================================================================

export {
  GraphQueryError,
  CardinalityError,
  ExecutionError,
  MethodNotDispatchedError,
} from './errors'

// =============================================================================
// HELPERS
// =============================================================================

export {
  resolveNodeLabels,
  formatLabels,
  toPascalCase,
  getNodesSatisfying,
  isReified,
} from './helpers'

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export { createGraph } from './graph'
export type { Graph, GraphOptions, TransactionScope } from './graph'

import type { SchemaShape } from './schema'
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
export function createQueryBuilder<S extends SchemaShape>(schema: S): GraphQuery<S> {
  return new GraphQueryImpl<S>(schema, null)
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
export { collect, collectDistinct, isCollectMarker, TypedReturningBuilder, MatchBuilder, buildMatchAST } from './query'
export type { MatchConfig, MatchNodeConfig, MatchEdgeConfig } from './query'

// =============================================================================
// MUTATIONS
// =============================================================================

export {
  GraphMutationsImpl,
  defaultIdGenerator,
  MutationCypherCompiler,
  MutationCompilationPipeline,
  createNode,
  updateNode,
  deleteNode,
  upsertNode,
  cloneNode,
  createEdge,
  updateEdge,
  updateEdgeById,
  deleteEdge,
  deleteEdgeById,
  moveNode,
  deleteSubtree,
  batchCreate,
  batchUpdate,
  batchDelete,
  batchLink,
  batchUnlink,
  unlinkAllFrom,
  unlinkAllTo,
} from './mutation'
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
  ValidatorMap,
  ZodLike,
  ValidationOptions,
  MutationOp,
  InlineLink,
  CompiledMutation,
  MutationCompilationPass,
  CreateNodeOp,
  UpdateNodeOp,
  DeleteNodeOp,
  UpsertNodeOp,
  CloneNodeOp,
  CreateEdgeOp,
  UpdateEdgeOp,
  UpdateEdgeByIdOp,
  DeleteEdgeOp,
  DeleteEdgeByIdOp,
  MoveNodeOp,
  DeleteSubtreeOp,
  BatchCreateOp,
  BatchUpdateOp,
  BatchDeleteOp,
  BatchLinkOp,
  BatchUnlinkOp,
  UnlinkAllFromOp,
  UnlinkAllToOp,
  BatchCreateLinkNodeOp,
  BatchDeleteLinkNodeOp,
  UpdateLinkNodeOp,
  DeleteLinkNodeOp,
  DeleteLinkNodesFromOp,
  DeleteLinkNodesToOp,
} from './mutation'

// Mutation Passes
export { InstanceOfMutationPass } from './mutation/passes'
export { ReifyEdgesMutationPass } from './mutation/passes'

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

export {
  CypherCompiler,
  createCypherCompiler,
  InstanceModelPass,
  ReifyEdgesPass,
} from './query/compiler'
export type {
  CompiledQuery,
  CompilerOptions,
  QueryCompilerProvider,
  QueryCompilerFactory,
} from './query/compiler'

// =============================================================================
// METHOD SYSTEM
// =============================================================================

export type { MethodDispatchFn, OperationSelf, MethodSchemaInfo } from './methods'
export { collectMethodNames } from './methods'

// =============================================================================
// CORE INSTALLATION
// =============================================================================

export { installCore } from './core'
export { createCoreProxy } from './core-proxy'
export type {
  CoreNodeDef,
  CoreEdgeDef,
  CoreDefinition,
  InstallCoreOptions,
  InstallCoreResult,
  CoreRefs,
} from './core'

// =============================================================================
// ENRICHMENT
// =============================================================================

export { enrichNode, enrichEdge } from './enrichment'

// =============================================================================
// CONSTRAINTS
// =============================================================================

export type { ConstraintSchemaInfo, ConstraintEdgeDef, ResolvedEndpoints } from './constraints'
export { enforceConstraints, resolveEndpoints, ConstraintViolation } from './constraints'
