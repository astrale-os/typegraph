import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { ExtractAttributes, ExtractInherits, InferAttributes } from './attributes.js'
import type { ExtractContent } from './content.js'

/** Resolve one inherits entry: attributes + content + recursive ancestors */
type ResolveInheritsEntry<H extends AnyDef> = InferAttributes<ExtractAttributes<H>> &
  InferAttributes<ExtractContent<H>> &
  CollectInputFromInherits<ExtractInherits<H>>

/** Collect all attributes AND content from inherits chain (later entries shadow earlier) */
type CollectInputFromInherits<T> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? Omit<ResolveInheritsEntry<Head>, keyof CollectInputFromInherits<Tail>> &
      CollectInputFromInherits<Tail>
  : unknown

/** Full inferred node input: attributes + content, own shadow inherited */
export type ExtractNodeInput<D> = D extends AnyDef
  ? Omit<
      CollectInputFromInherits<ExtractInherits<D>>,
      keyof InferAttributes<ExtractAttributes<D>> | keyof InferAttributes<ExtractContent<D>>
    > &
      InferAttributes<ExtractAttributes<D>> &
      InferAttributes<ExtractContent<D>>
  : unknown
