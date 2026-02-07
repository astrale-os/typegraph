/**
 * Schema Module
 *
 * Provides schema definition utilities and type inference.
 * The schema is the single source of truth for all type information.
 */

export { node, edge, defineSchema, extendSchema, mergeNodeSchemas } from './builders'
export { resolveNodeLabels, formatLabels, getNodesSatisfying, toPascalCase } from './labels'
export type {
  SchemaDefinition,
  AnySchema,
  NodeDefinition,
  EdgeDefinition,
  PropertyType,
  Cardinality,
  IndexConfig,
  BaseIndexConfig,
  SinglePropertyIndex,
  CompositeIndex,
  HierarchyConfig,
  HasHierarchy,
  HierarchyEdge,
  HierarchyDirection,
  ResolveHierarchyEdge,
} from './types'
export { isCompositeIndex, isSinglePropertyIndex } from './types'

// Schema diffing
export { diffSchema } from './diff'
export type { SchemaDiff, SchemaChange } from './diff-types'

// Schema serialization
export { toSchema } from './serializer'
export type { SerializedSchema, SerializedNodeDef, SerializedEdgeDef } from './serializer'

// Index compiler utilities
export { compileSchemaIndexes, generateIndexMigration } from './index-compiler'
export type { IndexCompilerOptions, CompiledIndex, IndexMigration } from './index-compiler'
export type {
  NodeLabels,
  EdgeTypes,
  NodeProps,
  NodeInputProps,
  EdgeProps,
  EdgeInputProps,
  OutgoingEdges,
  IncomingEdges,
  EdgeTarget,
  EdgeSource,
  EdgeCardinality,
  InferSchema,
  Infer,
  AliasMap,
  AliasMapToReturnType,
  EdgeAliasMap,
  EdgeAliasMapToReturnType,
  NormalizeEdgeEndpoint,
  EdgeTargetsFrom,
  EdgeSourcesTo,
  HierarchyChildren,
  HierarchyParent,
  ResolveHierarchyEdgeType,
  MultiEdgeTargets,
  MultiEdgeSources,
  MultiEdgeBidirectional,
  AncestorResult,
  EdgeOutboundCardinality,
  EdgeInboundCardinality,
  CardinalityToBuilder,
  NodeProxy,
  OptionalNodeProxy,
  EdgeProxy,
  OptionalEdgeProxy,
  QueryContext,
  ResolveProxy,
  InferReturnType,
  TypedReturnQuery,
  ResolvedNodes,
} from './inference'
