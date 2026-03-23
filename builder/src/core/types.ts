import type { Def } from '../defs/definition.js'
import type { Schema } from '../schema/schema.js'
import type { CorePath } from './path.js'

// ── Node ─────────────────────────────────────────────────────────────────────

/** A core node instance with its definition, data, and optional children. */
export interface CoreNode<
  N extends Def = Def,
  // oxlint-disable-next-line no-explicit-any
  C extends Record<string, CoreNode<any, any>> = Record<string, never>,
> {
  readonly type: 'core-node'
  readonly __nodeDef: N
  readonly __data: Record<string, unknown>
  readonly __children: C
}

// ── Edge ─────────────────────────────────────────────────────────────────────

/** An edge declaration between nodes or paths. */
export interface CoreEdge {
  readonly type: 'core-edge'
  readonly __from: CoreNode | CorePath
  readonly __to: CoreNode | CorePath
  readonly __edge: string
  readonly __data?: Record<string, unknown>
}

// ── Path tree ────────────────────────────────────────────────────────────────

/** Recursively maps a tree of CoreNodes to a tree of CorePaths. */
// oxlint-disable-next-line no-explicit-any
export type PathTree<Nodes extends Record<string, CoreNode<any, any>>> = {
  // oxlint-disable-next-line no-explicit-any
  readonly [K in keyof Nodes & string]: Nodes[K] extends CoreNode<any, infer C>
    ? keyof C extends never
      ? CorePath // Leaf node
      : CorePath & PathTree<C> // Parent node: path + typed children
    : never
}

// ── CoreDef ──────────────────────────────────────────────────────────────────

/** Flat node entry in the __nodes list. */
export interface CoreNodeEntry {
  readonly path: CorePath
  readonly def: Def
  readonly data: Record<string, unknown>
  readonly parent?: CorePath
}

/** Flat edge entry in the __edges list. */
export interface CoreEdgeEntry {
  readonly from: CorePath
  readonly edge: string
  readonly to: CorePath
  readonly data?: Record<string, unknown>
}

/** The output of defineCore(). Also serves as the PathTree via intersection. */
export interface CoreDef<
  S extends Schema = Schema,
  // oxlint-disable-next-line no-explicit-any
  _Paths extends Record<string, any> = Record<string, CorePath>,
> {
  readonly schema: S
  readonly domain: string
  readonly __nodes: readonly CoreNodeEntry[]
  readonly __edges: readonly CoreEdgeEntry[]
}
