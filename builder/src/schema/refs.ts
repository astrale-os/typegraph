import type { Schema } from './schema.js'
import type { Def } from '../defs/def.js'
import type { OpDef } from '../defs/op.js'
import type { ParamShape } from '../defs/common.js'
import type { HasMethods, ExtractMethodNames } from '../inference/methods.js'
import type { InferProps } from '../inference/props.js'

// ── Schema-level type helpers ─────────────────────────────────────────────

/** Get the def for a given key from defs */
export type DefForKey<S extends Schema, K extends string> = K extends keyof S['defs']
  ? S['defs'][K]
  : never

/** Check if a def is abstract (interface) at the type level */
type IsAbstract<D> = D extends Def<infer C> ? (C extends { abstract: true } ? true : false) : false

/** All concrete def keys that have methods (excludes abstract/interface defs) */
export type MethodKeys<S extends Schema> = {
  [K in keyof S['defs'] & string]: IsAbstract<S['defs'][K]> extends true
    ? never
    : HasMethods<S['defs'][K]> extends true
      ? K
      : never
}[keyof S['defs'] & string]

/** Infer params from a builder OpDef (handles thunk params) */
export type InferOpParams<D> =
  D extends OpDef<infer C>
    ? C extends { params: infer P }
      ? P extends (() => infer R extends ParamShape)
        ? InferProps<R>
        : P extends ParamShape
          ? InferProps<P>
          : Record<string, never>
      : Record<string, never>
    : Record<string, never>

/** Infer return type from a builder OpDef */
export type InferOpReturn<D> =
  D extends OpDef<infer C> ? (C extends { returns: import('zod').ZodType<infer R> } ? R : unknown) : unknown

// ── Schema definition references ───────────────────────────────────────────

/**
 * All addressable definitions in a schema: top-level defs + qualified operations.
 * Used for total mappings (e.g., ID assignment) where every definition must be covered.
 */
export type SchemaRefs<S extends Schema> =
  | SchemaClassRefs<S>
  | SchemaOpRefs<S>

/** Top-level definition names. */
export type SchemaClassRefs<S extends Schema> = keyof S['defs'] & string

/** Qualified operation refs: "ClassName.methodName" for all defs with methods. */
export type SchemaOpRefs<S extends Schema> = {
  [K in MethodKeys<S> & string]: `${K}.${ExtractMethodNames<DefForKey<S, K>>}`
}[MethodKeys<S> & string]

/**
 * Flat typed map of all schema refs (class names + qualified operations).
 * Every key is a SchemaRefs<S> string, every value is the same string (identity).
 */
export type SchemaRefsMap<S extends Schema> = {
  readonly [K in SchemaRefs<S>]: K
}

// ── Runtime function ───────────────────────────────────────────────────────

/**
 * Build a flat typed reference map from a schema.
 *
 * Every `SchemaRefs<S>` key maps to itself — plain strings with full auto-complete.
 *
 * @example
 * ```ts
 * const refs = schemaRefs(BlogSchema)
 * refs.Author                   // 'Author'
 * refs['Author.deactivate']     // 'Author.deactivate'
 * refs['Article.publish']       // 'Article.publish' (inherited)
 * refs.wrote                    // 'wrote'
 * ```
 */
export function schemaRefs<S extends Schema>(schema: S): SchemaRefsMap<S> {
  const result: Record<string, string> = {}

  for (const name of Object.keys(schema.defs)) {
    result[name] = name
  }

  for (const key of Object.keys(schema.ops)) {
    result[key] = key
  }

  return result as SchemaRefsMap<S>
}
