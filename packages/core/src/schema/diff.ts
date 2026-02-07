/**
 * Schema Diff
 *
 * Pure function that compares two schema versions and classifies every change
 * as breaking or non-breaking. No side effects — just computes a typed diff.
 */

import { z } from 'zod'
import { deepEqual } from '../deep-equal'
import type { AnySchema, NodeDefinition, EdgeDefinition, SchemaDiff, SchemaChange } from './types'

/** Minimal subset of JSON Schema output from z.toJSONSchema(). */
interface JSONSchemaObject {
  readonly properties?: Readonly<Record<string, Record<string, unknown>>>
  readonly required?: readonly string[]
}

// =============================================================================
// ENDPOINT NORMALIZATION
// =============================================================================

/**
 * Normalizes edge `from`/`to` to sorted arrays for comparison.
 * `'user'` and `['user']` are semantically equivalent.
 */
function normalizeEndpoint(endpoint: string | readonly string[]): string[] {
  return (Array.isArray(endpoint) ? [...endpoint] : [endpoint]).sort()
}

// =============================================================================
// INDEX NORMALIZATION & DIFFING
// =============================================================================

/**
 * Normalized index: a plain object suitable for identity keying and deepEqual comparison.
 * Single property indexes use `property`; composite indexes use `properties`.
 */
interface NormalizedIndex {
  readonly property?: string
  readonly properties?: readonly string[]
  readonly type: string
  readonly order?: Record<string, string>
  readonly name?: string
}

function normalizeIndex(idx: unknown): NormalizedIndex {
  if (typeof idx === 'string') {
    return { property: idx, type: 'btree' }
  }
  const obj = idx as Record<string, unknown>
  if ('properties' in obj && Array.isArray(obj.properties)) {
    return {
      properties: obj.properties as string[],
      type: (obj.type as string) ?? 'btree',
      ...(obj.order ? { order: obj.order as Record<string, string> } : {}),
      ...(obj.name ? { name: obj.name as string } : {}),
    }
  }
  return {
    property: obj.property as string,
    type: (obj.type as string) ?? 'btree',
    ...(obj.name ? { name: obj.name as string } : {}),
  }
}

/** Stable key for index identity: property name (single) or JSON array of properties (composite). */
function indexKey(idx: NormalizedIndex): string {
  return idx.properties ? JSON.stringify(idx.properties) : idx.property!
}

/** Human-readable display name for an index (used in change descriptions). */
function indexDisplayName(idx: NormalizedIndex): string {
  return idx.properties ? `[${idx.properties.join(', ')}]` : `'${idx.property}'`
}

function diffIndexes(
  oldIndexes: readonly unknown[] | undefined,
  newIndexes: readonly unknown[] | undefined,
): SchemaChange[] {
  const changes: SchemaChange[] = []
  const oldNorm = (oldIndexes ?? []).map(normalizeIndex)
  const newNorm = (newIndexes ?? []).map(normalizeIndex)

  const oldMap = new Map<string, NormalizedIndex>()
  for (const idx of oldNorm) oldMap.set(indexKey(idx), idx)

  const newMap = new Map<string, NormalizedIndex>()
  for (const idx of newNorm) newMap.set(indexKey(idx), idx)

  for (const [key, idx] of newMap) {
    if (!oldMap.has(key)) {
      const composite = idx.properties ? 'Composite index' : 'Index'
      changes.push({
        kind: 'index-added',
        description: `${composite} on ${indexDisplayName(idx)} (${idx.type}) added`,
        breaking: false,
      })
    }
  }

  for (const [key, idx] of oldMap) {
    if (!newMap.has(key)) {
      const composite = idx.properties ? 'Composite index' : 'Index'
      changes.push({
        kind: 'index-removed',
        description: `${composite} on ${indexDisplayName(idx)} (${idx.type}) removed`,
        breaking: false,
      })
    }
  }

  for (const [key, oldIdx] of oldMap) {
    const newIdx = newMap.get(key)
    if (!newIdx) continue
    if (!deepEqual(oldIdx, newIdx)) {
      changes.push({
        kind: 'index-changed',
        description: `Index on ${indexDisplayName(oldIdx)} configuration changed`,
        breaking: false,
      })
    }
  }

  return changes
}

