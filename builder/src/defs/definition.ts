import type { DefConstraints } from './constraints.js'
import type { DataShape } from './data.js'
import type { EndpointCfg } from './endpoint.js'
import type { IndexDef } from './indexing.js'
import type { OpDef } from './operation.js'
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PropShape } from './property.js'

export type DefType = 'def' | 'op'

export interface DefConfig {
  readonly abstract?: boolean
  readonly inherits?: readonly Def<any>[]
  readonly props?: PropShape
  readonly data?: DataShape
  readonly indexes?: readonly IndexDef[]
  readonly methods?: Record<string, OpDef>
  // Edge-specific (optional — presence of endpoints makes this an "edge class")
  readonly endpoints?: readonly [EndpointCfg, EndpointCfg]
  readonly constraints?: DefConstraints
  readonly onDeleteSource?: 'cascade' | 'unlink' | 'prevent'
  readonly onDeleteTarget?: 'cascade' | 'unlink' | 'prevent'
}

export interface Def<out C extends DefConfig = DefConfig> {
  readonly type: 'def'
  readonly _brand: unique symbol
  readonly config: C
}

export function def<const C extends DefConfig>(config: C | (() => C)): Def<C> {
  return { type: 'def', config } as Def<C>
}

// ── Sugar ────────────────────────────────────────────────────

type WithAbstract<C, A extends boolean> = C & { readonly abstract: A }

export function classDef<const C extends Omit<DefConfig, 'abstract'>>(
  config: C | (() => C),
): Def<WithAbstract<C, false>> {
  const resolved = typeof config === 'function' ? config : config
  return def(
    typeof resolved === 'function'
      ? () => ({ ...resolved(), abstract: false as const })
      : { ...resolved, abstract: false as const },
  ) as Def<WithAbstract<C, false>>
}

// ── interfaceDef — accepts `extends` (mapped to internal `inherits`) ───

export type InterfaceConfig = Omit<DefConfig, 'abstract' | 'inherits'> & {
  readonly extends?: readonly Def<any>[]
}

type MapExtendsToInherits<C> = Omit<C, 'extends'> &
  (C extends { extends: infer E } ? { readonly inherits: E } : Record<string, never>)

export function interfaceDef<const C extends InterfaceConfig>(
  config: C | (() => C),
): Def<WithAbstract<MapExtendsToInherits<C>, true>> {
  if (typeof config === 'function') {
    return def(() => {
      const { extends: exts, ...rest } = config()
      return { ...rest, abstract: true as const, inherits: exts }
    }) as any
  }
  const { extends: exts, ...rest } = config
  return def({ ...rest, abstract: true as const, inherits: exts }) as any
}
