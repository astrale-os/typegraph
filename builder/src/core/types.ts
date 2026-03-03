import type { NodeDef } from '../defs/node.js'
import type { Schema } from '../schema/schema.js'

export interface Ref<D = unknown> {
  readonly __ref: true
  readonly __def: D
  readonly __id: string
}

export interface CoreInstance<N extends NodeDef = NodeDef> {
  readonly type: 'core-instance'
  readonly __nodeDef: N
  readonly __data: Record<string, unknown>
}

export interface CoreLink {
  readonly type: 'core-link'
  readonly __from: CoreInstance | Ref
  readonly __to: CoreInstance | Ref
  readonly __edge: string
  readonly __data?: Record<string, unknown>
}

export type RefsFromInstances<Nodes extends Record<string, CoreInstance>> = {
  [K in keyof Nodes]: Nodes[K] extends CoreInstance<infer N> ? Ref<N> : never
}

export interface CoreDef<
  S extends Schema = Schema,
  N extends string = string,
  R extends Record<string, Ref> = Record<string, Ref>,
> {
  readonly schema: S
  readonly namespace: N
  readonly refs: R
  readonly __operations: ReadonlyArray<{ type: 'create' | 'link'; args: unknown[] }>
}
