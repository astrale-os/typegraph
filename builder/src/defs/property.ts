import type { z } from 'zod'

// ── PropDef — explicit property descriptor with metadata ────────────────────

/** Explicit property definition wrapping a Zod schema with metadata. */
export interface PropDef<T extends z.ZodType = z.ZodType> {
  readonly _tag: 'PropDef'
  readonly schema: T
  readonly private: boolean
}

/** Create an explicit property definition with metadata. */
export function prop<T extends z.ZodType>(schema: T, meta?: { private?: boolean }): PropDef<T> {
  return { _tag: 'PropDef', schema, private: meta?.private ?? false }
}

export function isPropDef(value: unknown): value is PropDef {
  return value !== null && typeof value === 'object' && (value as PropDef)._tag === 'PropDef'
}

/** Normalize any Property to its schema + private flag. */
export function normalizeProp(input: Property): { schema: z.ZodType; private: boolean } {
  if (isPropDef(input)) return { schema: input.schema, private: input.private }
  return { schema: input, private: false }
}

// ── Property — the union type used in PropShape ─────────────────────────────

/** A property is either a bare Zod schema (public by default) or an explicit PropDef. */
export type Property = z.ZodType | PropDef

/** Map of property names to their definitions. */
export type PropShape = Record<string, Property>
