/* eslint-disable @typescript-eslint/no-explicit-any */
import { z } from 'zod'
import type { Def } from './definition.js'
import type { ExtractFullData } from '../inference/index.js'

export type DataShape = Record<string, z.ZodType>

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
