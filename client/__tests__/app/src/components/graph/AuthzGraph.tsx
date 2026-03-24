import 'reactflow/dist/style.css'
import { useCallback, useEffect, useMemo } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  MarkerType,
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from 'reactflow'

import { useGraphStore } from '@/store/graph-store'
import { EDGE_COLORS, NODE_COLORS, type EdgeType, type NodeType } from '@/types/graph'

import { EdgeFilters } from './EdgeFilters'
import { getLayoutedElements } from './layout'
import { IdentityNode } from './nodes/IdentityNode'
import { ModuleNode } from './nodes/ModuleNode'
import { RootNode } from './nodes/RootNode'
import { SpaceNode } from './nodes/SpaceNode'
import { TypeNode } from './nodes/TypeNode'

const nodeTypes = {
  Root: RootNode,
  Space: SpaceNode,
  Module: ModuleNode,
  Type: TypeNode,
  Identity: IdentityNode,
}

function edgeLabel(type: EdgeType, properties: Record<string, unknown>): string {
  if (type === 'hasPerm' && Array.isArray(properties.perms))
    return `hasPerm(${(properties.perms as string[]).join(', ')})`
  return type
}

// Edge types that represent relationships (shown on node click)
const RELATIONSHIP_EDGE_TYPES: EdgeType[] = ['hasPerm', 'unionWith', 'intersectWith', 'excludeWith']

