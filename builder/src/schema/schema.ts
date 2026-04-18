import type { AnyInterfaceDef, AnyClassDef } from '../grammar/definition/discriminants.js'
import type { FnDef } from '../grammar/function/def.js'

/**
 * The rich schema object — two groups (interfaces + classes),
 * pre-resolved types, ref maps, domain. Produced by `defineSchema`.
 *
 * @typeParam I — Record of interface definitions (node-interface | edge-interface)
 * @typeParam C — Record of class definitions (node-class | edge-class)
 * @typeParam Imports — Tuple of imported schemas (preserves concrete types for key extraction).
 *   Default uses `Schema<any, any, any>` to break the self-referential cycle.
 */
export interface Schema<
  I extends Record<string, AnyInterfaceDef> = Record<string, AnyInterfaceDef>,
  C extends Record<string, AnyClassDef> = Record<string, AnyClassDef>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Imports extends readonly Schema<any, any, any>[] = readonly Schema<any, any, any>[],
> {
  readonly domain: string
  readonly interfaces: Readonly<I>
  readonly classes: Readonly<C>
  readonly functions: Record<string, FnDef>
  readonly imports: Imports
}
