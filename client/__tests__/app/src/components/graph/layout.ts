import type { Node, Edge } from 'reactflow'

import dagre from 'dagre'

const NODE_WIDTH = 160
const NODE_HEIGHT = 50

export function getLayoutedElements(
  nodes: Node[],
  displayEdges: Edge[],
  layoutEdges?: Edge[],
  direction: 'TB' | 'LR' = 'TB',
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80 })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }

  // Use layoutEdges (structural only) for position computation if provided
  for (const edge of layoutEdges ?? displayEdges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id)
    return {
      ...node,
      position: {
        x: pos.x - NODE_WIDTH / 2,
        y: pos.y - NODE_HEIGHT / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges: displayEdges }
}
