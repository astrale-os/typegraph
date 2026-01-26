/**
 * Schema Module
 *
 * Provides schema definition utilities and type inference.
 * The schema is the single source of truth for all type information.
 */

export { node, edge, defineSchema } from './builders'
export { resolveNodeLabels, formatLabels, DEFAULT_BASE_LABELS } from './labels'
export type {
  SchemaDefinition,
  AnySchema,
  NodeDefinition,
  EdgeDefinition,
  PropertyType,
  Cardinality,
  IndexConfig,
  HierarchyConfig,
  LabelConfig,
  HasHierarchy,
  HierarchyEdge,
  HierarchyDirection,
  ResolveHierarchyEdge,
} from './types'
export type {
  NodeLabels,
  EdgeTypes,
  NodeProps,
  EdgeProps,
  OutgoingEdges,
  IncomingEdges,
  EdgeTarget,
  EdgeSource,
  EdgeCardinality,
  InferSchema,
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
} from './inference'
