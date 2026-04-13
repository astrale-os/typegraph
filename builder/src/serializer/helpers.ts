// oxlint-disable typescript/no-explicit-any
import type { z } from 'zod'

import type { Cardinality } from '../grammar/facets/endpoints.js'
import type { BITMASK_TAG } from '../grammar/values/bitmask.js'
import type { DATA_TAG } from '../grammar/values/data.js'
import type { REF_TAG } from '../grammar/values/ref.js'

// Runtime symbols
const REF_TAG_RUNTIME = Symbol.for('REF_TAG') as typeof REF_TAG
const DATA_TAG_RUNTIME = Symbol.for('DATA_TAG') as typeof DATA_TAG
const BITMASK_TAG_RUNTIME = Symbol.for('BITMASK_TAG') as typeof BITMASK_TAG

// ── Zod introspection ─────────────────────────────────────────────────

export function getZodDef(schema: z.ZodType): Record<string, any> | null {
  return (schema as any)?._zod?.def ?? (schema as any)?._def ?? null
}

export function getZodTypeName(def: Record<string, any>): string | undefined {
  return def.typeName ?? def.type
}

export function getZodInner(def: Record<string, any>): z.ZodType | null {
  return def.innerType ?? def.inner ?? null
}

export interface UnwrapResult {
  inner: z.ZodType
  nullable: boolean
  defaultValue: unknown
  hasDefault: boolean
}

export function unwrapZod(schema: z.ZodType): UnwrapResult {
  let current = schema
  let nullable = false
  let defaultValue: unknown = undefined
  let hasDefault = false

  for (let i = 0; i < 10; i++) {
    const def = getZodDef(current)
    if (!def) break

    const typeName = getZodTypeName(def)

    if (typeName === 'ZodOptional' || typeName === 'optional') {
      nullable = true
      const inner = getZodInner(def)
      if (!inner) break
      current = inner
      continue
    }

    if (typeName === 'ZodNullable' || typeName === 'nullable') {
      nullable = true
      const inner = getZodInner(def)
      if (!inner) break
      current = inner
      continue
    }

    if (typeName === 'ZodDefault' || typeName === 'default') {
      hasDefault = true
      const dv = def.defaultValue !== undefined ? def.defaultValue : def.value
      defaultValue = typeof dv === 'function' ? dv() : dv
      const inner = getZodInner(def)
      if (!inner) break
      current = inner
      continue
    }

    break
  }

  return { inner: current, nullable, defaultValue, hasDefault }
}

export function getArrayElement(schema: z.ZodType): z.ZodType | null {
  const def = getZodDef(schema)
  if (!def) return null
  const typeName = getZodTypeName(def)
  if (typeName === 'ZodArray' || typeName === 'array') {
    return def.element ?? def.items ?? null
  }
  return null
}

// ── Brand detection (new symbol-based) ────────────────────────────────

export function hasRefTag(schema: z.ZodType): boolean {
  return schema !== null && typeof schema === 'object' && REF_TAG_RUNTIME in (schema as any)
}

export function getRefMeta(schema: z.ZodType): { target: object; includeData: boolean } | null {
  if (!hasRefTag(schema)) return null
  return (schema as any)[REF_TAG_RUNTIME]
}

export function hasDataTag(schema: z.ZodType): boolean {
  return schema !== null && typeof schema === 'object' && DATA_TAG_RUNTIME in (schema as any)
}

export function getDataMeta(
  schema: z.ZodType,
): { kind: 'self' } | { kind: 'grant'; target: object } | null {
  if (!hasDataTag(schema)) return null
  return (schema as any)[DATA_TAG_RUNTIME]
}

export function hasBitmaskTag(schema: z.ZodType): boolean {
  return schema !== null && typeof schema === 'object' && BITMASK_TAG_RUNTIME in (schema as any)
}

// ── JSON Schema helpers ───────────────────────────────────────────────

export type JsonSchema = Record<string, unknown>

export function foldNullable(schema: JsonSchema): JsonSchema {
  if (schema.type) {
    const existing = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!existing.includes('null')) {
      return { ...schema, type: [...existing, 'null'] }
    }
    return schema
  }
  return { anyOf: [schema, { type: 'null' }] }
}

export function mapCardinality(c: Cardinality): { min: number; max: number | null } | undefined {
  switch (c) {
    case '0..1':
      return { min: 0, max: 1 }
    case '1':
      return { min: 1, max: 1 }
    case '0..*':
      return undefined
    case '1..*':
      return { min: 1, max: null }
  }
}

export function cleanJsonSchema(schema: Record<string, unknown>): JsonSchema {
  const result: JsonSchema = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue
    result[key] = value
  }
  return result
}
