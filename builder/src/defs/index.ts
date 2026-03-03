export type { PropShape, DataShape, ParamShape, IndexDef, Cardinality, Access, DefType } from './common.js'
export type { OpConfig, OpDef } from './op.js'
export { op, method } from './op.js'
export type { IfaceConfig, IfaceDef } from './iface.js'
export { iface } from './iface.js'
export type { NodeConfig, NodeDef } from './node.js'
export { rawNodeDef } from './node.js'
export type { EndpointCfg, EdgeConfig, EdgeDef } from './edge.js'
export { edgeDef } from './edge.js'
export type { RefSchema, DataSelfSchema, DataGrantSchema, DataGrantToken } from './ref.js'
export { ref, data } from './ref.js'

/** Union of all top-level def types. */
export type AnyDef =
  | import('./iface.js').IfaceDef<any>
  | import('./node.js').NodeDef<any>
  | import('./edge.js').EdgeDef<any>
