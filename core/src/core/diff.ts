/**
 * Core Diff
 *
 * Pure function that compares two Core states (CoreDefinition or CoreSnapshot)
 * against the same schema.
 * No DB access — just computes a typed diff with breaking/non-breaking classification.
 */

import type { AnySchema } from '../schema/types'
import { isCompositeIndex, isSinglePropertyIndex, type IndexConfig } from '../schema/types'
import { deepEqual } from '../deep-equal'
import type { AnyCoreDefinition, CoreDiff, CoreDiffInput, PropertyChange } from './types'

/**
 * Index info for a single property: what type of index covers it.
 */
interface PropertyIndexInfo {
  indexed: true
  indexType: 'btree' | 'fulltext' | 'unique'
}

/**
 * Build a map of property name → index info for a node or edge definition.
 * Checks the definition's indexes array to determine which properties are indexed.
 */
function buildPropertyIndexMap(
  indexes: readonly unknown[] | undefined,
): Map<string, PropertyIndexInfo> {
  const map = new Map<string, PropertyIndexInfo>()
  if (!indexes) return map

  for (const idx of indexes) {
    if (typeof idx === 'string') {
      // Simple string index → btree
      map.set(idx, { indexed: true, indexType: 'btree' })
    } else if (isSinglePropertyIndex(idx as IndexConfig)) {
      const si = idx as { property: string; type: 'btree' | 'fulltext' | 'unique' }
      map.set(si.property, { indexed: true, indexType: si.type })
    } else if (isCompositeIndex(idx as IndexConfig)) {
      const ci = idx as { properties: readonly string[]; type: 'btree' | 'unique' }
      for (const prop of ci.properties) {
        map.set(prop, { indexed: true, indexType: ci.type })
      }
    }
  }

  return map
}

/**
 * Compare properties of two entries, producing per-property changes with index info.
 */
function diffProperties(
  oldProps: Record<string, unknown>,
  newProps: Record<string, unknown>,
  indexMap: Map<string, PropertyIndexInfo>,
): PropertyChange[] {
  const changes: PropertyChange[] = []
  const allKeys = new Set([...Object.keys(oldProps), ...Object.keys(newProps)])

  for (const key of allKeys) {
    const oldVal = oldProps[key]
    const newVal = newProps[key]
    if (!deepEqual(oldVal, newVal)) {
      const info = indexMap.get(key)
      changes.push({
        property: key,
        oldValue: oldVal,
        newValue: newVal,
        indexed: info?.indexed ?? false,
        indexType: info?.indexType,
      })
    }
  }

  return changes
}

/** Normalized representation used internally by diffCore. */
interface NormalizedCore {
  nodes: Record<string, { kind: string; properties: Record<string, unknown> }>
  edges: readonly { kind: string; from: string; to: string; properties?: Record<string, unknown> }[]
}

/**
 * Normalize a CoreDiffInput to parsed properties for comparison.
 *
 * CoreDefinition: parse properties through its own schema (applies .default(), .transform()).
 * Falls back to raw properties if a kind is missing from the schema (should not happen
 * for validated definitions; the fallback avoids throwing in a pure comparison function).
 *
 * CoreSnapshot: already contains parsed properties, pass through as-is.
 * Returns direct references to the snapshot's objects (no defensive copy) —
 * callers must not mutate the returned NormalizedCore.
 *
 * Discriminant: `'config' in input` → CoreDefinition.
 */
