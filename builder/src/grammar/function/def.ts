import type { FnConfig } from './config.js'

/** Branded function definition, parameterized by its config */
export interface FnDef<out C extends FnConfig = FnConfig> {
  readonly __type: 'fn'
  readonly __brand: unique symbol
  readonly config: C
}
