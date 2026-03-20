import type { Schema } from '../schema/schema.js'
import type { CoreNode, CoreEdge, CoreDef, PathTree, CoreNodeEntry, CoreEdgeEntry } from '../core/types.js'
import { buildCorePath, isCorePath, type CorePath } from '../core/path.js'

export interface SeedDef<
  S extends Schema = Schema,
  C extends CoreDef = CoreDef,
  _Paths extends Record<string, any> = Record<string, CorePath>,
> {
  readonly schema: S
  readonly core: C
  readonly domain: string
  readonly __nodes: readonly CoreNodeEntry[]
  readonly __edges: readonly CoreEdgeEntry[]
}

/**
 * Define seed data that extends a core definition.
 *
 * Seed nodes are flat (no nesting). Edges can reference core paths.
 *
 * @example
 * const seed = defineSeed(EcommerceSchema, core, {
 *   nodes: { alice: node(Customer, { email: 'alice@ex.com' }) },
 *   edges: [
 *     edge(alice, 'placedOrder', order1),
 *     edge(order1, 'orderItem', core.electronics.laptop, { quantity: 2 }),
 *   ],
 * })
 *
 * seed.alice  // CorePath "/example.e-commerce/alice"
 */
export function defineSeed<
  S extends Schema,
  C extends CoreDef<S>,
  const Nodes extends Record<string, CoreNode>,
>(
  schema: S,
  core: C,
  config: { nodes: Nodes; edges?: readonly CoreEdge[] },
): SeedDef<S, C, PathTree<Nodes>> & PathTree<Nodes> {
  const domain = schema.domain
  const nodeToPath = new Map<CoreNode, CorePath>()
  const flatNodes: CoreNodeEntry[] = []

  // Seed nodes are flat — all live directly under the domain
  const pathTree: Record<string, any> = {}
  for (const [key, coreNode] of Object.entries(config.nodes)) {
    const nodePath = buildCorePath(domain, [key])
    nodeToPath.set(coreNode, nodePath)
    flatNodes.push({ path: nodePath, def: coreNode.__nodeDef, data: coreNode.__data })
    pathTree[key] = nodePath
  }

  // Resolve edges — targets can be seed nodes or core paths
  const flatEdges: CoreEdgeEntry[] = []
  if (config.edges) {
    for (const e of config.edges) {
      const fromPath = resolveNodeOrPath(e.__from, nodeToPath)
      const toPath = resolveNodeOrPath(e.__to, nodeToPath)
      flatEdges.push({ from: fromPath, edge: e.__edge, to: toPath, data: e.__data })
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

function resolveNodeOrPath(target: CoreNode | CorePath, nodeToPath: Map<CoreNode, CorePath>): CorePath {
  if (isCorePath(target)) return target
  const p = nodeToPath.get(target as CoreNode)
  if (!p) throw new Error('CoreNode not found in this seed definition — was it declared in `nodes`?')
  return p
}
