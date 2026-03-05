export type { PropShape, DataShape, ParamShape, IndexDef, Cardinality, Access, DefType } from './common.js'
export type { OpConfig, OpDef } from './op.js'
export { op, method } from './op.js'
export type { DefConfig, Def, EndpointCfg, DefConstraints } from './def.js'
export { def, classDef, interfaceDef } from './def.js'
export type { RefSchema, DataSelfSchema, DataGrantSchema, DataGrantToken } from './ref.js'
export { ref, data } from './ref.js'

/** Union of all top-level def types. */
export type AnyDef = import('./def.js').Def<any>
