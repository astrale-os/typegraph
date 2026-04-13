// oxlint-disable typescript/no-explicit-any
import type { EdgeClassDef } from './edge-class.js'
import type { EdgeInterfaceDef } from './edge-interface.js'
import type { NodeClassDef } from './node-class.js'
import type { NodeInterfaceDef } from './node-interface.js'

/** The 4 definition kinds as a const enum */
export const Kind = {
  NodeInterface: 'node-interface',
  NodeClass: 'node-class',
  EdgeInterface: 'edge-interface',
  EdgeClass: 'edge-class',
} as const

export type Kind = (typeof Kind)[keyof typeof Kind]

/** Any definition — discriminated union of all 4 roles */
export type AnyDef =
  | NodeInterfaceDef<any>
  | NodeClassDef<any>
  | EdgeInterfaceDef<any, any>
  | EdgeClassDef<any, any>

/** Any node definition (interface or class) */
export type AnyNodeDef = NodeInterfaceDef<any> | NodeClassDef<any>

/** Any edge definition (interface or class) */
export type AnyEdgeDef = EdgeInterfaceDef<any, any> | EdgeClassDef<any, any>

/** Any interface (node or edge) */
export type AnyInterfaceDef = NodeInterfaceDef<any> | EdgeInterfaceDef<any, any>

/** Any class (node or edge) */
export type AnyClassDef = NodeClassDef<any> | EdgeClassDef<any, any>

// ── Type guards ──────────────────────────────────────────────────

export function isNodeInterface(def: AnyDef): def is NodeInterfaceDef {
  return def.__kind === Kind.NodeInterface
}

export function isNodeClass(def: AnyDef): def is NodeClassDef {
  return def.__kind === Kind.NodeClass
}

export function isEdgeInterface(def: AnyDef): def is EdgeInterfaceDef {
  return def.__kind === Kind.EdgeInterface
}

export function isEdgeClass(def: AnyDef): def is EdgeClassDef {
  return def.__kind === Kind.EdgeClass
}

export function isAbstract(def: AnyDef): def is AnyInterfaceDef {
  return def.__kind === Kind.NodeInterface || def.__kind === Kind.EdgeInterface
}

export function isConcrete(def: AnyDef): def is AnyClassDef {
  return def.__kind === Kind.NodeClass || def.__kind === Kind.EdgeClass
}

export function isEdge(def: AnyDef): def is AnyEdgeDef {
  return def.__kind === Kind.EdgeInterface || def.__kind === Kind.EdgeClass
}

export function isNode(def: AnyDef): def is AnyNodeDef {
  return def.__kind === Kind.NodeInterface || def.__kind === Kind.NodeClass
}
