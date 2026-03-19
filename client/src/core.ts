/**
 * Core Installation
 *
 * Installs genesis data (initial graph state) defined via the codegen `defineCore()` DSL.
 * Walks the core definition tree, creates nodes (with recursive children),
 * then creates edges resolving symbolic refs to actual node IDs.
 */

import type { Graph } from './graph'
import type { SchemaShape, TypeMap, UntypedMap } from './schema'
import type { NodeId } from './schema'

// ─── Core Definition Types (generic) ─────────────────────────
//
// These are structurally compatible with the per-schema types
// emitted by codegen (CoreNodeDef<T>, CoreEdgeDef<T>, CoreDefinition).

export interface CoreNodeDef {
  readonly __type: string
  readonly props: Record<string, unknown>
  readonly children?: Record<string, CoreNodeDef>
}

export interface CoreEdgeDef {
  readonly __type: string
  /** Named endpoint refs. Values are symbolic ref names (resolved from the refs map). */
  readonly endpoints: Record<string, string>
  readonly props?: Record<string, unknown>
}

export interface CoreDefinition {
  readonly nodes: Record<string, CoreNodeDef>
  readonly edges?: readonly CoreEdgeDef[]
}

// ─── Install Options ─────────────────────────────────────────

export interface InstallCoreOptions {
  /**
   * Transform node props before creation.
   * Use to inject server-generated defaults (e.g., timestamps).
   *
   * @example
   * beforeCreate: (type, props) => ({ createdAt: new Date().toISOString(), ...props })
   */
  beforeCreate?: (type: string, props: Record<string, unknown>) => Record<string, unknown>

  /**
   * Transform edge props before linking.
   */
  beforeLink?: (
    type: string,
    props: Record<string, unknown> | undefined,
  ) => Record<string, unknown> | undefined

  onNode?: (ref: string, type: string, id: string) => void
  onEdge?: (type: string, fromRef: string, toRef: string) => void
}

// ─── Result ──────────────────────────────────────────────────

/**
 * A tree of NodeIds mirroring the core definition structure.
 * Leaf nodes are NodeIds; parent nodes (with children) are nested CoreRefs.
 */
export interface CoreRefs {
  readonly [key: string]: NodeId | CoreRefs
}

export interface InstallCoreResult {
  /** Core refs tree — mirrors the core definition hierarchy */
  core: CoreRefs
  created: { nodes: number; edges: number }
}

// ─── Implementation ──────────────────────────────────────────

/**
 * Install genesis data into a graph from a core definition.
 *
 * 1. Recursively creates nodes (depth-first, children after parent).
 * 2. Creates edges, resolving symbolic ref names to actual node IDs.
 *
 * @returns Core refs tree and creation counts.
 */
export async function installCore<S extends SchemaShape, T extends TypeMap = UntypedMap>(
  graph: Graph<S, T>,
  core: CoreDefinition,
  options: InstallCoreOptions = {},
): Promise<InstallCoreResult> {
  const { beforeCreate, beforeLink, onNode, onEdge } = options
  // Flat map — internal only, used for edge resolution
  const flatRefs: Record<string, string> = {}
  const coreRefs: Record<string, NodeId | CoreRefs> = {}
  let nodeCount = 0
  let edgeCount = 0

  async function createNodes(
    nodes: Record<string, CoreNodeDef>,
    parent: Record<string, NodeId | CoreRefs> = coreRefs,
  ): Promise<void> {
    for (const [ref, def] of Object.entries(nodes)) {
      const props = beforeCreate ? beforeCreate(def.__type, { ...def.props }) : def.props

      // Cast through any — the core DSL already validates types at definition time.
      // oxlint-disable-next-line no-explicit-any
      const result = await (graph.mutate as any).create(def.__type, props)
      const nodeId = result.id

      flatRefs[ref] = nodeId
      nodeCount++
      onNode?.(ref, def.__type, nodeId)

      if (def.children) {
        const children: Record<string, NodeId | CoreRefs> = {}
        parent[ref] = children
        await createNodes(def.children, children)
      } else {
        parent[ref] = nodeId
      }
    }
  }

  await createNodes(core.nodes)

  if (core.edges) {
    for (const edgeDef of core.edges) {
      const endpointValues = Object.values(edgeDef.endpoints)
      const fromRef = endpointValues[0]!
      const toRef = endpointValues[1]!

      const fromId = flatRefs[fromRef] ?? fromRef
      const toId = flatRefs[toRef] ?? toRef

      const edgeProps = beforeLink
        ? beforeLink(edgeDef.__type, edgeDef.props ? { ...edgeDef.props } : undefined)
        : edgeDef.props

      // oxlint-disable-next-line no-explicit-any
      await (graph.mutate as any).link(edgeDef.__type, fromId, toId, edgeProps)
      edgeCount++
      onEdge?.(edgeDef.__type, fromRef, toRef)
    }
  }

  return { core: coreRefs, created: { nodes: nodeCount, edges: edgeCount } }
}
