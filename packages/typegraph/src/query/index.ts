/**
 * Query Module
 *
 * Fluent API for building type-safe graph queries.
 */

// Entry point
export { GraphQuery, createGraph, createGraphWithExecutors } from "./entry"

// Builders
export { SingleNodeBuilder } from "./single-node"
export { CollectionBuilder } from "./collection"
export { OptionalNodeBuilder } from "./optional-node"
export { PathBuilder } from "./path"
export { ReturningBuilder } from "./returning"
export type { CollectSpec, CollectSpecToReturnType } from "./returning"
export { GroupedBuilder } from "./grouped"
export { EdgeBuilder, EdgeWithEndpointsBuilder } from "./edge"
export { BaseBuilder } from "./base"

// Types from base
export type { QueryFragment } from "./base"

// Types from traits (shared options)
export type {
  EdgeFilterOptions,
  TraversalOptions,
  HierarchyTraversalOptions,
  ReachableOptions,
  WhereBuilder,
  EdgePropertyCondition,
} from "./traits"

// Edge where builder
export type { EdgeWhereBuilder } from "./edge"

// Selector interfaces
export type { SingleNodeSelector } from "./single-node"
export type { CollectionSelector } from "./collection"
export type { OptionalNodeSelector } from "./optional-node"

// Validation
export { SchemaValidator, QueryValidationError, createValidator } from "./validation"
export type { QueryValidationErrorCode } from "./validation"

// Config types
export type {
  GraphConfig,
  ExecutorConfig,
  RawQueryExecutor,
  QueryCompilerConfig,
  QueryExecutor,
} from "./entry"
