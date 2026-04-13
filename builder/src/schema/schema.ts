import type { AnyInterfaceDef, AnyClassDef } from '../grammar/definition/discriminants.js'
import type { FnDef } from '../grammar/function/def.js'

/**
 * The rich schema object — two groups (interfaces + classes),
 * pre-resolved types, ref maps, domain. Produced by `defineSchema`.
 *
 * @typeParam I — Record of interface definitions (node-interface | edge-interface)
 * @typeParam C — Record of class definitions (node-class | edge-class)
 */
export interface Schema<
  I extends Record<string, AnyInterfaceDef> = Record<string, AnyInterfaceDef>,
  C extends Record<string, AnyClassDef> = Record<string, AnyClassDef>,
> {
  readonly domain: string
  readonly interfaces: { readonly [K in keyof I & string]: I[K] }
  readonly classes: { readonly [K in keyof C & string]: C[K] }
  readonly functions: Record<string, FnDef>
  readonly imports: readonly Schema[]
}
