import type { z } from 'zod'
import type { OpDef } from '../defs/op.js'
import type { ParamShape } from '../defs/common.js'
import type { IfaceDef } from '../defs/iface.js'
import type { NodeDef } from '../defs/node.js'
import type { EdgeDef } from '../defs/edge.js'
import type { ExtractImplements, ExtractNodeExtends, InferProps, ExtractFullProps } from './props.js'
import type { ExtractFullData } from './data.js'

/** Extract own methods from a def's config (not inherited) */
export type ExtractMethods<D> =
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  D extends { config: { methods: infer M extends Record<string, OpDef> } } ? M : {}

/** Collect methods from an interface list (own + parent extends chain) */
type CollectIfaceMethodsFromList<T> = T extends readonly [
  infer Head extends IfaceDef<any>,
  ...infer Tail extends readonly IfaceDef<any>[],
]
  ? ExtractMethods<Head> &
      (Head extends IfaceDef<infer HC>
        ? HC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
          ? CollectIfaceMethodsFromList<Parents>
          : unknown
        : unknown) &
      CollectIfaceMethodsFromList<Tail>
  : unknown

/** All methods for a def: own + inherited from implements/extends */
export type AllMethods<D> =
  D extends NodeDef<any>
    ? ExtractMethods<D> &
        CollectIfaceMethodsFromList<ExtractImplements<D>> &
        (ExtractNodeExtends<D> extends never ? unknown : AllMethods<ExtractNodeExtends<D>>)
    : D extends IfaceDef<any>
      ? ExtractMethods<D> &
          (D extends IfaceDef<infer IC>
            ? IC extends { extends: infer Parents extends readonly IfaceDef<any>[] }
              ? CollectIfaceMethodsFromList<Parents>
              : unknown
            : unknown)
      : D extends EdgeDef<any, any, any>
        ? ExtractMethods<D> &
            CollectIfaceMethodsFromList<ExtractImplements<D>>
        : ExtractMethods<D>

/** Check if a def has methods (own or inherited) */
export type HasMethods<D> = keyof AllMethods<D> extends never ? false : true

/** Get method names from a def (own + inherited) */
export type ExtractMethodNames<D> = keyof AllMethods<D> & string

/** Get the config of a specific method (own or inherited) */
type GetMethodConfig<D, M extends string> = M extends keyof AllMethods<D>
  ? AllMethods<D>[M] extends OpDef<infer MC>
    ? MC
    : never
  : never

/** Check if a specific method on a def is static */
export type IsStaticMethod<D, M extends string> =
  GetMethodConfig<D, M> extends { static: true } ? true : false

/** Extract resolved params (handles thunks at type level) */
export type ExtractMethodParams<D, M extends string> =
  GetMethodConfig<D, M> extends { params: infer P }
    ? P extends (() => infer R extends ParamShape)
      ? R
      : P extends ParamShape
        ? P
        : Record<string, never>
    : Record<string, never>

/** Extract return type */
export type ExtractMethodReturns<D, M extends string> =
  GetMethodConfig<D, M> extends { returns: infer R extends z.ZodType } ? R : never

type MethodReturnValue<D, R extends z.ZodType> = R extends { readonly __data_self: true }
  ? D extends NodeDef<any> | IfaceDef<any>
    ? ExtractFullData<D>
    : never
  : R extends { readonly __data_grant: true; readonly __data_target: infer T }
    ? T extends NodeDef<any> | IfaceDef<any>
      ? ExtractFullData<T>
      : unknown
    : z.infer<R>

export type ExtractMethodReturnValue<D, M extends string> = MethodReturnValue<
  D,
  ExtractMethodReturns<D, M>
>

/** Self type for a node or edge method */
export type MethodSelf<D> =
  D extends NodeDef<any>
    ? ExtractFullProps<D> & { readonly id: string }
    : D extends EdgeDef<any, any, infer EC>
      ? (EC extends { props: infer P } ? InferProps<P> : unknown) & {
          readonly id: string
          readonly from: string
          readonly to: string
        }
      : { readonly id: string }
