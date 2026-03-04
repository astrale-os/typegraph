// Builders
export {
  iface,
  rawNodeDef,
  rawNodeDef as nodeDef,
  edgeDef,
  op,
  method,
  ref,
  data,
  type RefSchema,
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
export { collectAllMethodDefs, collectAllMethodNames } from './helpers/methods.js'
export { collectAvailableProps } from './helpers/props.js'

// Core
export { node, edge, kernelRefs, defineCore } from './core/index.js'

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
  IfaceConfig,
  NodeConfig,
  EdgeConfig,
  OpConfig,
  IfaceDef,
  NodeDef,
  EdgeDef,
  OpDef,
  EndpointCfg,
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
} from './inference/index.js'

export type { Schema, Named } from './schema/schema.js'
export { SchemaValidationError } from './schema/schema.js'
export type {
  DefForKey,
  MethodKeys,
  InferOpParams,
  InferOpReturn,
  SchemaRefs,
  SchemaClassRefs,
  SchemaOpRefs,
  SchemaRefsMap,
} from './schema/refs.js'

export type {
  Ref,
  CoreInstance,
  CoreLink,
  RefsFromInstances,
  CoreDef,
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
