import type { z } from 'zod'

/** Shape of the properties record on a definition config */
export type PropertyShape = Record<string, Property>

/** A property is either a bare Zod schema or a PropertyDef with metadata */
export type Property = z.ZodType | PropertyDef

/** Property definition with explicit metadata (private flag) */
export interface PropertyDef<S extends z.ZodType = z.ZodType> {
  readonly _tag: 'PropertyDef'
  readonly schema: S
  readonly private: boolean
}

/** Normalized property — the resolved form of a Property */
export interface NormalizedProperty {
  readonly schema: z.ZodType
  readonly private: boolean
}

/** Type guard for PropertyDef */
export function isPropertyDef(value: unknown): value is PropertyDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_tag' in value &&
    (value as PropertyDef)._tag === 'PropertyDef'
  )
}

/** Normalize a Property into its resolved form */
export function normalizeProperty(prop: Property): NormalizedProperty {
  if (isPropertyDef(prop)) {
    return { schema: prop.schema, private: prop.private }
  }
  return { schema: prop, private: false }
}
