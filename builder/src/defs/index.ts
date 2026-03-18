export type { Property, PropShape } from './property.js'
export type { DataShape } from './data.js'
export type { IndexDef } from './indexing.js'
export type { DefConstraints } from './constraints.js'
export type { Cardinality, EndpointCfg } from './endpoint.js'
export type { Access, ParamShape, OpConfig, OpDef } from './operation.js'
export { op, method } from './operation.js'
export type { DefType, DefConfig, Def, InterfaceConfig } from './definition.js'
export { def, classDef, interfaceDef } from './definition.js'
export type { RefSchema, SelfDef } from './ref.js'
export { ref, SELF } from './ref.js'
export type { DataSelfSchema, DataGrantSchema, DataGrantToken } from './data.js'
export { data } from './data.js'

/** Union of all top-level def types. */
export type AnyDef = import('./definition.js').Def<any>
