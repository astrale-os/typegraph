import type { Schema } from '../../schema/schema.js'
import type {
  CoreNode,
  CoreEdge,
  Core,
  PathTree,
  CoreNodeEntry,
  CoreEdgeEntry,
} from '../core/types.js'
import type { SeedDef } from './types.js'

import { buildCorePath, isCorePath, type CorePath } from '../core/path.js'

/**
 * Define seed data that extends a core definition.
 * Seed nodes are flat (no nesting). Edges can reference core paths.
 */
export function defineSeed<
  S extends Schema,
  C extends Core<S>,
  const Nodes extends Record<string, CoreNode>,
>(
  schema: S,
  core: C,
  config: { nodes: Nodes; edges?: readonly CoreEdge[] },
): SeedDef<S, C, PathTree<Nodes>> & PathTree<Nodes> {
  const domain = schema.domain
  const nodeToPath = new Map<CoreNode, CorePath>()
  const flatNodes: CoreNodeEntry[] = []

  const pathTree: Record<string, unknown> = {}
  for (const [key, coreNode] of Object.entries(config.nodes)) {
    const nodePath = buildCorePath(domain, [key])
    nodeToPath.set(coreNode, nodePath)
    flatNodes.push({ path: nodePath, def: coreNode.__nodeDef, data: coreNode.__data })
    pathTree[key] = nodePath
  }

  const flatEdges: CoreEdgeEntry[] = []
  if (config.edges) {
    for (const e of config.edges) {
      const fromPath = resolveNodeOrPath(e.__from, nodeToPath)
      const toPath = resolveNodeOrPath(e.__to, nodeToPath)
      flatEdges.push({ from: fromPath, edge: e.__edgeDef, to: toPath, data: e.__data })
    }
  }

  return Object.assign(pathTree, {
    schema,
    core,
    domain,
    __nodes: flatNodes,
    __edges: flatEdges,
  }) as SeedDef<S, C, PathTree<Nodes>> & PathTree<Nodes>
}

function resolveNodeOrPath(
  target: CoreNode | CorePath,
  nodeToPath: Map<CoreNode, CorePath>,
): CorePath {
  if (isCorePath(target)) return target
  const p = nodeToPath.get(target as CoreNode)
  if (!p)
    throw new Error('CoreNode not found in this seed definition — was it declared in `nodes`?')
  return p
}
