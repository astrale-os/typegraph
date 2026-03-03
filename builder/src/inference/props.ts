import type { z } from 'zod'
import type { IfaceDef } from '../defs/iface.js'
import type { NodeDef } from '../defs/node.js'
import type { EdgeDef } from '../defs/edge.js'
import type { PropShape } from '../defs/common.js'

/** Extract own props from a def's config */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type ExtractProps<D> = D extends { config: { props: infer P } } ? P : {}

/** Infer Zod types in a PropShape to their runtime values */
export type InferProps<P> = {
  [K in keyof P]: P[K] extends z.ZodType<infer O> ? O : never
}

// ── Shared traversal helpers ────────────────────────────────────────────────

/** Extract implements array from a NodeDef */
export type ExtractImplements<D> =
  D extends NodeDef<infer C>
    ? C extends { implements: infer I extends readonly IfaceDef<any>[] }
      ? I
      : readonly []
    : readonly []

/** Extract extends NodeDef from a NodeDef */
export type ExtractNodeExtends<D> =
  D extends NodeDef<infer C>
    ? C extends { extends: infer E extends NodeDef<any> }
      ? E
      : never
    : never

/** Collect all iface props via extends chain */
export type CollectIfacePropsFromList<T> = T extends readonly [
  infer Head extends IfaceDef<any>,
  ...infer Tail extends readonly IfaceDef<any>[],
]
  ? InferProps<ExtractProps<Head>> &
      (Head extends IfaceDef<infer HC>
        ? HC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
          ? CollectIfacePropsFromList<Parents>
          : unknown
        : unknown) &
      CollectIfacePropsFromList<Tail>
  : unknown

/** Full inferred props for a NodeDef: own + inherited from implements + inherited from extends */
export type ExtractFullProps<D> =
  D extends NodeDef<any>
    ? InferProps<ExtractProps<D>> &
        CollectIfacePropsFromList<ExtractImplements<D>> &
        (ExtractNodeExtends<D> extends never ? unknown : ExtractFullProps<ExtractNodeExtends<D>>)
    : D extends IfaceDef<any>
      ? InferProps<ExtractProps<D>> &
          (D extends IfaceDef<infer IC>
            ? IC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
              ? CollectIfacePropsFromList<Parents>
              : unknown
            : unknown)
      : D extends EdgeDef<any, any, infer EC>
        ? EC extends { props: infer P extends PropShape }
          ? InferProps<P>
          : unknown
        : unknown
