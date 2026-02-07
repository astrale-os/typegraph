/**
 * Core Definition Builder
 *
 * Provides defineCore() — the declarative API for defining the Core (genesis state).
 * Validates eagerly at definition time.
 */

import type { AnySchema } from '../schema/types'
import type { CoreDefinition, CoreNodeEntry, CoreEdgeEntry, AnyCoreDefinition, CoreSnapshot } from './types'
import { SchemaValidationError } from '../errors'
import { validateCoreNodes, validateCoreEdges, validateCardinality, validateEdgeTupleUniqueness } from './validation'

/**
 * Core configuration — what the developer passes to defineCore().
 */
export interface CoreConfig<S extends AnySchema, TNodes extends Record<string, CoreNodeEntry<S>>> {
  readonly nodes: TNodes
  readonly edges: CoreEdgeEntry<S, Extract<keyof TNodes, string>>[]
}

/**
 * Creates a validated Core definition — the genesis state blueprint.
 *
 * - Nodes are a named record: keys become ref names, `kind` narrows `properties`
 * - Edges are an anonymous array referencing node keys
 * - No IDs — IDs come from the database at materialization
 * - Validated eagerly: invalid definitions throw SchemaValidationError
 *
 * @example
 * ```typescript
 * const core = defineCore(schema, {
 *   nodes: {
 *     admin: { kind: 'user', properties: { email: 'admin@ex.com', name: 'Admin' } },
 *     defaultSpace: { kind: 'space', properties: { name: 'Default' } },
 *   },
 *   edges: [
 *     { kind: 'owns', from: 'admin', to: 'defaultSpace' },
 *   ],
 * })
 * ```
 *
 * @throws SchemaValidationError with descriptive messages
 */
export function defineCore<
  S extends AnySchema,
  const TNodes extends Record<string, CoreNodeEntry<S>>,
>(schema: S, config: CoreConfig<S, TNodes>): CoreDefinition<S, TNodes> {
  const nodesRecord = config.nodes as Record<
    string,
    { kind: string; properties: Record<string, unknown> }
  >
  const edgesArray = config.edges as unknown as readonly {
    kind: string
    from: string
    to: string
    properties?: Record<string, unknown>
  }[]

  // Validate nodes
  validateCoreNodes(schema, nodesRecord)

  // Build node key → kind map for edge validation
  const nodeKeyToKind = new Map<string, string>()
  for (const [refKey, entry] of Object.entries(nodesRecord)) {
    nodeKeyToKind.set(refKey, entry.kind)
  }

  // Validate edges
  validateCoreEdges(schema, edgesArray, nodeKeyToKind)

  // Validate cardinality constraints
  validateCardinality(schema, edgesArray)

  // Validate edge tuple uniqueness
  validateEdgeTupleUniqueness(edgesArray)

  return {
    schema,
    config: {
      nodes: config.nodes,
      edges: config.edges,
    },
  }
}

/**
 * Creates a serializable snapshot from a CoreDefinition.
 *
 * Runs Zod `.parse()` on every node/edge property set to produce deterministic
 * output (with `.default()` and `.transform()` applied), then `structuredClone()`
 * to fully detach from input references.
 *
 * The resulting snapshot is suitable for DB storage and diffing.
 *
 * @throws SchemaValidationError if a node/edge kind is not in the schema
 */
export function toCoreSnapshot(core: AnyCoreDefinition): CoreSnapshot {
  const nodesRecord = core.config.nodes as Record<
    string,
    { kind: string; properties: Record<string, unknown> }
  >
  const edgesArray = core.config.edges as unknown as readonly {
    kind: string
    from: string
    to: string
    properties?: Record<string, unknown>
  }[]

  const nodes: Record<string, { kind: string; properties: Record<string, unknown> }> = {}
  for (const [refKey, entry] of Object.entries(nodesRecord)) {
    const nodeDef = core.schema.nodes[entry.kind]
    if (!nodeDef) {
      throw new SchemaValidationError(
        `Cannot snapshot: node '${refKey}' has kind '${entry.kind}' which does not exist in schema`,
        'kind',
      )
    }
    nodes[refKey] = {
      kind: entry.kind,
      properties: structuredClone(nodeDef.properties.parse(entry.properties)),
    }
  }

  const edges = edgesArray.map((edge) => {
    const edgeDef = core.schema.edges[edge.kind]
    if (!edgeDef) {
      throw new SchemaValidationError(
        `Cannot snapshot: edge kind '${edge.kind}' does not exist in schema`,
        'kind',
      )
    }
    const parsed = edgeDef.properties.parse(edge.properties ?? {})
    const hasProperties = Object.keys(parsed).length > 0
    return {
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
      ...(hasProperties ? { properties: structuredClone(parsed) } : {}),
    }
  })

  return { nodes, edges }
}
