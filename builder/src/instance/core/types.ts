// oxlint-disable typescript/no-explicit-any
import type { AnyNodeDef, AnyEdgeDef } from '../../grammar/definition/discriminants.js'
import type { Schema } from '../../schema/schema.js'
import type { CorePath } from './path.js'

/** A core node instance with its definition, data, and optional children */
export interface CoreNode<
  N extends AnyNodeDef = AnyNodeDef,
  C extends Record<string, CoreNode<any, any>> = Record<string, never>,
> {
  readonly type: 'core-node'
  readonly __nodeDef: N
  readonly __data: Record<string, unknown>
  readonly __children: C
}

/** An edge declaration between nodes or paths */
export interface CoreEdge {
  readonly type: 'core-edge'
  readonly __from: CoreNode | CorePath
  readonly __to: CoreNode | CorePath
  readonly __edgeDef: AnyEdgeDef
  readonly __data?: Record<string, unknown>
}

/** Recursively maps a tree of CoreNodes to a tree of CorePaths */
export type PathTree<Nodes extends Record<string, CoreNode<any, any>>> = {
  readonly [K in keyof Nodes & string]: Nodes[K] extends CoreNode<any, infer C>
    ? keyof C extends never
      ? CorePath
      : CorePath & PathTree<C>
    : never
}

/** Flat node entry in the resolved core */
export interface CoreNodeEntry {
  readonly path: CorePath
  readonly def: AnyNodeDef
  readonly data: Record<string, unknown>
  readonly parent?: CorePath
}

/** Flat edge entry in the resolved core */
export interface CoreEdgeEntry {
  readonly from: CorePath
  readonly edge: AnyEdgeDef
  readonly to: CorePath
  readonly data?: Record<string, unknown>
}

/** The output of defineCore() — also serves as the PathTree via intersection */
export interface Core<
  S extends Schema = Schema,
  _Paths extends Record<string, any> = Record<string, CorePath>,
> {
  readonly schema: S
  readonly domain: string
  readonly __nodes: readonly CoreNodeEntry[]
  readonly __edges: readonly CoreEdgeEntry[]
}
