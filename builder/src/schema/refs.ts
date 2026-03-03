import type { Schema } from './schema.js'
import type { OpDef } from '../defs/op.js'
import type { ParamShape } from '../defs/common.js'
import type { HasMethods, ExtractMethodNames } from '../inference/methods.js'
import type { InferProps } from '../inference/props.js'

// ── Schema-level type helpers ─────────────────────────────────────────────

/** Get the def for a given key from either nodes or edges */
export type DefForKey<S extends Schema, K extends string> = K extends keyof S['nodes']
  ? S['nodes'][K]
  : K extends keyof S['edges']
    ? S['edges'][K]
    : never

/** All keys (node or edge) that have methods */
export type MethodKeys<S extends Schema> =
  | {
      [K in keyof S['nodes'] & string]: HasMethods<S['nodes'][K]> extends true ? K : never
    }[keyof S['nodes'] & string]
  | {
      [K in keyof S['edges'] & string]: HasMethods<S['edges'][K]> extends true ? K : never
    }[keyof S['edges'] & string]

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
export type SchemaDefs<S extends Schema> =
  | SchemaClassDefs<S>
  | SchemaOpDefs<S>

/** Top-level definition names only (interfaces, nodes, edges). */
export type SchemaClassDefs<S extends Schema> = keyof S['defs'] & string

/** Qualified operation refs: "ClassName.methodName" for all defs with methods. */
export type SchemaOpDefs<S extends Schema> = {
  [K in MethodKeys<S> & string]: `${K}.${ExtractMethodNames<DefForKey<S, K>>}`
}[MethodKeys<S> & string]

/**
 * Flat typed map of all schema defs and operations.
 * Every key is a SchemaDefs<S> string, every value is the same string (identity).
 */
export type SchemaRefsMap<S extends Schema> = {
  readonly [K in SchemaDefs<S>]: K
}

// ── Runtime function ───────────────────────────────────────────────────────

/**
 * Build a flat typed reference map from a schema.
 *
 * Every `SchemaDefs<S>` key maps to itself — plain strings with full auto-complete.
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
