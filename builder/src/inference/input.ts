import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { ExtractContent } from './content.js'
import type { ExtractProperties, ExtractInherits, InferProperties } from './properties.js'

/**
 * Walk the ancestor DAG, plain-intersecting each def's own props and content.
 * Tail-recursive worklist — `inherits` of each head are prepended so the DAG
 * is flattened without branching recursion.
 */
type CollectAncestorInput<T, Acc = unknown> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? CollectAncestorInput<
      [...ExtractInherits<Head>, ...Tail],
      Acc & InferProperties<ExtractProperties<Head>> & InferProperties<ExtractContent<Head>>
    >
  : Acc

/** A single def's input contribution: own props/content plus all its ancestors. */
type ResolveInheritsEntry<H extends AnyDef> = InferProperties<ExtractProperties<H>> &
  InferProperties<ExtractContent<H>> &
  CollectAncestorInput<ExtractInherits<H>>

/**
 * Collect all siblings' contributions — later siblings shadow earlier ones
 * (preserves the original right-wins semantics of `inherits: [A, B]`).
 * Tail-recursive accumulator form.
 */
type CollectInputFromInherits<T, Acc = unknown> = T extends readonly [
  infer Head extends AnyDef,
  ...infer Tail extends readonly AnyDef[],
]
  ? CollectInputFromInherits<
      Tail,
      Omit<Acc, keyof ResolveInheritsEntry<Head>> & ResolveInheritsEntry<Head>
    >
  : Acc

/** Full inferred node input: properties + content, own shadow inherited */
export type ExtractNodeInput<D> = D extends AnyDef
  ? Omit<
      CollectInputFromInherits<ExtractInherits<D>>,
      keyof InferProperties<ExtractProperties<D>> | keyof InferProperties<ExtractContent<D>>
    > &
      InferProperties<ExtractProperties<D>> &
      InferProperties<ExtractContent<D>>
  : unknown
