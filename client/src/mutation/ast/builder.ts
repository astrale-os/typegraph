/**
 * Mutation AST — Factory Functions
 *
 * Plain functions that construct MutationOp instances.
 * No class, no state — just data construction.
 */

import type {
  CreateNodeOp,
  UpdateNodeOp,
  DeleteNodeOp,
  UpsertNodeOp,
  CloneNodeOp,
  CreateEdgeOp,
  UpdateEdgeOp,
  UpdateEdgeByIdOp,
  DeleteEdgeOp,
  DeleteEdgeByIdOp,
  MoveNodeOp,
  DeleteSubtreeOp,
  BatchCreateOp,
  BatchUpdateOp,
  BatchDeleteOp,
  BatchLinkOp,
  BatchUnlinkOp,
  UnlinkAllFromOp,
  UnlinkAllToOp,
  InlineLink,
} from './types'

// =============================================================================
// NODE
// =============================================================================

export function createNode(
  label: string,
  id: string,
  data: Record<string, unknown>,
  opts?: {
    additionalLabels?: string[]
    links?: InlineLink[]
  },
): CreateNodeOp {
  return {
    type: 'createNode',
    label,
    id,
    data,
    ...(opts?.additionalLabels && { additionalLabels: opts.additionalLabels }),
    ...(opts?.links?.length && { links: opts.links }),
  }
}

export function updateNode(label: string, id: string, data: Record<string, unknown>): UpdateNodeOp {
  return { type: 'updateNode', label, id, data }
}

export function deleteNode(label: string, id: string, detach = true): DeleteNodeOp {
  return { type: 'deleteNode', label, id, detach }
}

export function upsertNode(
  label: string,
  id: string,
  data: Record<string, unknown>,
  opts?: { links?: InlineLink[] },
): UpsertNodeOp {
  return {
    type: 'upsertNode',
    label,
    id,
    data,
    ...(opts?.links?.length && { links: opts.links }),
  }
}

export function cloneNode(
  label: string,
  sourceId: string,
  newId: string,
  overrides: Record<string, unknown>,
  parent?: CloneNodeOp['parent'],
): CloneNodeOp {
  return {
    type: 'cloneNode',
    label,
    sourceId,
    newId,
    overrides,
    ...(parent && { parent }),
  }
}

// =============================================================================
// EDGE
// =============================================================================

export function createEdge(
  edgeType: string,
  fromId: string,
  toId: string,
  edgeId: string,
  data?: Record<string, unknown>,
): CreateEdgeOp {
  return {
    type: 'createEdge',
    edgeType,
    fromId,
    toId,
    edgeId,
    ...(data && { data }),
  }
}

export function updateEdge(
  edgeType: string,
  fromId: string,
  toId: string,
  data: Record<string, unknown>,
): UpdateEdgeOp {
  return { type: 'updateEdge', edgeType, fromId, toId, data }
}

export function updateEdgeById(
  edgeType: string,
  edgeId: string,
  data: Record<string, unknown>,
): UpdateEdgeByIdOp {
  return { type: 'updateEdgeById', edgeType, edgeId, data }
}

export function deleteEdge(edgeType: string, fromId: string, toId: string): DeleteEdgeOp {
  return { type: 'deleteEdge', edgeType, fromId, toId }
}

export function deleteEdgeById(edgeType: string, edgeId: string): DeleteEdgeByIdOp {
  return { type: 'deleteEdgeById', edgeType, edgeId }
}

// =============================================================================
// HIERARCHY
// =============================================================================

export function moveNode(nodeId: string, newParentId: string, edgeType: string): MoveNodeOp {
  return { type: 'moveNode', nodeId, newParentId, edgeType }
}

export function deleteSubtree(rootId: string, edgeType: string): DeleteSubtreeOp {
  return { type: 'deleteSubtree', rootId, edgeType }
}

// =============================================================================
// BATCH
// =============================================================================

export function batchCreate(
  label: string,
  items: { id: string; data: Record<string, unknown> }[],
  opts?: { additionalLabels?: string[]; links?: InlineLink[] },
): BatchCreateOp {
  return {
    type: 'batchCreate',
    label,
    items,
    ...(opts?.additionalLabels && { additionalLabels: opts.additionalLabels }),
    ...(opts?.links?.length && { links: opts.links }),
  }
}

export function batchUpdate(
  label: string,
  updates: { id: string; data: Record<string, unknown> }[],
): BatchUpdateOp {
  return { type: 'batchUpdate', label, updates }
}

export function batchDelete(label: string, ids: string[]): BatchDeleteOp {
  return { type: 'batchDelete', label, ids }
}

export function batchLink(
  edgeType: string,
  links: { fromId: string; toId: string; edgeId: string; data?: Record<string, unknown> }[],
): BatchLinkOp {
  return { type: 'batchLink', edgeType, links }
}

export function batchUnlink(
  edgeType: string,
  links: { fromId: string; toId: string }[],
): BatchUnlinkOp {
  return { type: 'batchUnlink', edgeType, links }
}

export function unlinkAllFrom(edgeType: string, fromId: string): UnlinkAllFromOp {
  return { type: 'unlinkAllFrom', edgeType, fromId }
}

export function unlinkAllTo(edgeType: string, toId: string): UnlinkAllToOp {
  return { type: 'unlinkAllTo', edgeType, toId }
}
