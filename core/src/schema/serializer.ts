/**
 * Schema Serializer
 *
 * Converts TypeGraph schemas to JSON-serializable format using Zod v4's native z.toJSONSchema().
 */

import { z } from 'zod'
import type { SchemaDefinition, NodeDefinition, EdgeDefinition } from './types'

// Use any for JSONSchema to avoid type issues with Zod v4's return type
type JSONSchema = any

/**
 * Serialized node definition.
 */
export interface SerializedNodeDef {
  description?: string
  extends?: string[]
  indexes?: SerializedIndex[]
  properties?: JSONSchema
}

type SerializedIndex =
  | string
  | { property: string; type?: string; name?: string }
  | { properties: string[]; type?: string; order?: Record<string, string>; name?: string }

/**
 * Serialized edge definition.
 */
export interface SerializedEdgeDef {
  from: string | string[]
  to: string | string[]
  cardinality: { outbound: string; inbound: string }
  description?: string
  indexes?: SerializedIndex[]
  properties?: JSONSchema
}

/**
 * Serialized schema structure.
 */
export interface SerializedSchema {
  nodes: Record<string, SerializedNodeDef>
  edges: Record<string, SerializedEdgeDef>
  hierarchy?: { defaultEdge: string; direction: 'up' | 'down' }
}

/**
 * Convert a SchemaDefinition to a JSON-serializable format.
 *
 * Uses Zod v4's native z.toJSONSchema() to serialize property schemas
 * into standard JSON Schema format (draft-2020-12).
 *
 * @example
 * ```ts
 * const json = JSON.stringify(toSchema(mySchema), null, 2)
 * ```
 */
export function toSchema<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TNodes extends Record<string, NodeDefinition<any, any>>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TEdges extends Record<string, EdgeDefinition<any, any, any, any, any>>,
>(schema: SchemaDefinition<TNodes, TEdges>): SerializedSchema {
  const nodes: Record<string, SerializedNodeDef> = {}

  for (const [key, nodeDef] of Object.entries(schema.nodes)) {
    const n = nodeDef as NodeDefinition
    nodes[key] = {
      ...(n.description && { description: n.description }),
      ...(n.extends?.length && { extends: [...n.extends] }),
      ...(n.indexes?.length && { indexes: serializeIndexes(n.indexes) }),
      ...(hasProperties(n.properties) && {
        properties: z.toJSONSchema(n.properties, { unrepresentable: 'any' }),
      }),
    }
  }

  const edges: Record<string, SerializedEdgeDef> = {}

  for (const [key, edgeDef] of Object.entries(schema.edges)) {
    const e = edgeDef as EdgeDefinition
    edges[key] = {
      from: Array.isArray(e.from) ? [...e.from] : e.from,
      to: Array.isArray(e.to) ? [...e.to] : e.to,
      cardinality: { ...e.cardinality },
      ...(e.description && { description: e.description }),
      ...(e.indexes?.length && { indexes: serializeIndexes(e.indexes) }),
      ...(hasProperties(e.properties) && {
        properties: z.toJSONSchema(e.properties, { unrepresentable: 'any' }),
      }),
    }
  }

  return {
    nodes,
    edges,
    ...(schema.hierarchy && { hierarchy: { ...schema.hierarchy } }),
  }
}

function serializeIndexes(indexes: readonly unknown[]): SerializedIndex[] {
  return indexes.map((idx) => {
    if (typeof idx === 'string') return idx
    if ('properties' in (idx as object)) {
      const composite = idx as {
        properties: readonly string[]
        type?: string
        order?: Record<string, string>
        name?: string
      }
      return {
        properties: [...composite.properties],
        ...(composite.type && { type: composite.type }),
        ...(composite.order && { order: { ...composite.order } }),
        ...(composite.name && { name: composite.name }),
      }
    }
    const single = idx as { property: string; type?: string; name?: string }
    return {
      property: String(single.property),
      ...(single.type && { type: single.type }),
      ...(single.name && { name: single.name }),
    }
  })
}

function hasProperties(zodSchema: unknown): boolean {
  if (!zodSchema) return false
  const schema = zodSchema as { shape?: Record<string, unknown> }
  return schema.shape !== undefined && Object.keys(schema.shape).length > 0
}
