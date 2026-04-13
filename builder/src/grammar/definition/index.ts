export type { DefConfigBase } from './base.js'

export type { NodeInterfaceDef, NodeInterfaceConfig } from './node-interface.js'
export type { NodeClassDef, NodeClassConfig } from './node-class.js'
export type { EdgeInterfaceDef, EdgeInterfaceConfig } from './edge-interface.js'
export type { EdgeClassDef, EdgeClassConfig } from './edge-class.js'

export type {
  AnyDef,
  AnyNodeDef,
  AnyEdgeDef,
  AnyInterfaceDef,
  AnyClassDef,
  Kind,
} from './discriminants.js'
export {
  Kind as KindEnum,
  isNodeInterface,
  isNodeClass,
  isEdgeInterface,
  isEdgeClass,
  isAbstract,
  isConcrete,
  isEdge,
  isNode,
} from './discriminants.js'
