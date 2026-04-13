// ── Builders (the authoring API) ───────────────────────────────────
export { nodeInterface } from './builders/definition/node-interface.js'
export { nodeClass } from './builders/definition/node-class.js'
export { edgeInterface } from './builders/definition/edge-interface.js'
export { edgeClass } from './builders/definition/edge-class.js'
export { fn } from './builders/function.js'
export { ref } from './builders/ref.js'
export { data } from './builders/data.js'
export { prop } from './builders/prop.js'
export { bitmask } from './builders/bitmask.js'
export { SELF } from './grammar/values/self.js'

// ── Schema (the compiler) ──────────────────────────────────────────
export { defineSchema } from './schema/define.js'
export type { Schema } from './schema/schema.js'
export { SchemaValidationError } from './schema/error.js'
export type { DefRef, MethodRef } from './schema/refs.js'

// ── Instance (core & seed) ─────────────────────────────────────────
export { defineCore } from './instance/core/define.js'
export { defineSeed } from './instance/seed/define.js'
export { buildCorePath, isCorePath } from './instance/core/path.js'
export type { CorePath } from './instance/core/path.js'
export { node } from './instance/core/node.js'
export { edge } from './instance/core/edge.js'

// ── Serializer ─────────────────────────────────────────────────────
export { serialize } from './serializer/serialize.js'

// ── Model types (public type-level API) ────────────────────────────
export type { DefConfigBase } from './grammar/definition/base.js'
export type { NodeInterfaceDef, NodeInterfaceConfig } from './grammar/definition/node-interface.js'
export type { NodeClassDef, NodeClassConfig } from './grammar/definition/node-class.js'
export type { EdgeInterfaceDef, EdgeInterfaceConfig } from './grammar/definition/edge-interface.js'
export type { EdgeClassDef, EdgeClassConfig } from './grammar/definition/edge-class.js'
export type {
  AnyDef,
  AnyNodeDef,
  AnyEdgeDef,
  AnyInterfaceDef,
  AnyClassDef,
} from './grammar/definition/discriminants.js'
export type { FnDef } from './grammar/function/def.js'
export type { FnConfig, ParamShape } from './grammar/function/config.js'
export type { AttributeShape, AttributeDef, Property } from './grammar/facets/attributes.js'
export type { ContentShape } from './grammar/facets/content.js'
export type { EndpointConfig, Cardinality } from './grammar/facets/endpoints.js'
export type { DefConstraints } from './grammar/facets/constraints.js'
export type { IndexDef, IndexType } from './grammar/facets/indexes.js'
export type { RefSchema } from './grammar/values/ref.js'
export type { DataSelfSchema, DataGrantSchema } from './grammar/values/data.js'
export type { SelfDef } from './grammar/values/self.js'
export type { BitmaskDef } from './grammar/values/bitmask.js'
export type { MethodInheritance } from './grammar/function/inheritance.js'
export type { OutputMode } from './grammar/function/output.js'

// ── Inference types (type-level utilities) ─────────────────────────
export type {
  ExtractAttributes,
  InferAttributes,
  ExtractFullAttributes,
  ExtractInherits,
  ExtractContent,
  ExtractFullContent,
  HasContent,
  ExtractMethods,
  AllMethods,
  HasMethods,
  ExtractMethodNames,
  ExtractMethodParams,
  ExtractMethodReturns,
  ExtractMethodReturnValue,
  MethodSelf,
  AllSealedKeys,
  InheritedAbstractKeys,
  InheritedDefaultKeys,
  ImplementableOwnKeys,
  HasImplementableMethods,
  ExtractNodeInput,
  FilterByKind,
  SchemaNodeInterfaces,
  SchemaNodeClasses,
  SchemaEdgeInterfaces,
  SchemaEdgeClasses,
  SchemaFnRefs,
} from './inference/index.js'

// ── Helpers (runtime introspection) ────────────────────────────────
export { resolveAllMethods, resolveAllAttributes } from './schema/resolve/index.js'
export { classifyDefs } from './schema/classify.js'
export {
  isNodeInterface,
  isNodeClass,
  isEdgeInterface,
  isEdgeClass,
} from './grammar/definition/discriminants.js'

// ── Instance types ─────────────────────────────────────────────────
export type {
  CoreNode,
  CoreEdge,
  PathTree,
  Core,
  CoreNodeEntry,
  CoreEdgeEntry,
} from './instance/core/types.js'
export type { SeedDef } from './instance/seed/types.js'

// ── Re-export IR types for convenience ─────────────────────────────
export type {
  SchemaIR,
  ClassDecl,
  NodeDecl,
  EdgeDecl,
  FunctionDecl,
  JsonSchema,
  PropertyDecl,
  Endpoint,
  EdgeConstraints,
} from '@astrale/typegraph-schema'
