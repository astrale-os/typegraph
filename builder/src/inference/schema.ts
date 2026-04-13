// oxlint-disable typescript/no-explicit-any
import type { Kind } from '../grammar/definition/discriminants.js'
import type { EdgeClassDef } from '../grammar/definition/edge-class.js'
import type { EdgeInterfaceDef } from '../grammar/definition/edge-interface.js'
import type { NodeClassDef } from '../grammar/definition/node-class.js'
import type { NodeInterfaceDef } from '../grammar/definition/node-interface.js'
import type { FnDef } from '../grammar/function/def.js'

/** Filter a record of defs by kind */
export type FilterByKind<Defs extends Record<string, { __kind: string }>, K extends Kind> = {
  [N in keyof Defs as Defs[N] extends { __kind: K } ? N : never]: Defs[N]
}

/** Extract all node interfaces from a schema group */
export type SchemaNodeInterfaces<I extends Record<string, any>> = {
  [N in keyof I as I[N] extends NodeInterfaceDef<any> ? N : never]: I[N]
}

/** Extract all node classes from a schema group */
export type SchemaNodeClasses<C extends Record<string, any>> = {
  [N in keyof C as C[N] extends NodeClassDef<any> ? N : never]: C[N]
}

/** Extract all edge interfaces from a schema group */
export type SchemaEdgeInterfaces<I extends Record<string, any>> = {
  [N in keyof I as I[N] extends EdgeInterfaceDef<any, any> ? N : never]: I[N]
}

/** Extract all edge classes from a schema group */
export type SchemaEdgeClasses<C extends Record<string, any>> = {
  [N in keyof C as C[N] extends EdgeClassDef<any, any> ? N : never]: C[N]
}

/** Extract all method FnDefs from a def, preserving names */
export type SchemaFnRefs<D> = D extends {
  config: { methods: infer M extends Record<string, FnDef> }
}
  ? M
  : never
