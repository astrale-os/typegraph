import type { z } from 'zod'

export type ParamShape = Record<string, z.ZodType>

export type MethodInheritance = 'sealed' | 'abstract' | 'default'

export interface FnConfig {
  readonly params?: ParamShape | (() => ParamShape)
  readonly returns: z.ZodType
  readonly static?: boolean
  /** Output mode: 'value' (default) = single result, 'stream' = AsyncGenerator, 'binary' = BinaryResult { contentType, body, status? }. */
  readonly output?: 'value' | 'stream' | 'binary'
  /** Method inheritance. `'sealed'` = non-overridable, `'abstract'` = no impl, must be implemented by subtype. `'default'` or omitted = impl provided, overridable. */
  readonly inheritance?: MethodInheritance
}

/** FnConfig restricted to concrete defs: no inheritance allowed, only static. */
export type ConcreteFnConfig = Omit<FnConfig, 'inheritance'> & {
  readonly inheritance?: never
}

export interface FnDef<out C extends FnConfig = FnConfig> {
  readonly type: 'fn'
  readonly config: C
}

export function fn<const C extends FnConfig>(config: C): FnDef<C> {
  return { type: 'fn', config } as FnDef<C>
}