// =============================================================================
// PROPERTY SCHEMA DIFFING
// =============================================================================

/**
 * Compares two ZodObject property schemas using JSON Schema conversion.
 * Uses z.toJSONSchema() (Zod v4) to produce deterministic, comparable representations.
 */
function diffPropertySchemas(
  oldProps: z.ZodObject<z.ZodRawShape>,
  newProps: z.ZodObject<z.ZodRawShape>,
): SchemaChange[] {
  const changes: SchemaChange[] = []

  const oldSchema = z.toJSONSchema(oldProps, { unrepresentable: 'any' }) as JSONSchemaObject
  const newSchema = z.toJSONSchema(newProps, { unrepresentable: 'any' }) as JSONSchemaObject

  const oldPropSchemas = oldSchema.properties ?? {}
  const newPropSchemas = newSchema.properties ?? {}
  const oldRequired = new Set<string>(oldSchema.required ?? [])
  const newRequired = new Set<string>(newSchema.required ?? [])

  const allKeys = new Set([...Object.keys(oldPropSchemas), ...Object.keys(newPropSchemas)])

  for (const key of allKeys) {
    const inOld = key in oldPropSchemas
    const inNew = key in newPropSchemas

    if (!inOld && inNew) {
      // Property added
      // A property is non-breaking if it's optional OR has a default value.
      // JSON Schema: optional = not in required; defaulted = has "default" key
      // in per-property schema but may still be in required array.
      const hasDefault = 'default' in newPropSchemas[key]
      const isOptional = !newRequired.has(key)
      const nonBreaking = isOptional || hasDefault
      changes.push({
        kind: 'property-added',
        description: nonBreaking
          ? `Optional property '${key}' added`
          : `Required property '${key}' added`,
        breaking: !nonBreaking,
      })
    } else if (inOld && !inNew) {
      // Property removed
      changes.push({
        kind: 'property-removed',
        description: `Property '${key}' removed`,
        breaking: true,
      })
    } else if (inOld && inNew) {
      // Both exist — compare per-property schema
      if (!deepEqual(oldPropSchemas[key], newPropSchemas[key])) {
        changes.push({
          kind: 'property-changed',
          description: `Property '${key}' schema changed`,
          breaking: true,
        })
      } else {
        // Same schema — check required-ness change
        const wasRequired = oldRequired.has(key)
        const nowRequired = newRequired.has(key)
        if (wasRequired && !nowRequired) {
          changes.push({
            kind: 'property-required-changed',
            description: `Property '${key}' changed from required to optional`,
            breaking: false,
          })
        } else if (!wasRequired && nowRequired) {
          changes.push({
            kind: 'property-required-changed',
            description: `Property '${key}' changed from optional to required`,
            breaking: true,
          })
        }
      }
    }
  }

  return changes
}

// =============================================================================
// NODE DIFFING
// =============================================================================

function diffNode(label: string, oldNode: NodeDefinition, newNode: NodeDefinition): SchemaChange[] {
  const changes: SchemaChange[] = []

  // Property schemas
  changes.push(
    ...diffPropertySchemas(
      oldNode.properties as z.ZodObject<z.ZodRawShape>,
      newNode.properties as z.ZodObject<z.ZodRawShape>,
    ),
  )

  // Indexes
  changes.push(
    ...diffIndexes(oldNode.indexes as readonly unknown[], newNode.indexes as readonly unknown[]),
  )

  // Labels (inheritance)
  const oldLabels = new Set(oldNode.labels ?? [])
  const newLabels = new Set(newNode.labels ?? [])

  for (const lbl of newLabels) {
    if (!oldLabels.has(lbl)) {
      changes.push({
        kind: 'label-added',
        description: `Label '${lbl}' added to node '${label}'`,
        breaking: false,
      })
    }
  }

  for (const lbl of oldLabels) {
    if (!newLabels.has(lbl)) {
      changes.push({
        kind: 'label-removed',
        description: `Label '${lbl}' removed from node '${label}'`,
        breaking: true,
      })
    }
  }

  // Description
  if (oldNode.description !== newNode.description) {
    changes.push({
      kind: 'description-changed',
      description: `Description changed on node '${label}'`,
      breaking: false,
    })
  }

  return changes
}

