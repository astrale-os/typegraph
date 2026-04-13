import type { z } from 'zod'

/** Unique symbol brand for data access schemas */
export declare const DATA_TAG: unique symbol

/** Marker for the owning node's datastore content */
export interface DataSelfSchema extends z.ZodType<unknown> {
  readonly [DATA_TAG]: { readonly kind: 'self' }
}

/** Marker for another node's datastore content */
export interface DataGrantSchema<D = unknown> extends z.ZodType<unknown> {
  readonly [DATA_TAG]: { readonly kind: 'grant'; readonly target: D }
}

/** Type-level check: is this a DataSelfSchema? */
export type IsDataSelf<T> = T extends { readonly [DATA_TAG]: { readonly kind: 'self' } }
  ? true
  : false

/** Type-level check: extract grant target */
export type DataGrantTarget<T> = T extends {
  readonly [DATA_TAG]: { readonly kind: 'grant'; readonly target: infer D }
}
  ? D
  : never
