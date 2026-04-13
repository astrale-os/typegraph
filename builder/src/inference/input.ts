import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { ExtractContent } from './content.js'
import type { ExtractProperties, ExtractInherits, InferProperties } from './properties.js'

/** Resolve one inherits entry: properties + content + recursive ancestors */
type ResolveInheritsEntry<H extends AnyDef> = InferProperties<ExtractProperties<H>> &
  InferProperties<ExtractContent<H>> &
  CollectInputFromInherits<ExtractInherits<H>>

/** Collect all properties AND content from inherits chain (later entries shadow earlier) */
type CollectInputFromInherits<T> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? Omit<ResolveInheritsEntry<Head>, keyof CollectInputFromInherits<Tail>> &
      CollectInputFromInherits<Tail>
  : unknown

/** Full inferred node input: properties + content, own shadow inherited */
export type ExtractNodeInput<D> = D extends AnyDef
  ? Omit<
      CollectInputFromInherits<ExtractInherits<D>>,
      keyof InferProperties<ExtractProperties<D>> | keyof InferProperties<ExtractContent<D>>
    > &
      InferProperties<ExtractProperties<D>> &
      InferProperties<ExtractContent<D>>
  : unknown
