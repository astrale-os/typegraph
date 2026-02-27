// Builders
export {
  iface,
  rawNodeDef,
  rawNodeDef as nodeDef,
  edgeDef,
  op,
  method,
  bitmask,
  ref,
  data,
  type RefSchema,
  type DataSelfSchema,
  type DataGrantSchema,
  type DataGrantToken,
} from './builders.js'

// Schema
export { defineSchema } from './schema.js'

// Def registry
export { registerDef, getDefName, getDefRegistration, hasDefName } from './registry.js'

// Serialization
export { serialize, type SerializeOptions } from './serialize.js'

// Data
export { node, edge, kernelRefs, defineCore, defineSeed } from './data.js'

// Types
export type {
  PropShape,
  DataShape,
  ParamShape,
  IndexDef,
  Cardinality,
  Access,
  EndpointCfg,
  IfaceConfig,
  NodeConfig,
  EdgeConfig,
  OpConfig,
  IfaceDef,
  NodeDef,
  EdgeDef,
  OpDef,
  BitmaskDef,
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
  Schema,
  MethodSelf,
  DefForKey,
  MethodKeys,
  InferOpParams,
  InferOpReturn,
  Ref,
  CoreInstance,
  CoreLink,
  RefsFromInstances,
  CoreDef,
  SeedDef,
} from './types.js'

export { SchemaValidationError } from './types.js'

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
