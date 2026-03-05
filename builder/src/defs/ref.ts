import { z } from 'zod'
import type { Def } from './def.js'
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
export function ref<D extends Def<any>>(
  target: D,
  opts: { data: true },
): RefSchema<D, true>
export function ref<D extends Def<any>>(
  target: D,
  opts?: { data?: boolean },
): RefSchema<D> {
  const schema = z.custom<{ readonly id: string; readonly classId: string }>(() => true)
  ;(schema as any).__ref_target = target
  if (opts?.data) (schema as any).__ref_data = true
  return schema as unknown as RefSchema<D>
}

export interface DataGrantToken<out T = unknown> {
  readonly __kind: 'data-grant'
  readonly nodeId: string
  readonly __resolves_to?: T
}

export interface DataSelfSchema extends z.ZodType<unknown> {
  readonly __data_self: true
  readonly _output: unknown
}

export interface DataGrantSchema<D> extends z.ZodType<unknown> {
  readonly __data_grant: true
  readonly __data_target: D
  readonly _output: ExtractFullData<D>
}

export function data(): DataSelfSchema
export function data<D extends Def<any>>(target: D): DataGrantSchema<D>
export function data(target?: Def<any>): DataSelfSchema | DataGrantSchema<any> {
  const schema = z.custom<DataGrantToken>(() => true)
  if (target === undefined) {
    ;(schema as any).__data_self = true
    return schema as unknown as DataSelfSchema
  }
  ;(schema as any).__data_grant = true
  ;(schema as any).__data_target = target
  return schema as unknown as DataGrantSchema<typeof target>
}
