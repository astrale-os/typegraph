export type NodeType = 'Root' | 'Space' | 'Module' | 'Type' | 'Identity'

export type EdgeType =
  | 'hasParent'
  | 'ofType'
  | 'hasPerm'
  | 'unionWith'
  | 'intersectWith'
  | 'excludeWith'

export interface GraphNode {
  id: string
  type: NodeType
  name?: string
}

export interface GraphEdge {
  sourceId: string
  targetId: string
  type: EdgeType
  properties: Record<string, unknown>
}

export const NODE_COLORS: Record<NodeType, { bg: string; border: string; text: string }> = {
  Root: { bg: '#7c3aed', border: '#6d28d9', text: '#ffffff' },
  Space: { bg: '#3b82f6', border: '#2563eb', text: '#ffffff' },
  Module: { bg: '#10b981', border: '#059669', text: '#ffffff' },
  Type: { bg: '#f59e0b', border: '#d97706', text: '#1e293b' },
  Identity: { bg: '#ec4899', border: '#db2777', text: '#ffffff' },
}

export const EDGE_COLORS: Record<EdgeType, string> = {
  hasParent: '#64748b',
  ofType: '#8b5cf6',
  hasPerm: '#22c55e',
  unionWith: '#3b82f6',
  intersectWith: '#f97316',
  excludeWith: '#ef4444',
}

export function resolveNodeType(labels: string[]): NodeType {
  if (labels.includes('Root')) return 'Root'
  if (labels.includes('Space')) return 'Space'
  if (labels.includes('Module')) return 'Module'
  if (labels.includes('Type')) return 'Type'
  if (labels.includes('Identity')) return 'Identity'
  return 'Module'
}