// =============================================================================
// EDGE DIFFING
// =============================================================================

function diffEdge(type: string, oldEdge: EdgeDefinition, newEdge: EdgeDefinition): SchemaChange[] {
  const changes: SchemaChange[] = []

  // From
  const oldFrom = normalizeEndpoint(oldEdge.from)
  const newFrom = normalizeEndpoint(newEdge.from)
  if (!deepEqual(oldFrom, newFrom)) {
    changes.push({
      kind: 'from-changed',
      description: `Edge '${type}' source changed from [${oldFrom.join(', ')}] to [${newFrom.join(', ')}]`,
      breaking: true,
    })
  }

  // To
  const oldTo = normalizeEndpoint(oldEdge.to)
  const newTo = normalizeEndpoint(newEdge.to)
  if (!deepEqual(oldTo, newTo)) {
    changes.push({
      kind: 'to-changed',
      description: `Edge '${type}' target changed from [${oldTo.join(', ')}] to [${newTo.join(', ')}]`,
      breaking: true,
    })
  }

  // Cardinality
  if (!deepEqual(oldEdge.cardinality, newEdge.cardinality)) {
    changes.push({
      kind: 'cardinality-changed',
      description: `Edge '${type}' cardinality changed from {outbound: '${oldEdge.cardinality.outbound}', inbound: '${oldEdge.cardinality.inbound}'} to {outbound: '${newEdge.cardinality.outbound}', inbound: '${newEdge.cardinality.inbound}'}`,
      breaking: true,
    })
  }

  // Property schemas
  changes.push(
    ...diffPropertySchemas(
      oldEdge.properties as z.ZodObject<z.ZodRawShape>,
      newEdge.properties as z.ZodObject<z.ZodRawShape>,
    ),
  )

  // Indexes
  changes.push(
    ...diffIndexes(
      oldEdge.indexes as readonly unknown[] | undefined,
      newEdge.indexes as readonly unknown[] | undefined,
    ),
  )

  // Description
  if (oldEdge.description !== newEdge.description) {
    changes.push({
      kind: 'description-changed',
      description: `Description changed on edge '${type}'`,
      breaking: false,
    })
  }

  return changes
}

// =============================================================================
// HIERARCHY DIFFING
// =============================================================================

function diffHierarchy(oldSchema: AnySchema, newSchema: AnySchema): SchemaChange[] {
  const changes: SchemaChange[] = []
  const oldH = oldSchema.hierarchy
  const newH = newSchema.hierarchy

  if (!oldH && !newH) return changes

  if (!oldH && newH) {
    changes.push({
      kind: 'hierarchy-added',
      description: `Hierarchy added (defaultEdge: '${newH.defaultEdge}', direction: '${newH.direction}')`,
      breaking: false,
    })
    return changes
  }

  if (oldH && !newH) {
    changes.push({
      kind: 'hierarchy-removed',
      description: `Hierarchy removed (was defaultEdge: '${oldH.defaultEdge}', direction: '${oldH.direction}')`,
      breaking: false,
    })
    return changes
  }

  // Both exist — compare fields
  if (oldH!.defaultEdge !== newH!.defaultEdge || oldH!.direction !== newH!.direction) {
    changes.push({
      kind: 'hierarchy-changed',
      description: `Hierarchy changed from {defaultEdge: '${oldH!.defaultEdge}', direction: '${oldH!.direction}'} to {defaultEdge: '${newH!.defaultEdge}', direction: '${newH!.direction}'}`,
      breaking: false,
    })
  }

  return changes
}

