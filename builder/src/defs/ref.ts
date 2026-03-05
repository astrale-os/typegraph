/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import type { Def } from './definition.js'
import type { ExtractFullProps, ExtractFullData } from '../inference/index.js'

/** Branded Zod schema wrapping a graph def reference.
 * Extends z.ZodType<{id, classId}> for compatibility; _output is overridden so
 * z.infer<RefSchema<D>> resolves to the full props of D (+ data when IncludeData is true). */
export interface RefSchema<D, IncludeData extends boolean = false> extends z.ZodType<{
  readonly id: string
  readonly classId: string
}> {
  readonly __ref_target: D
  readonly _output: IncludeData extends true
    ? ExtractFullProps<D> & ExtractFullData<D> & { readonly id: string; readonly classId: string }
    : ExtractFullProps<D> & { readonly id: string; readonly classId: string }
}

export function ref<D extends Def<any>>(target: D): RefSchema<D, false>
export function ref<D extends Def<any>>(target: D, opts: { data: true }): RefSchema<D, true>
export function ref<D extends Def<any>>(target: D, opts?: { data?: boolean }): RefSchema<D> {
  const schema = z.custom<{ readonly id: string; readonly classId: string }>(() => true)
  ;(schema as any).__ref_target = target
  if (opts?.data) (schema as any).__ref_data = true
  return schema as unknown as RefSchema<D>
}
