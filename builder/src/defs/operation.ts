import type { z } from 'zod'

export type ParamShape = Record<string, z.ZodType>

export type Access = 'private' | 'internal'

export interface OpConfig {
  readonly params?: ParamShape | (() => ParamShape)
  readonly returns: z.ZodType
  readonly access?: Access
  readonly static?: boolean
}

export interface OpDef<out C extends OpConfig = OpConfig> {
  readonly type: 'op'
  readonly config: C
}

export function op<const C extends OpConfig>(config: C): OpDef<C> {
  return { type: 'op', config } as OpDef<C>
}

/** @deprecated Use `op()` instead. */
export const method = op
