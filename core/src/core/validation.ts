/**
 * Core Definition Validation
 *
 * Validates Core node and edge instances against the schema at definition time.
 * Uses the same SchemaValidationError pattern as schema/builders.ts.
 */

import type { AnySchema } from '../schema/types'

import { SchemaValidationError } from '../errors'
import { getNodesSatisfying } from '../schema/labels'

/**
 * Validates all node entries in a Core definition.
 *
 * Checks:
 * - `kind` is a valid node label in the schema
 * - `properties` pass Zod safeParse against the node's merged schema
 */
export function validateCoreNodes(
  schema: AnySchema,
  nodes: Record<string, { kind: string; properties: Record<string, unknown> }>,
): void {
  const validKinds = new Set(Object.keys(schema.nodes))

  for (const [refKey, entry] of Object.entries(nodes)) {
    if (!validKinds.has(entry.kind)) {
      throw new SchemaValidationError(
        `Core node '${refKey}' has kind '${entry.kind}' which does not exist in schema. ` +
          `Available: ${[...validKinds].join(', ')}`,
        'kind',
        [...validKinds].join(', '),
        entry.kind,
      )
    }

    const nodeDef = schema.nodes[entry.kind]
    const result = nodeDef.properties.safeParse(entry.properties)
    if (!result.success) {
      const issues = result.error.issues
        .map(
          (i: { path: (string | number)[]; message: string }) =>
            `${i.path.join('.')}: ${i.message}`,
        )
        .join('; ')
      throw new SchemaValidationError(
        `Core node '${refKey}' (kind: '${entry.kind}') has invalid properties: ${issues}`,
        'properties',
      )
    }
  }
}

/**
 * Validates all edge entries in a Core definition.
 *
 * Checks:
 * - `kind` is a valid edge type in the schema
 * - `from`/`to` reference existing node keys
 * - `from`/`to` node kinds match the edge's endpoint types (with label inheritance)
 * - `properties` pass Zod safeParse against the edge's schema
 */
export function validateCoreEdges(
  schema: AnySchema,
  edges: readonly {
    kind: string
    from: string
    to: string
    properties?: Record<string, unknown>
  }[],
  nodeKeyToKind: Map<string, string>,
): void {
  const validEdgeKinds = new Set(Object.keys(schema.edges))
  const nodeKeys = [...nodeKeyToKind.keys()]

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i]
    const ctx = `Core edge[${i}] (kind: '${edge.kind}', from: '${edge.from}', to: '${edge.to}')`

    // Validate kind exists
    if (!validEdgeKinds.has(edge.kind)) {
      throw new SchemaValidationError(
        `${ctx} has kind '${edge.kind}' which does not exist in schema. ` +
          `Available: ${[...validEdgeKinds].join(', ')}`,
        'kind',
        [...validEdgeKinds].join(', '),
        edge.kind,
      )
    }

    // Validate from key exists
    if (!nodeKeyToKind.has(edge.from)) {
      throw new SchemaValidationError(
        `${ctx} references non-existent source node '${edge.from}'. ` +
          `Available node keys: ${nodeKeys.join(', ')}`,
        'from',
        nodeKeys.join(', '),
        edge.from,
      )
    }

    // Validate to key exists
    if (!nodeKeyToKind.has(edge.to)) {
      throw new SchemaValidationError(
        `${ctx} references non-existent target node '${edge.to}'. ` +
          `Available node keys: ${nodeKeys.join(', ')}`,
        'to',
        nodeKeys.join(', '),
        edge.to,
      )
    }

    // Validate from node kind matches edge's from endpoint (with label inheritance)
    const edgeDef = schema.edges[edge.kind]
    const fromKind = nodeKeyToKind.get(edge.from)!
    const allowedFromLabels = Array.isArray(edgeDef.from)
      ? (edgeDef.from as readonly string[])
      : [edgeDef.from as string]
    const satisfyingFromKinds = new Set(
      allowedFromLabels.flatMap((label) => getNodesSatisfying(schema, label)),
    )
    if (!satisfyingFromKinds.has(fromKind)) {
      throw new SchemaValidationError(
        `${ctx} has source node '${edge.from}' of kind '${fromKind}', ` +
          `but edge '${edge.kind}' requires from: ${allowedFromLabels.join(' | ')}`,
        'from',
        allowedFromLabels.join(' | '),
        fromKind,
      )
    }

    // Validate to node kind matches edge's to endpoint (with label inheritance)
    const toKind = nodeKeyToKind.get(edge.to)!
    const allowedToLabels = Array.isArray(edgeDef.to)
      ? (edgeDef.to as readonly string[])
      : [edgeDef.to as string]
    const satisfyingToKinds = new Set(
      allowedToLabels.flatMap((label) => getNodesSatisfying(schema, label)),
    )
    if (!satisfyingToKinds.has(toKind)) {
      throw new SchemaValidationError(
        `${ctx} has target node '${edge.to}' of kind '${toKind}', ` +
          `but edge '${edge.kind}' requires to: ${allowedToLabels.join(' | ')}`,
        'to',
        allowedToLabels.join(' | '),
        toKind,
      )
    }

    // Validate edge properties
    const props = edge.properties ?? {}
    const propResult = edgeDef.properties.safeParse(props)
    if (!propResult.success) {
      const issues = propResult.error.issues
        .map(
          (i: { path: (string | number)[]; message: string }) =>
            `${i.path.join('.')}: ${i.message}`,
        )
        .join('; ')
      throw new SchemaValidationError(`${ctx} has invalid properties: ${issues}`, 'properties')
    }
  }
}

