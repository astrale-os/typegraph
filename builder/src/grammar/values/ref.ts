import type { z } from 'zod'

/** Unique symbol brand for ref schemas */
export declare const REF_TAG: unique symbol

/**
 * Branded Zod schema wrapping a graph definition reference.
 * At the type level, _output resolves to the full props of the target definition + id.
 */
export interface RefSchema<D = unknown, IncludeData extends boolean = false> extends z.ZodType<{
  readonly id: string
}> {
  readonly [REF_TAG]: { readonly target: D; readonly includeData: IncludeData }
}

/** Type-level extractor: get the ref target from a RefSchema */
export type RefTarget<R> = R extends { readonly [REF_TAG]: { readonly target: infer D } }
  ? D
  : never

/** Type-level check: is this a RefSchema? */
export type IsRef<T> = T extends { readonly [REF_TAG]: any } ? true : false
