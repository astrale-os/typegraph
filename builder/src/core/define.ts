import type { Schema } from '../schema/schema.js'
import type {
  CoreNode,
  CoreEdge,
  CoreDef,
  PathTree,
  CoreNodeEntry,
  CoreEdgeEntry,
} from './types.js'
import type { CorePath } from './path.js'
import { buildCorePath, isCorePath } from './path.js'

/**
 * Define the core (genesis) data for a domain.
 *
 * Returns an object whose top-level keys are CorePath values matching the
 * node tree structure, plus metadata (__nodes, __edges, schema, domain).
 *
 * @example
 * const core = defineCore(EcommerceSchema, {
 *   nodes: {
 *     electronics: node(Category, { name: 'Electronics' }, {
 *       laptop: node(Product, { title: 'Laptop Pro' }),
 *     }),
 *     clothing: node(Category, { name: 'Clothing' }),
 *   },
 *   edges: [
 *     edge(laptop, 'inCategory', electronics),
 *   ],
 * })
 *
 * core.electronics              // CorePath "/example.e-commerce/electronics"
 * core.electronics.laptop       // CorePath "/example.e-commerce/electronics/laptop"
 */
// oxlint-disable-next-line no-explicit-any
export function defineCore<
  S extends Schema,
  const Nodes extends Record<string, CoreNode<any, any>>,
>(
  schema: S,
  config: { nodes: Nodes; edges?: readonly CoreEdge[] },
): CoreDef<S, PathTree<Nodes>> & PathTree<Nodes> {
  const domain = schema.domain
  const nodeToPath = new Map<CoreNode, CorePath>()
  const flatNodes: CoreNodeEntry[] = []

  // Recursively walk the node tree, build CorePath for each, collect flat list
  function walkNodes(
    nodes: Record<string, CoreNode>,
    parentSlugs: string[],
    parentPath: CorePath | undefined,
    result: Record<string, unknown>,
  ): void {
    for (const [key, coreNode] of Object.entries(nodes)) {
      const slugs = [...parentSlugs, key]
      const nodePath = buildCorePath(domain, slugs)
      nodeToPath.set(coreNode, nodePath)
      flatNodes.push({
        path: nodePath,
        def: coreNode.__nodeDef,
        data: coreNode.__data,
        parent: parentPath,
      })

      const children = coreNode.__children as Record<string, CoreNode>
      const hasChildren = Object.keys(children).length > 0

      if (hasChildren) {
        // Parent node: CorePath instance with child properties attached
        const childPaths: Record<string, unknown> = {}
        walkNodes(children, slugs, nodePath, childPaths)
        // Attach child paths as properties on the CorePath instance
        for (const [childKey, childPath] of Object.entries(childPaths)) {
          Object.defineProperty(nodePath, childKey, {
            value: childPath,
            enumerable: true,
            configurable: false,
            writable: false,
          })
        }
        result[key] = nodePath
      } else {
        result[key] = nodePath
      }
    }
  }

  const pathTree: Record<string, unknown> = {}
  walkNodes(config.nodes, [], undefined, pathTree)

  // Resolve edges
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
    domain,
    __nodes: flatNodes,
    __edges: flatEdges,
  }) as CoreDef<S, PathTree<Nodes>> & PathTree<Nodes>
}

function resolveNodeOrPath(
  target: CoreNode | CorePath,
  nodeToPath: Map<CoreNode, CorePath>,
): CorePath {
  if (isCorePath(target)) return target
  const p = nodeToPath.get(target as CoreNode)
  if (!p)
    throw new Error('CoreNode not found in this core definition — was it declared in `nodes`?')
  return p
}
