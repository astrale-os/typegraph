/**
 * Schema Bootstrap — Meta-Model Materialization
 *
 * Materializes the kernel meta-model in the graph from a SchemaShape:
 * class nodes, interface nodes, implements/extends/hasParent edges.
 *
 * Class/Interface node IDs are auto-generated (UUID-based).
 * Idempotency via MERGE on the `key` property.
 *
 * See: specs/11-schema-bootstrap.md
 */

import type { SchemaShape } from './schema'
import type { GraphAdapter } from './adapter'
import { STRUCTURAL_EDGES, META_LABELS } from './compiler/passes/structural-edges'
import { isReified } from './helpers'
import { defaultIdGenerator } from './mutation/types'

// =============================================================================
// TYPES
// =============================================================================

export interface BootstrapOptions {
  /** Callback per node created/matched. */
  onNode?: (kind: 'class' | 'interface', key: string, id: string) => void
  /** Callback per edge created. */
  onEdge?: (
    type: 'implements' | 'extends' | 'has_parent',
    fromKey: string,
    toKey: string,
  ) => void
}

export interface BootstrapResult {
  /** Map of type key → node ID for every class and interface node. */
  refs: Record<string, string>
  /** Map of interface key → class node IDs that satisfy it (transitively). */
  implementors: Record<string, string[]>
  /** Summary stats. */
  stats: {
    classesCreated: number
    interfacesCreated: number
    implementsEdges: number
    extendsEdges: number
    hasParentEdges: number
  }
}

// =============================================================================
// BOOTSTRAP
// =============================================================================

/**
 * Bootstrap meta-model nodes into the graph.
 *
 * Creates `:Node:Class` and `:Node:Interface` nodes via MERGE on `key`,
 * wires `implements`, `extends`, and `has_parent` structural edges.
 * Returns refs + implementors for InstanceModelConfig.
 *
 * Idempotent — safe to call on every startup.
 * Total: 5 batched Cypher queries regardless of schema size.
 */
export async function bootstrapSchema(
  schema: SchemaShape,
  adapter: GraphAdapter,
  rootId: string,
  options?: BootstrapOptions,
): Promise<BootstrapResult> {
  // ── Phase 1: Collect types ─────────────────────────────────
  const classes: { key: string; type: 'node' | 'link'; implements: string[] }[] = []
  const interfaces: { key: string; implements: string[] }[] = []

  for (const [name, def] of Object.entries(schema.nodes)) {
    if (def.abstract) {
      interfaces.push({ key: name, implements: [...(def.implements ?? [])] })
    } else {
      classes.push({ key: name, type: 'node', implements: [...(def.implements ?? [])] })
    }
  }

  // Reified edges become link-classes in the same list
  for (const [edgeType] of Object.entries(schema.edges)) {
    if (isReified(schema, edgeType)) {
      classes.push({ key: edgeType, type: 'link', implements: [] })
    }
  }

  // ── Phase 2: MERGE nodes, collect IDs ──────────────────────
  const classResults = await adapter.mutate<{ key: string; id: string }>(
    BATCH_MERGE_CLASSES,
    {
      items: classes.map((c) => ({
        key: c.key,
        type: c.type,
        newId: defaultIdGenerator.generate('Class'),
      })),
    },
  )

  const interfaceResults = await adapter.mutate<{ key: string; id: string }>(
    BATCH_MERGE_INTERFACES,
    {
      items: interfaces.map((i) => ({
        key: i.key,
        newId: defaultIdGenerator.generate('Interface'),
      })),
    },
  )

  // ── Phase 3: Build refs map ────────────────────────────────
  const refs: Record<string, string> = {}

  for (const row of classResults) {
    refs[row.key] = row.id
    options?.onNode?.('class', row.key, row.id)
  }

  for (const row of interfaceResults) {
    refs[row.key] = row.id
    options?.onNode?.('interface', row.key, row.id)
  }

  // ── Phase 4: Create structural edges ───────────────────────
  const implementsEdges: { classKey: string; interfaceKey: string }[] = []
  const extendsEdges: { childKey: string; parentKey: string }[] = []

  for (const cls of classes) {
    for (const ifaceName of cls.implements) {
      implementsEdges.push({ classKey: cls.key, interfaceKey: ifaceName })
    }
  }

  for (const iface of interfaces) {
    for (const parentName of iface.implements) {
      extendsEdges.push({ childKey: iface.key, parentKey: parentName })
    }
  }

  if (implementsEdges.length > 0) {
    await adapter.mutate(BATCH_MERGE_IMPLEMENTS, { edges: implementsEdges })
    for (const e of implementsEdges) {
      options?.onEdge?.('implements', e.classKey, e.interfaceKey)
    }
  }

  if (extendsEdges.length > 0) {
    await adapter.mutate(BATCH_MERGE_EXTENDS, { edges: extendsEdges })
    for (const e of extendsEdges) {
      options?.onEdge?.('extends', e.childKey, e.parentKey)
    }
  }

  // ── Phase 5: Create hasParent edges ────────────────────────
  const allKeys = [...classes.map((c) => c.key), ...interfaces.map((i) => i.key)]

  if (allKeys.length > 0) {
    await adapter.mutate(BATCH_MERGE_HAS_PARENT, {
      items: allKeys.map((key) => ({ key })),
      rootId,
    })
    for (const key of allKeys) {
      options?.onEdge?.('has_parent', key, rootId)
    }
  }

  // ── Phase 6: Compute implementors ─────────────────────────
  const implementors = computeImplementors(classes, interfaces, refs)

  return {
    refs,
    implementors,
    stats: {
      classesCreated: classes.length,
      interfacesCreated: interfaces.length,
      implementsEdges: implementsEdges.length,
      extendsEdges: extendsEdges.length,
      hasParentEdges: allKeys.length,
    },
  }
}

