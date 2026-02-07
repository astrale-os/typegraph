/**
 * Deep Equality
 *
 * Internal utility shared by core diff and schema diff.
 * NOT part of the public API surface — not exported from any package entry point.
 *
 * Handles primitives, arrays, plain objects, and Date.
 *
 * Limitation: does NOT handle Map, Set, RegExp, or typed arrays —
 * these would be compared as plain objects (by enumerable keys), which
 * may produce false equality. Property schemas should not produce such values.
 */

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)
  if (aKeys.length !== bKeys.length) return false
  return aKeys.every((key) => deepEqual(aObj[key], bObj[key]))
}