function GraphCanvas() {
  const graphNodes = useGraphStore((s) => s.nodes)
  const graphEdges = useGraphStore((s) => s.edges)
  const highlightedPaths = useGraphStore((s) => s.highlightedPaths)
  const visibleEdgeTypes = useGraphStore((s) => s.visibleEdgeTypes)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const setSelectedNode = useGraphStore((s) => s.setSelectedNode)

  // Build module → type name map from ofType edges
  const moduleTypeMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of graphEdges) {
      if (e.type === 'ofType') {
        map.set(e.sourceId, e.targetId)
      }
    }
    return map
  }, [graphEdges])

  const highlightedNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const path of highlightedPaths) {
      for (const id of path) ids.add(id)
    }
    return ids
  }, [highlightedPaths])

  // Contextual edges: relationship edges connected to the selected node
  const contextualEdges = useMemo(() => {
    if (!selectedNodeId) return []
    return graphEdges.filter(
      (e) =>
        RELATIONSHIP_EDGE_TYPES.includes(e.type) &&
        (e.sourceId === selectedNodeId || e.targetId === selectedNodeId),
    )
  }, [graphEdges, selectedNodeId])

  // Node IDs connected to the selected node via contextual edges
  const contextualNodeIds = useMemo(() => {
    const ids = new Set<string>()
    if (selectedNodeId) ids.add(selectedNodeId)
    for (const e of contextualEdges) {
      ids.add(e.sourceId)
      ids.add(e.targetId)
    }
    return ids
  }, [contextualEdges, selectedNodeId])

  // Filter nodes: hide Type nodes when ofType edges are hidden (shown as badges instead)
  const rfNodes: Node[] = useMemo(
    () =>
      graphNodes.map((n) => {
        const isHighlighted = highlightedNodeIds.has(n.id)
        const isContextual = selectedNodeId && contextualNodeIds.has(n.id)
        const isSelected = n.id === selectedNodeId
        let style: React.CSSProperties | undefined
        if (isSelected) {
          style = {
            boxShadow: '0 0 0 3px #38bdf8, 0 0 12px rgba(56, 189, 248, 0.4)',
            borderRadius: '8px',
          }
        } else if (isContextual) {
          style = { boxShadow: '0 0 0 2px #38bdf8', borderRadius: '8px' }
        } else if (isHighlighted) {
          style = { boxShadow: '0 0 0 3px #22c55e', borderRadius: '8px' }
        }
        return {
          id: n.id,
          type: n.type,
          position: { x: 0, y: 0 },
          data: {
            label: n.name || n.id,
            typeName: n.type === 'Module' ? moduleTypeMap.get(n.id) : undefined,
          },
          style,
        }
      }),
    [graphNodes, highlightedNodeIds, moduleTypeMap, selectedNodeId, contextualNodeIds],
  )

  // Filter edges by visible types
  const visibleEdges = useMemo(
    () => graphEdges.filter((e) => visibleEdgeTypes.includes(e.type)),
    [graphEdges, visibleEdgeTypes],
  )

  // Build contextual edge IDs set (to avoid duplicating already-visible edges)
  const contextualEdgeKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const e of contextualEdges) {
      keys.add(`${e.sourceId}-${e.type}-${e.targetId}`)
    }
    return keys
  }, [contextualEdges])

  const rfEdges: Edge[] = useMemo(() => {
    // Regular visible edges (dim ones that aren't contextual)
    const regular = visibleEdges.map((e, i) => {
      const color = EDGE_COLORS[e.type] ?? '#94a3b8'
      const key = `${e.sourceId}-${e.type}-${e.targetId}`
      const isContextDuplicate = contextualEdgeKeys.has(key)
      return {
        id: `${e.sourceId}-${e.type}-${e.targetId}-${i}`,
        source: e.sourceId,
        target: e.targetId,
        label: edgeLabel(e.type, e.properties),
        type: 'default',
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: {
          stroke: color,
          strokeWidth: isContextDuplicate ? 0 : 1.5,
          opacity: selectedNodeId ? 0.3 : 0.7,
        },
        labelStyle: {
          fill: color,
          fontSize: 9,
          fontWeight: 500,
          opacity: isContextDuplicate ? 0 : selectedNodeId ? 0.3 : 1,
        },
        labelBgStyle: { fill: '#0f172a', fillOpacity: isContextDuplicate ? 0 : 0.8 },
        labelBgPadding: [3, 2] as [number, number],
        labelBgBorderRadius: 3,
      }
    })

    // Contextual overlay edges (highlighted, always shown when a node is selected)
    const overlay = contextualEdges.map((e, i) => {
      const color = EDGE_COLORS[e.type] ?? '#94a3b8'
      return {
        id: `ctx-${e.sourceId}-${e.type}-${e.targetId}-${i}`,
        source: e.sourceId,
        target: e.targetId,
        label: edgeLabel(e.type, e.properties),
        type: 'default',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: 2.5, opacity: 1 },
        labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
        labelBgStyle: { fill: '#0f172a', fillOpacity: 0.9 },
        labelBgPadding: [4, 3] as [number, number],
        labelBgBorderRadius: 3,
        zIndex: 10,
      }
    })

    return [...regular, ...overlay]
  }, [visibleEdges, contextualEdges, contextualEdgeKeys, selectedNodeId])

  // Structural edges for dagre layout (hasParent only for clean tree hierarchy)
  const layoutEdges: Edge[] = useMemo(
    () =>
      graphEdges
        .filter((e) => e.type === 'hasParent')
        .map((e, i) => ({
          id: `layout-${e.sourceId}-${e.targetId}-${i}`,
          source: e.sourceId,
          target: e.targetId,
        })),
    [graphEdges],
  )

  const { nodes: layoutedNodes, edges: layoutedEdges } = useMemo(
    () => getLayoutedElements(rfNodes, rfEdges, layoutEdges),
    [rfNodes, rfEdges, layoutEdges],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState(layoutedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(layoutedEdges)
  const { fitView } = useReactFlow()

  useEffect(() => {
    setNodes(layoutedNodes)
    setEdges(layoutedEdges)
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50)
  }, [layoutedNodes, layoutedEdges, setNodes, setEdges, fitView])

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      // Toggle: clicking the same node deselects it
      setSelectedNode(selectedNodeId === node.id ? null : node.id)
    },
    [setSelectedNode, selectedNodeId],
  )

  const onPaneClick = useCallback(() => {
    setSelectedNode(null)
  }, [setSelectedNode])

  const minimapNodeColor = useCallback((node: Node) => {
    const type = node.type as NodeType | undefined
    return type ? (NODE_COLORS[type]?.bg ?? '#64748b') : '#64748b'
  }, [])

  return (
    <div className="w-full h-full relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{ animated: false }}
      >
        <Background color="#334155" gap={20} size={1} />
        <Controls className="!bg-slate-800 !border-slate-700 !shadow-lg [&>button]:!bg-slate-700 [&>button]:!border-slate-600 [&>button]:!text-slate-300 [&>button:hover]:!bg-slate-600" />
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="rgba(15, 23, 42, 0.8)"
          className="!bg-slate-800 !border-slate-700"
        />
      </ReactFlow>
      <EdgeFilters />
    </div>
  )
}

export function AuthzGraph() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  )
}
