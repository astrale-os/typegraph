import type { FnConfig } from '../grammar/function/config.js'
import type { FnDef } from '../grammar/function/def.js'

/** Create a function definition — the behavioral primitive */
export function fn<const C extends FnConfig>(config: C): FnDef<C> {
  return { __type: 'fn', config } as FnDef<C>
}
