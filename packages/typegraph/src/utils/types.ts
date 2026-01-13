/**
 * Shared Utility Types
 */

/**
 * Make all properties deeply readonly.
 */
export type DeepReadonly<T> = T extends (infer R)[]
  ? ReadonlyArray<DeepReadonly<R>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/**
 * Flatten complex intersection types for better IDE display.
 */
export type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

/**
 * Convert a union type to an intersection type.
 */
export type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

/**
 * Check if a type is never.
 */
export type IsNever<T> = [T] extends [never] ? true : false;

/**
 * Check if a type is any.
 */
export type IsAny<T> = 0 extends 1 & T ? true : false;

/**
 * Extract keys with values of a specific type.
 */
export type KeysOfType<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never;
}[keyof T];

/**
 * Make specific keys required.
 */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Make specific keys optional.
 */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

