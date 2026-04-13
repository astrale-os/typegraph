import type { z } from 'zod'

/** Shape of the attributes record on a definition config */
export type AttributeShape = Record<string, Property>

/** A property is either a bare Zod schema or a PropDef with metadata */
export type Property = z.ZodType | AttributeDef

/** Attribute definition with explicit metadata (private flag) */
export interface AttributeDef<S extends z.ZodType = z.ZodType> {
  readonly _tag: 'AttributeDef'
  readonly schema: S
  readonly private: boolean
}

/** Normalized attribute — the resolved form of a Property */
export interface NormalizedAttribute {
  readonly schema: z.ZodType
  readonly private: boolean
}

/** Type guard for AttributeDef */
export function isAttributeDef(value: unknown): value is AttributeDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_tag' in value &&
    (value as AttributeDef)._tag === 'AttributeDef'
  )
}

/** Normalize a Property into its resolved form */
export function normalizeAttribute(prop: Property): NormalizedAttribute {
  if (isAttributeDef(prop)) {
    return { schema: prop.schema, private: prop.private }
  }
  return { schema: prop, private: false }
}