/**
 * Validates cardinality constraints across all edges.
 *
 * For `'one'` and `'optional'` cardinalities, checks that at most one edge
 * of that type exists per source/target node. Upper bound only — the genesis
 * state doesn't enforce required-ness.
 */
export function validateCardinality(
  schema: AnySchema,
  edges: readonly { kind: string; from: string; to: string }[],
): void {
  // Group edges by kind
  const edgesByKind = new Map<string, { from: string; to: string }[]>()
  for (const edge of edges) {
    const group = edgesByKind.get(edge.kind) ?? []
    group.push({ from: edge.from, to: edge.to })
    edgesByKind.set(edge.kind, group)
  }

  for (const [kind, kindEdges] of edgesByKind) {
    const edgeDef = schema.edges[kind]
    if (!edgeDef) continue // already validated in validateCoreEdges

    const { outbound, inbound } = edgeDef.cardinality

    // Check outbound: at most one edge per source node
    if (outbound === 'one' || outbound === 'optional') {
      const fromCounts = new Map<string, number>()
      for (const e of kindEdges) {
        fromCounts.set(e.from, (fromCounts.get(e.from) ?? 0) + 1)
      }
      for (const [fromKey, count] of fromCounts) {
        if (count > 1) {
          throw new SchemaValidationError(
            `Cardinality violation: edge '${kind}' has outbound '${outbound}' ` +
              `but node '${fromKey}' has ${count} outgoing edges of this type (max 1)`,
            'cardinality.outbound',
            'at most 1',
            String(count),
          )
        }
      }
    }

    // Check inbound: at most one edge per target node
    if (inbound === 'one' || inbound === 'optional') {
      const toCounts = new Map<string, number>()
      for (const e of kindEdges) {
        toCounts.set(e.to, (toCounts.get(e.to) ?? 0) + 1)
      }
      for (const [toKey, count] of toCounts) {
        if (count > 1) {
          throw new SchemaValidationError(
            `Cardinality violation: edge '${kind}' has inbound '${inbound}' ` +
              `but node '${toKey}' has ${count} incoming edges of this type (max 1)`,
            'cardinality.inbound',
            'at most 1',
            String(count),
          )
        }
      }
    }
  }
}

/**
 * Validates that no two edges share the same (kind, from, to) tuple.
 *
 * The genesis state identifies edges by their tuple — for many:many cardinality,
 * distinct relationships between the same pair require different edge types.
 * Fail-fast: throws on the first duplicate found.
 */
export function validateEdgeTupleUniqueness(
  edges: readonly { kind: string; from: string; to: string }[],
): void {
  const seen = new Set<string>()
  for (const edge of edges) {
    const key = JSON.stringify([edge.kind, edge.from, edge.to])
    if (seen.has(key)) {
      throw new SchemaValidationError(
        `Duplicate edge tuple: edge '${edge.kind}' from '${edge.from}' to '${edge.to}' appears more than once`,
        'edges',
      )
    }
    seen.add(key)
  }
}