function normalize(input: CoreDiffInput): NormalizedCore {
  if ('config' in input) {
    const def = input as AnyCoreDefinition
    const rawNodes = def.config.nodes as Record<
      string,
      { kind: string; properties: Record<string, unknown> }
    >
    const rawEdges = def.config.edges as unknown as readonly {
      kind: string
      from: string
      to: string
      properties?: Record<string, unknown>
    }[]

    const nodes: Record<string, { kind: string; properties: Record<string, unknown> }> = {}
    for (const [refKey, entry] of Object.entries(rawNodes)) {
      const nodeDef = def.schema.nodes[entry.kind]
      nodes[refKey] = {
        kind: entry.kind,
        properties: nodeDef ? nodeDef.properties.parse(entry.properties) : entry.properties,
      }
    }

    const edges = rawEdges.map((e) => {
      const edgeDef = def.schema.edges[e.kind]
      return {
        kind: e.kind,
        from: e.from,
        to: e.to,
        properties: edgeDef ? edgeDef.properties.parse(e.properties ?? {}) : (e.properties ?? {}),
      }
    })

    return { nodes, edges }
  }

  // CoreSnapshot — already contains parsed properties
  return {
    nodes: input.nodes as Record<string, { kind: string; properties: Record<string, unknown> }>,
    edges: input.edges,
  }
}

/**
 * Computes the diff between two Core states.
 *
 * Accepts CoreDefinition or CoreSnapshot for either side. CoreDefinition inputs
 * are normalized through Zod parse to match snapshot format (applies .default()
 * and .transform()), preventing phantom diffs from raw vs parsed mismatches.
 *
 * Node identity: ref key (the object key in the nodes record).
 * Edge identity: (kind, fromKey, toKey) tuple.
 *
 * Breaking changes: node removed, node kind changed, edge removed.
 * Non-breaking: node added, edge added, property value changes.
 * Warnings: indexed property value changes, duplicate edges in input.
 *
 * @param schema - The schema both inputs conform to. Must match the schema
 *   carried by any CoreDefinition inputs (used for index classification;
 *   normalization uses each CoreDefinition's own `.schema` for Zod parsing).
 * @param previous - The old state (CoreDefinition or CoreSnapshot)
 * @param current - The new state (CoreDefinition or CoreSnapshot)
 * @returns A CoreDiff describing all changes. Property values in the diff
 *   reference the normalized input objects — clone if persisting independently.
 */
