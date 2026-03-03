import type { IfaceDef } from '../defs/iface.js'
import type { NodeDef } from '../defs/node.js'
import type { ExtractImplements, ExtractNodeExtends, InferProps } from './props.js'

/** Extract own data shape from a def's config */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ExtractData<D> = D extends { config: { data: infer P } } ? P : {}

/** Collect all iface data via extends chain */
type CollectIfaceDataFromList<T> = T extends readonly [
  infer Head extends IfaceDef<any>,
  ...infer Tail extends readonly IfaceDef<any>[],
]
  ? InferProps<ExtractData<Head>> &
      (Head extends IfaceDef<infer HC>
        ? HC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
          ? CollectIfaceDataFromList<Parents>
          : unknown
        : unknown) &
      CollectIfaceDataFromList<Tail>
  : unknown

/** Full inferred data for a NodeDef: own + inherited from implements + inherited from extends */
export type ExtractFullData<D> =
  D extends NodeDef<any>
    ? InferProps<ExtractData<D>> &
        CollectIfaceDataFromList<ExtractImplements<D>> &
        (ExtractNodeExtends<D> extends never ? unknown : ExtractFullData<ExtractNodeExtends<D>>)
    : D extends IfaceDef<any>
      ? InferProps<ExtractData<D>> &
          (D extends IfaceDef<infer IC>
            ? IC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
              ? CollectIfaceDataFromList<Parents>
              : unknown
            : unknown)
      : unknown

/** Check if a def has any data (own or inherited) */
export type HasData<D> = keyof ExtractFullData<D> extends never ? false : true
