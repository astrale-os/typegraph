/**
 * Domain-aware definition registry.
 *
 * Maps def objects (Def, OpDef) to their canonical
 * identity: `{ domain, name }`. Populated by `defineSchema`, consumed by
 * the serializer and validation logic.
 *
 * Uses a WeakMap so defs can be garbage-collected when no longer referenced.
 */

export interface DefRegistration {
  readonly domain: string
  readonly name: string
}

const registry = new WeakMap<object, DefRegistration>()

/** Register a def with its canonical domain and name. Called by `defineSchema`. */
export function registerDef(def: object, domain: string, name: string): void {
  registry.set(def, { domain, name })
}

/** Get the full registration (domain + name) for a def, or `undefined` if unregistered. */
export function getDefRegistration(def: object): DefRegistration | undefined {
  return registry.get(def)
}

/** Get the canonical name of a def, or `undefined` if unregistered. */
export function getDefName(def: object): string | undefined {
  return registry.get(def)?.name
}

/** Check if a def has been registered (i.e., passed through some `defineSchema`). */
export function hasDefName(def: object): boolean {
  return registry.has(def)
}
