import { create } from 'zustand'
import { api } from '@/api/client'
import {
  type GraphNode,
  type GraphEdge,
  type NodeType,
  type EdgeType,
  resolveNodeType,
} from '@/types/graph'

interface GraphStore {
  nodes: GraphNode[]
  edges: GraphEdge[]
  selectedNodeId: string | null
  highlightedPaths: string[][]
  loading: boolean
  visibleEdgeTypes: EdgeType[]

  loadFromDB: () => Promise<void>
  addNode: (type: NodeType, id: string, name?: string) => Promise<void>
  removeNode: (id: string) => Promise<void>
  addEdge: (
    type: EdgeType,
    sourceId: string,
    targetId: string,
    props?: Record<string, string | string[]>,
  ) => Promise<void>
  removeEdge: (sourceId: string, targetId: string, type: EdgeType) => Promise<void>
  setSelectedNode: (id: string | null) => void
  setHighlightedPaths: (paths: string[][]) => void
  clearHighlights: () => void
  toggleEdgeType: (type: EdgeType) => void
  clear: () => void
}

export const useGraphStore = create<GraphStore>((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  highlightedPaths: [],
  loading: false,
  visibleEdgeTypes: ['hasParent'] as EdgeType[],

  loadFromDB: async () => {
    set({ loading: true })
    try {
      const [nodesRes, edgesRes] = await Promise.all([api.getNodes(), api.getEdges()])

      const nodes: GraphNode[] = nodesRes.nodes.map((n) => ({
        id: n.id,
        type: resolveNodeType(n.labels),
        name: n.name,
      }))

      const edges: GraphEdge[] = edgesRes.edges.map((e) => ({
        sourceId: e.sourceId,
        targetId: e.targetId,
        type: e.type as EdgeType,
        properties: e.properties,
      }))

      set({ nodes, edges, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  addNode: async (type, id, name) => {
    const label = type
    const cypher = name
      ? `CREATE (n:Node:${label} {id: $id, name: $name})`
      : `CREATE (n:Node:${label} {id: $id})`
    const params: Record<string, unknown> = { id }
    if (name) params.name = name
    await api.query(cypher, params)
    set((state) => ({
      nodes: [...state.nodes, { id, type, name }],
    }))
  },

  removeNode: async (id) => {
    await api.query('MATCH (n {id: $id}) DETACH DELETE n', { id })
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== id),
      edges: state.edges.filter((e) => e.sourceId !== id && e.targetId !== id),
    }))
  },

  addEdge: async (type, sourceId, targetId, props) => {
    const propsStr = props
      ? ' {' +
        Object.entries(props)
          .map(([k, v]) => {
            if (Array.isArray(v)) return `${k}: [${v.map((x) => `'${x}'`).join(', ')}]`
            return `${k}: '${v}'`
          })
          .join(', ') +
        '}'
      : ''
    await api.query(
      `MATCH (a {id: $sourceId}), (b {id: $targetId}) CREATE (a)-[:${type}${propsStr}]->(b)`,
      { sourceId, targetId },
    )
    set((state) => ({
      edges: [...state.edges, { sourceId, targetId, type, properties: props ?? {} }],
    }))
  },

  removeEdge: async (sourceId, targetId, type) => {
    await api.query(`MATCH (a {id: $sourceId})-[r:${type}]->(b {id: $targetId}) DELETE r`, {
      sourceId,
      targetId,
    })
    set((state) => ({
      edges: state.edges.filter(
        (e) => !(e.sourceId === sourceId && e.targetId === targetId && e.type === type),
      ),
    }))
  },

  setSelectedNode: (id) => set({ selectedNodeId: id }),
  setHighlightedPaths: (paths) => set({ highlightedPaths: paths }),
  clearHighlights: () => set({ highlightedPaths: [] }),
  toggleEdgeType: (type) => {
    const current = get().visibleEdgeTypes
    const next = current.includes(type) ? current.filter((t) => t !== type) : [...current, type]
    set({ visibleEdgeTypes: next })
  },
  clear: () => set({ nodes: [], edges: [], selectedNodeId: null, highlightedPaths: [] }),
}))
