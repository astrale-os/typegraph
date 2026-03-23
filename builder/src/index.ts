// Builders
export {
  def,
  classDef,
  interfaceDef,
  op,
  method,
  ref,
  SELF,
  data,
  type RefSchema,
  type SelfDef,
  type DataSelfSchema,
  type DataGrantSchema,
  type DataGrantToken,
} from './defs/index.js'

// Schema
export { defineSchema } from './schema/define.js'

// Def registry
export { registerDef, getDefName, getDefRegistration, hasDefName } from './registry.js'

// Serialization
export { serialize, type SerializeOptions } from './serializer/index.js'

// Refs
export { schemaRefs } from './schema/refs.js'

// Helpers
export {
  collectAllMethodDefs,
  collectAllMethodNames,
  resolveAllMethods,
  type ResolvedMethod,
} from './helpers/methods.js'
export { collectAvailableProps } from './helpers/props.js'

// Core
export {
  node,
  edge,
  kernelRefs,
  defineCore,
  CorePath,
  buildCorePath,
  isCorePath,
} from './core/index.js'

// Seed
export { defineSeed } from './seed/index.js'

// Types
export type {
  PropShape,
  DataShape,
  ParamShape,
  IndexDef,
  Cardinality,
  Access,
  DefType,
  DefConfig,
  Def,
  EndpointCfg,
  DefConstraints,
  OpConfig,
  ConcreteOpConfig,
  OpDef,
  MethodInheritance,
  AnyDef,
} from './defs/index.js'

export type {
  ExtractProps,
  ExtractData,
  ExtractMethods,
  AllMethods,
  ExtractFullProps,
  ExtractFullData,
  HasData,
  InferProps,
  HasMethods,
  ExtractMethodNames,
  ExtractMethodParams,
  ExtractMethodReturns,
  ExtractMethodReturnValue,
  IsStaticMethod,
  MethodSelf,
  ExtractNodeInput,
  ExtractMethodInheritance,
  AllSealedKeys,
  InheritedAbstractKeys,
  InheritedDefaultKeys,
  AllParentDefaultKeys,
  HasImplementableMethods,
  ImplementableOwnKeys,
} from './inference/index.js'

export type { Schema, Named } from './schema/schema.js'
export { SchemaValidationError } from './schema/schema.js'
export type {
  DefForKey,
  MethodKeys,
  InterfaceMethodKeys,
  InferOpParams,
  InferOpReturn,
  SchemaRefs,
  SchemaClassRefs,
  SchemaOpRefs,
  SchemaRefsMap,
} from './schema/refs.js'

export type {
  CoreNode,
  CoreEdge,
  PathTree,
  CoreDef,
  CoreNodeEntry,
  CoreEdgeEntry,
} from './core/index.js'

export type { SeedDef } from './seed/index.js'

// Re-export IR types for convenience
export type {
  SchemaIR,
  ClassDecl,
  NodeDecl,
  EdgeDecl,
  OperationDecl,
  JsonSchema,
  Endpoint,
  EdgeConstraints,
} from '@astrale/typegraph-schema'
