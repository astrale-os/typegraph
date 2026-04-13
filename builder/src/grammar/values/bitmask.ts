/** Unique symbol brand for bitmask types */
export declare const BITMASK_TAG: unique symbol

/** Branded type for permissions bitfield (resolves to number) */
export interface BitmaskDef {
  readonly [BITMASK_TAG]: true
}
