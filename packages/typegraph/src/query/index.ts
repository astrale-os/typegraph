/**
 * Query Module
 *
 * Fluent API for building type-safe graph queries.
 */

// Query interface and implementation
export type { GraphQuery, QueryExecutor } from './types'
export { GraphQueryImpl } from './impl'

// Builders
export { SingleNodeBuilder } from './single-node'
export { CollectionBuilder } from './collection'
export { OptionalNodeBuilder } from './optional-node'
export { PathBuilder } from './path'
export type { PathResult, PathNode, PathEdge } from './path'
export { GroupedBuilder } from './grouped'
export { EdgeBuilder, EdgeWithEndpointsBuilder } from './edge'
export { BaseBuilder } from './base'

// Types from base
export type { QueryFragment } from './base'

// Types from traits (shared options)
export type {
  EdgeFilterOptions,
  TraversalOptions,
  HierarchyTraversalOptions,
  ReachableOptions,
  WhereBuilder,
  EdgePropertyCondition,
} from './traits'

// Edge where builder
export type { EdgeWhereBuilder } from './edge'

// Selector interfaces
export type { SingleNodeSelector } from './single-node'
export type { CollectionSelector } from './collection'
export type { OptionalNodeSelector } from './optional-node'

// Validation
export { SchemaValidator, QueryValidationError, createValidator } from './validation'
export type { QueryValidationErrorCode } from './validation'

// Typed return helpers
export { collect, collectDistinct, isCollectMarker } from './collect'
export type { CollectMarker } from './collect'
export { TypedReturningBuilder } from './typed-returning'
