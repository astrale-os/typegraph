/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'

import type { ExtractFullProps, ExtractFullData } from '../inference/index.js'
import type { Def, DefConfig } from './definition.js'

/** Branded Zod schema wrapping a graph def reference.
 * Extends z.ZodType<{id}> for compatibility; _output is overridden so
 * z.infer<RefSchema<D>> resolves to the full props of D (+ data when IncludeData is true). */
export interface RefSchema<D, IncludeData extends boolean = false> extends z.ZodType<{
  readonly id: string
}> {
  readonly __ref_target: D
  readonly _output: IncludeData extends true
    ? ExtractFullProps<D> & ExtractFullData<D> & { readonly id: string }
    : ExtractFullProps<D> & { readonly id: string }
}

/** Branded type for self-referencing defs. Use `ref(SELF)` inside a def
 * to reference the def being defined, avoiding circular type inference. */
export interface SelfDef extends Def<DefConfig> {
  readonly __self: true
}

/** Self-reference token. Use `ref(SELF)` in a def's methods/props
 * to reference the def itself without creating a circular type dependency. */
export const SELF: SelfDef = { type: 'def', config: {}, __self: true } as any

export function ref(target: SelfDef): RefSchema<SelfDef, false>
export function ref<D extends Def<any>>(target: D): RefSchema<D, false>
export function ref<D extends Def<any>>(target: D, opts: { data: true }): RefSchema<D, true>
export function ref<D extends Def<any>>(target: D, opts?: { data?: boolean }): RefSchema<D> {
  const schema = z
    .union([z.string(), z.object({ id: z.string() }).passthrough()])
    .transform((value) => (typeof value === 'string' ? { id: value } : value))
  ;(schema as any).__ref_target = target
  if (opts?.data) (schema as any).__ref_data = true
  return schema as unknown as RefSchema<D>
}
