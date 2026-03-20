import type { z } from 'zod'

export type ParamShape = Record<string, z.ZodType>

export type Access = 'private' | 'internal'

export type MethodInheritance = 'sealed' | 'abstract' | 'default'

export interface OpConfig {
  readonly params?: ParamShape | (() => ParamShape)
  readonly returns: z.ZodType
  readonly access?: Access
  readonly static?: boolean
  /** Method inheritance. `'sealed'` = non-overridable, `'abstract'` = no impl, must be implemented by subtype. `'default'` or omitted = impl provided, overridable with `override: true`. */
  readonly inheritance?: MethodInheritance
  /** Mark as an explicit override of a parent's default method. Required when overriding. */
  readonly override?: boolean
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
