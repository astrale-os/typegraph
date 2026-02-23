/**
 * Mutation AST Module
 */

// Types
export type {
  MutationOp,
  InlineLink,
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
  BatchCreateLinkNodeOp,
  BatchDeleteLinkNodeOp,
  UpdateLinkNodeOp,
  DeleteLinkNodeOp,
  DeleteLinkNodesFromOp,
  DeleteLinkNodesToOp,
} from './types'

// Factory functions
export {
  createNode,
  updateNode,
  deleteNode,
  upsertNode,
  cloneNode,
  createEdge,
  updateEdge,
  updateEdgeById,
  deleteEdge,
  deleteEdgeById,
  moveNode,
  deleteSubtree,
  batchCreate,
  batchUpdate,
  batchDelete,
  batchLink,
  batchUnlink,
  unlinkAllFrom,
  unlinkAllTo,
} from './builder'

// Pipeline
export { MutationCompilationPipeline } from './pipeline'
export type { MutationCompilationPass } from './pipeline'