// =============================================================================
// MAIN DIFF FUNCTION
// =============================================================================

/**
 * Compares two schema versions and classifies every change.
 *
 * Pure function. Computes a typed diff with breaking/non-breaking classification,
 * following the same contract as `diffCore`.
 *
 * Property schemas are compared via `z.toJSONSchema()` (Zod v4) — this produces
 * deterministic JSON Schema draft-2020-12 representations that capture type,
 * optionality, defaults, and transforms.
 *
 * Node properties reflect the merged state after label inheritance (what
 * `defineSchema()` produces). If a parent's property changes, all inheriting
 * children's effective schemas change too.
 *
 * @param previous - The old schema version
 * @param current - The new schema version
 * @returns A SchemaDiff describing all changes with breaking classification
 */
export function diffSchema(previous: AnySchema, current: AnySchema): SchemaDiff {
  const breakingReasons: string[] = []
  const warnings: string[] = []

  // --- Node diffing ---
  const prevNodeLabels = new Set(Object.keys(previous.nodes))
  const currNodeLabels = new Set(Object.keys(current.nodes))

  const nodesAdded: string[] = []
  const nodesRemoved: string[] = []
  const nodesModified: { label: string; changes: SchemaChange[] }[] = []

  for (const label of currNodeLabels) {
    if (!prevNodeLabels.has(label)) {
      nodesAdded.push(label)
    }
  }

  for (const label of prevNodeLabels) {
    if (!currNodeLabels.has(label)) {
      nodesRemoved.push(label)
      breakingReasons.push(`Node kind '${label}' was removed`)
    }
  }

  for (const label of prevNodeLabels) {
    if (!currNodeLabels.has(label)) continue
    const changes = diffNode(label, previous.nodes[label], current.nodes[label])
    if (changes.length > 0) {
      nodesModified.push({ label, changes })
      for (const change of changes) {
        if (change.breaking) {
          breakingReasons.push(change.description)
        }
        if (change.kind.startsWith('index-')) {
          warnings.push(change.description)
        }
      }
    }
  }

  // --- Edge diffing ---
  const prevEdgeTypes = new Set(Object.keys(previous.edges))
  const currEdgeTypes = new Set(Object.keys(current.edges))

  const edgesAdded: string[] = []
  const edgesRemoved: string[] = []
  const edgesModified: { type: string; changes: SchemaChange[] }[] = []

  for (const type of currEdgeTypes) {
    if (!prevEdgeTypes.has(type)) {
      edgesAdded.push(type)
    }
  }

  for (const type of prevEdgeTypes) {
    if (!currEdgeTypes.has(type)) {
      edgesRemoved.push(type)
      breakingReasons.push(`Edge type '${type}' was removed`)
    }
  }

  for (const type of prevEdgeTypes) {
    if (!currEdgeTypes.has(type)) continue
    const changes = diffEdge(type, previous.edges[type], current.edges[type])
    if (changes.length > 0) {
      edgesModified.push({ type, changes })
      for (const change of changes) {
        if (change.breaking) {
          breakingReasons.push(change.description)
        }
        if (change.kind.startsWith('index-')) {
          warnings.push(change.description)
        }
      }
    }
  }

  // --- Hierarchy diffing ---
  const hierarchyChanges = diffHierarchy(previous, current)
  for (const change of hierarchyChanges) {
    warnings.push(change.description)
  }

  return {
    nodes: {
      added: nodesAdded,
      removed: nodesRemoved,
      modified: nodesModified,
    },
    edges: {
      added: edgesAdded,
      removed: edgesRemoved,
      modified: edgesModified,
    },
    hierarchy: hierarchyChanges,
    breaking: breakingReasons.length > 0,
    breakingReasons,
    warnings,
  }
}