export function diffCore(
  schema: AnySchema,
  previous: CoreDiffInput,
  current: CoreDiffInput,
): CoreDiff {
  const breakingReasons: string[] = []
  const warnings: string[] = []

  // Normalize both inputs to parsed properties
  const prev = normalize(previous)
  const curr = normalize(current)

  // --- Node diffing ---
  const prevNodes = prev.nodes
  const currNodes = curr.nodes

  const prevKeys = new Set(Object.keys(prevNodes))
  const currKeys = new Set(Object.keys(currNodes))

  const nodesAdded: { refKey: string; kind: string }[] = []
  const nodesRemoved: { refKey: string; kind: string }[] = []
  const nodesModified: { refKey: string; kind: string; changes: PropertyChange[] }[] = []
  const nodesKindChanged: { refKey: string; oldKind: string; newKind: string }[] = []

  // Added nodes
  for (const key of currKeys) {
    if (!prevKeys.has(key)) {
      nodesAdded.push({ refKey: key, kind: currNodes[key].kind })
    }
  }

  // Removed nodes
  for (const key of prevKeys) {
    if (!currKeys.has(key)) {
      nodesRemoved.push({ refKey: key, kind: prevNodes[key].kind })
      breakingReasons.push(`Node '${key}' (kind: '${prevNodes[key].kind}') was removed`)
    }
  }

  // Modified / kind-changed nodes
  for (const key of prevKeys) {
    if (!currKeys.has(key)) continue
    const prevNode = prevNodes[key]
    const currNode = currNodes[key]

    if (prevNode.kind !== currNode.kind) {
      nodesKindChanged.push({ refKey: key, oldKind: prevNode.kind, newKind: currNode.kind })
      breakingReasons.push(
        `Node '${key}' changed kind from '${prevNode.kind}' to '${currNode.kind}'`,
      )
    } else {
      // Same kind — diff properties
      const nodeDef = schema.nodes[prevNode.kind]
      const indexMap = buildPropertyIndexMap(nodeDef?.indexes)
      const changes = diffProperties(prevNode.properties, currNode.properties, indexMap)
      if (changes.length > 0) {
        nodesModified.push({ refKey: key, kind: prevNode.kind, changes })
        // Add warnings for indexed property changes
        for (const change of changes) {
          if (change.indexed) {
            warnings.push(
              `Indexed property '${change.property}' changed on node '${key}' ` +
                `(${change.indexType} index)`,
            )
          }
        }
      }
    }
  }

  // --- Edge diffing ---
  const prevEdges = prev.edges
  const currEdges = curr.edges

  // Edge identity: (kind, from, to) — JSON.stringify for unambiguous keys
  const edgeKey = (e: { kind: string; from: string; to: string }) =>
    JSON.stringify([e.kind, e.from, e.to])

  const prevEdgeMap = new Map<
    string,
    { kind: string; from: string; to: string; properties?: Record<string, unknown> }
  >()
  for (const e of prevEdges) {
    const k = edgeKey(e)
    if (prevEdgeMap.has(k)) {
      warnings.push(
        `Duplicate edge in previous: '${e.kind}' from '${e.from}' to '${e.to}' (last occurrence used)`,
      )
    }
    prevEdgeMap.set(k, e)
  }

  const currEdgeMap = new Map<
    string,
    { kind: string; from: string; to: string; properties?: Record<string, unknown> }
  >()
  for (const e of currEdges) {
    const k = edgeKey(e)
    if (currEdgeMap.has(k)) {
      warnings.push(
        `Duplicate edge in current: '${e.kind}' from '${e.from}' to '${e.to}' (last occurrence used)`,
      )
    }
    currEdgeMap.set(k, e)
  }

  const edgesAdded: { kind: string; fromKey: string; toKey: string }[] = []
  const edgesRemoved: { kind: string; fromKey: string; toKey: string }[] = []
  const edgesModified: {
    kind: string
    fromKey: string
    toKey: string
    changes: PropertyChange[]
  }[] = []

  // Added edges
  for (const [key, e] of currEdgeMap) {
    if (!prevEdgeMap.has(key)) {
      edgesAdded.push({ kind: e.kind, fromKey: e.from, toKey: e.to })
    }
  }

  // Removed edges
  for (const [key, e] of prevEdgeMap) {
    if (!currEdgeMap.has(key)) {
      edgesRemoved.push({ kind: e.kind, fromKey: e.from, toKey: e.to })
      breakingReasons.push(`Edge '${e.kind}' from '${e.from}' to '${e.to}' was removed`)
    }
  }

  // Modified edges (same identity, different properties)
  for (const [key, prevEdge] of prevEdgeMap) {
    const currEdge = currEdgeMap.get(key)
    if (!currEdge) continue

    const edgeDef = schema.edges[prevEdge.kind]
    const indexMap = buildPropertyIndexMap(edgeDef?.indexes)
    const changes = diffProperties(prevEdge.properties ?? {}, currEdge.properties ?? {}, indexMap)
    if (changes.length > 0) {
      edgesModified.push({
        kind: prevEdge.kind,
        fromKey: prevEdge.from,
        toKey: prevEdge.to,
        changes,
      })
      for (const change of changes) {
        if (change.indexed) {
          warnings.push(
            `Indexed property '${change.property}' changed on edge ` +
              `'${prevEdge.kind}' (${prevEdge.from} → ${prevEdge.to}) ` +
              `(${change.indexType} index)`,
          )
        }
      }
    }
  }

  return {
    nodes: {
      added: nodesAdded,
      removed: nodesRemoved,
      modified: nodesModified,
      kindChanged: nodesKindChanged,
    },
    edges: {
      added: edgesAdded,
      removed: edgesRemoved,
      modified: edgesModified,
    },
    breaking: breakingReasons.length > 0,
    breakingReasons,
    warnings,
  }
}
