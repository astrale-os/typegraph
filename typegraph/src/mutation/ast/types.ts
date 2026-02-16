/**
 * Mutation AST — Operation Types
 *
 * Discriminated union of all mutation operations.
 * Each op captures semantic intent (user-facing labels/edge types)
 * so compilation passes can transform them before Cypher generation.
 */

// =============================================================================
// INLINE LINK (shared across node ops)
// =============================================================================

export interface InlineLink {
  readonly edgeType: string
  readonly targetId: string
}

// =============================================================================
// NODE OPERATIONS
// =============================================================================

export interface CreateNodeOp {
  readonly type: 'createNode'
  readonly label: string
  readonly id: string
  readonly data: Record<string, unknown>
  readonly additionalLabels?: readonly string[]
  readonly links?: readonly InlineLink[]
}

export interface UpdateNodeOp {
  readonly type: 'updateNode'
  readonly label: string
  readonly id: string
  readonly data: Record<string, unknown>
}

export interface DeleteNodeOp {
  readonly type: 'deleteNode'
  readonly label: string
  readonly id: string
  readonly detach: boolean
}

export interface UpsertNodeOp {
  readonly type: 'upsertNode'
  readonly label: string
  readonly id: string
  readonly data: Record<string, unknown>
  readonly links?: readonly InlineLink[]
}

export interface CloneNodeOp {
  readonly type: 'cloneNode'
  readonly label: string
  readonly sourceId: string
  readonly newId: string
  readonly overrides: Record<string, unknown>
  readonly parent?:
    | { readonly parentId: string; readonly edgeType: string }
    | { readonly preserve: true; readonly edgeType: string }
}

// =============================================================================
// EDGE OPERATIONS
// =============================================================================

/** Annotation injected by ReifyEdgesPass for reified edge compilation. */
export interface ReifiedAnnotation {
  readonly linkLabel: string
}

export interface CreateEdgeOp {
  readonly type: 'createEdge'
  readonly edgeType: string
  readonly fromId: string
  readonly toId: string
  readonly edgeId: string
  readonly data?: Record<string, unknown>
}

export interface UpdateEdgeOp {
  readonly type: 'updateEdge'
  readonly edgeType: string
  readonly fromId: string
  readonly toId: string
  readonly data: Record<string, unknown>
  readonly reified?: ReifiedAnnotation
}

export interface UpdateEdgeByIdOp {
  readonly type: 'updateEdgeById'
  readonly edgeType: string
  readonly edgeId: string
  readonly data: Record<string, unknown>
}

export interface DeleteEdgeOp {
  readonly type: 'deleteEdge'
  readonly edgeType: string
  readonly fromId: string
  readonly toId: string
  readonly reified?: ReifiedAnnotation
}

export interface DeleteEdgeByIdOp {
  readonly type: 'deleteEdgeById'
  readonly edgeType: string
  readonly edgeId: string
}

// =============================================================================
// HIERARCHY OPERATIONS
// =============================================================================

export interface MoveNodeOp {
  readonly type: 'moveNode'
  readonly nodeId: string
  readonly newParentId: string
  readonly edgeType: string
}

export interface DeleteSubtreeOp {
  readonly type: 'deleteSubtree'
  readonly rootId: string
  readonly edgeType: string
}

// =============================================================================
// BATCH OPERATIONS
// =============================================================================

export interface BatchCreateOp {
  readonly type: 'batchCreate'
  readonly label: string
  readonly items: readonly { readonly id: string; readonly data: Record<string, unknown> }[]
  readonly additionalLabels?: readonly string[]
  readonly links?: readonly InlineLink[]
}

export interface BatchUpdateOp {
  readonly type: 'batchUpdate'
  readonly label: string
  readonly updates: readonly { readonly id: string; readonly data: Record<string, unknown> }[]
}

export interface BatchDeleteOp {
  readonly type: 'batchDelete'
  readonly label: string
  readonly ids: readonly string[]
}

export interface BatchLinkOp {
  readonly type: 'batchLink'
  readonly edgeType: string
  readonly links: readonly {
    readonly fromId: string
    readonly toId: string
    readonly edgeId: string
    readonly data?: Record<string, unknown>
  }[]
  readonly reified?: ReifiedAnnotation
}

export interface BatchUnlinkOp {
  readonly type: 'batchUnlink'
  readonly edgeType: string
  readonly links: readonly { readonly fromId: string; readonly toId: string }[]
  readonly reified?: ReifiedAnnotation
}

export interface UnlinkAllFromOp {
  readonly type: 'unlinkAllFrom'
  readonly edgeType: string
  readonly fromId: string
  readonly reified?: ReifiedAnnotation
}

export interface UnlinkAllToOp {
  readonly type: 'unlinkAllTo'
  readonly edgeType: string
  readonly toId: string
  readonly reified?: ReifiedAnnotation
}

// =============================================================================
// UNION
// =============================================================================

export type MutationOp =
  // Node
  | CreateNodeOp
  | UpdateNodeOp
  | DeleteNodeOp
  | UpsertNodeOp
  | CloneNodeOp
  // Edge
  | CreateEdgeOp
  | UpdateEdgeOp
  | UpdateEdgeByIdOp
  | DeleteEdgeOp
  | DeleteEdgeByIdOp
  // Hierarchy
  | MoveNodeOp
  | DeleteSubtreeOp
  // Batch
  | BatchCreateOp
  | BatchUpdateOp
  | BatchDeleteOp
  | BatchLinkOp
  | BatchUnlinkOp
  | UnlinkAllFromOp
  | UnlinkAllToOp