// =============================================================================
// IMPLEMENTORS COMPUTATION (pure)
// =============================================================================

function computeImplementors(
  classes: { key: string; implements: string[] }[],
  interfaces: { key: string; implements: string[] }[],
  refs: Record<string, string>,
): Record<string, string[]> {
  // Build extends DAG: interface → parent interfaces (transitive)
  const extendsMap = new Map<string, Set<string>>()
  for (const iface of interfaces) {
    extendsMap.set(iface.key, new Set(iface.implements))
  }

  // Transitively expand extends
  function allAncestors(name: string, visited = new Set<string>()): Set<string> {
    if (visited.has(name)) return new Set()
    visited.add(name)
    const result = new Set<string>([name])
    const parents = extendsMap.get(name)
    if (parents) {
      for (const parent of parents) {
        for (const ancestor of allAncestors(parent, visited)) {
          result.add(ancestor)
        }
      }
    }
    return result
  }

  // For each interface, collect all class node IDs that satisfy it
  const implementors: Record<string, string[]> = {}

  for (const iface of interfaces) {
    implementors[iface.key] = []
  }

  for (const cls of classes) {
    const classNodeId = refs[cls.key]
    if (!classNodeId) continue

    const satisfiedInterfaces = new Set<string>()
    for (const directIface of cls.implements) {
      for (const ancestor of allAncestors(directIface)) {
        satisfiedInterfaces.add(ancestor)
      }
    }

    for (const ifaceKey of satisfiedInterfaces) {
      implementors[ifaceKey] ??= []
      implementors[ifaceKey].push(classNodeId)
    }
  }

  return implementors
}

// =============================================================================
// BATCH CYPHER QUERIES
// =============================================================================

const N = META_LABELS.NODE
const C = META_LABELS.CLASS
const I = META_LABELS.INTERFACE

const BATCH_MERGE_CLASSES = [
  'UNWIND $items AS cls',
  `MERGE (n:${N}:${C} {key: cls.key})`,
  'ON CREATE SET n.id = cls.newId, n.type = cls.type',
  'ON MATCH SET n.type = cls.type',
  'RETURN n.key AS key, n.id AS id',
].join('\n')

const BATCH_MERGE_INTERFACES = [
  'UNWIND $items AS iface',
  `MERGE (n:${N}:${I} {key: iface.key})`,
  'ON CREATE SET n.id = iface.newId',
  'RETURN n.key AS key, n.id AS id',
].join('\n')

const BATCH_MERGE_IMPLEMENTS = [
  'UNWIND $edges AS edge',
  `MATCH (c:${N}:${C} {key: edge.classKey})`,
  `MATCH (i:${N}:${I} {key: edge.interfaceKey})`,
  `MERGE (c)-[:${STRUCTURAL_EDGES.IMPLEMENTS}]->(i)`,
].join('\n')

const BATCH_MERGE_EXTENDS = [
  'UNWIND $edges AS edge',
  `MATCH (child:${N}:${I} {key: edge.childKey})`,
  `MATCH (parent:${N}:${I} {key: edge.parentKey})`,
  `MERGE (child)-[:${STRUCTURAL_EDGES.EXTENDS}]->(parent)`,
].join('\n')

const BATCH_MERGE_HAS_PARENT = [
  'UNWIND $items AS item',
  `MATCH (n {key: item.key}) WHERE n:${C} OR n:${I}`,
  'MATCH (root {id: $rootId})',
  `MERGE (n)-[:${STRUCTURAL_EDGES.HAS_PARENT}]->(root)`,
].join('\n')
