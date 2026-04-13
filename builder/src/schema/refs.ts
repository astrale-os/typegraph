import type { AnyDef } from '../grammar/definition/discriminants.js'
import type { FnDef } from '../grammar/function/def.js'
import type { Schema } from './schema.js'

/** Kind segment for refs */
export type KindSegment = 'interface' | 'class'

/** Separator used in ref strings (package-level constant) */
export const REF_SEPARATOR = '.'

/** A domain-local definition ref: `i.Name` or `c.Name` */
export type DefRef<K extends KindSegment = KindSegment, N extends string = string> = `${K}.${N}`

/** A qualified method ref: `i.Name.method` or `c.Name.method` */
export type MethodRef<
  K extends KindSegment = KindSegment,
  N extends string = string,
  M extends string = string,
> = `${K}.${N}.${M}`

/** Build a DefRef string */
export function defRef<K extends KindSegment, N extends string>(kind: K, name: N): DefRef<K, N> {
  return `${kind}${REF_SEPARATOR}${name}` as DefRef<K, N>
}

/** Build a MethodRef string */
export function methodRef<K extends KindSegment, N extends string, M extends string>(
  kind: K,
  name: N,
  method: M,
): MethodRef<K, N, M> {
  return `${kind}${REF_SEPARATOR}${name}${REF_SEPARATOR}${method}` as MethodRef<K, N, M>
}

/** Schema-scoped identity: reverse lookup from def object to its group/name/ref */
export interface DefIdentity {
  readonly group: KindSegment
  readonly name: string
  readonly ref: DefRef
}

/**
 * Build a reverse map from def objects to their identity.
 * Used for schema-scoped lookups (replaces the old global WeakMap registry).
 */
export function buildIdentityMap(schema: Schema): Map<AnyDef, DefIdentity> {
  const map = new Map<AnyDef, DefIdentity>()

  for (const [name, def] of Object.entries(schema.interfaces)) {
    map.set(def, { group: 'interface', name, ref: defRef('interface', name) })
  }

  for (const [name, def] of Object.entries(schema.classes)) {
    map.set(def, { group: 'class', name, ref: defRef('class', name) })
  }

  return map
}

/**
 * Build a combined identity map that includes both the schema's own defs and all imports.
 * Call once, then pass to isKnownDef for O(1) lookups.
 */
export function buildFullIdentityMap(schema: Schema): Map<AnyDef, DefIdentity> {
  const map = buildIdentityMap(schema)
  for (const imported of schema.imports ?? []) {
    const importedMap = buildIdentityMap(imported)
    for (const [def, identity] of importedMap) {
      map.set(def, identity)
    }
  }
  return map
}

/** Check if a def exists in the identity map */
export function isKnownDef(def: object, identityMap: Map<AnyDef, DefIdentity>): boolean {
  return identityMap.has(def as AnyDef)
}

/** Build a flat map of all qualified method refs: `{group}.{name}.{method}` → FnDef */
export function buildMethodRefs(schema: Schema): Record<string, FnDef> {
  const fns: Record<string, FnDef> = {}

  const processGroup = (defs: Record<string, AnyDef>, kind: KindSegment) => {
    for (const [name, def] of Object.entries(defs)) {
      const methods = def.config.methods as Record<string, FnDef> | undefined
      if (!methods) continue
      for (const [methodName, fnDef] of Object.entries(methods)) {
        fns[methodRef(kind, name, methodName)] = fnDef
      }
    }
  }

  processGroup(schema.interfaces as Record<string, AnyDef>, 'interface')
  processGroup(schema.classes as Record<string, AnyDef>, 'class')

  return fns
}

// ── Type-level ref generation ─────────────────────────────────────────

/** All interface DefRefs from a schema */
export type InterfaceRefs<S extends Schema> = {
  [K in keyof S['interfaces'] & string]: DefRef<'interface', K>
}[keyof S['interfaces'] & string]

/** All class DefRefs from a schema */
export type ClassRefs<S extends Schema> = {
  [K in keyof S['classes'] & string]: DefRef<'class', K>
}[keyof S['classes'] & string]

/** All DefRefs from a schema */
export type AllDefRefs<S extends Schema> = InterfaceRefs<S> | ClassRefs<S>
