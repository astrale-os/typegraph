import { z } from 'zod'
import type { Cardinality as BuilderCardinality } from '../defs/endpoint.js'
import type { Cardinality, JsonSchema } from '@astrale/typegraph-schema'

// ── Zod introspection helpers ───────────────────────────────────────────────

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

export function mapCardinality(c: BuilderCardinality): Cardinality | undefined {
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

export function hasRefTarget(schema: z.ZodType): boolean {
  return schema != null && typeof schema === 'object' && '__ref_target' in schema
}

export function cleanJsonSchema(schema: Record<string, unknown>): JsonSchema {
  const result: JsonSchema = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === '$schema') continue
    result[key] = value
  }
  return result
}
