import type { IfaceDef } from '../defs/iface.js'
import type { NodeDef } from '../defs/node.js'
import type { EdgeDef } from '../defs/edge.js'
import type { PropShape } from '../defs/common.js'
import type { ExtractProps, ExtractImplements, ExtractNodeExtends, InferProps } from './props.js'
import type { ExtractData } from './data.js'

/** Collect all iface props AND data via extends chain — single traversal */
type CollectIfaceInputFromList<T> = T extends readonly [
  infer Head extends IfaceDef<any>,
  ...infer Tail extends readonly IfaceDef<any>[],
]
  ? InferProps<ExtractProps<Head>> &
      InferProps<ExtractData<Head>> &
      (Head extends IfaceDef<infer HC>
        ? HC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
          ? CollectIfaceInputFromList<Parents>
          : unknown
        : unknown) &
      CollectIfaceInputFromList<Tail>
  : unknown

/** Full inferred props AND data — single traversal for node() input */
export type ExtractNodeInput<D> =
  D extends NodeDef<any>
    ? InferProps<ExtractProps<D>> &
        InferProps<ExtractData<D>> &
        CollectIfaceInputFromList<ExtractImplements<D>> &
        (ExtractNodeExtends<D> extends never ? unknown : ExtractNodeInput<ExtractNodeExtends<D>>)
    : D extends IfaceDef<any>
      ? InferProps<ExtractProps<D>> &
          InferProps<ExtractData<D>> &
          (D extends IfaceDef<infer IC>
            ? IC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
              ? CollectIfaceInputFromList<Parents>
              : unknown
            : unknown)
      : D extends EdgeDef<any, any, infer EC>
        ? EC extends { props: infer P extends PropShape }
          ? InferProps<P>
          : unknown
        : unknown
