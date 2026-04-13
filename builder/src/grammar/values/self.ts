/** Unique symbol brand for SELF token */
export declare const SELF_TAG: unique symbol

/** Branded type for self-referencing definitions */
export interface SelfDef {
  readonly [SELF_TAG]: true
}

/**
 * Self-reference token. Use `ref(SELF)` inside a definition's methods
 * to reference the definition itself without creating a circular type dependency.
 */
export const SELF: SelfDef = { [Symbol.for('SELF_TAG') as typeof SELF_TAG]: true } as SelfDef
