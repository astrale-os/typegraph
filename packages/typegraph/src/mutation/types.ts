/**
 * Mutation Type Definitions
 *
 * Types for the mutation API - create, update, delete, link, hierarchy operations.
 */

import type { AnySchema, NodeLabels, NodeProps, EdgeTypes, EdgeProps } from '../schema'

// =============================================================================
// INPUT TYPES (What user provides)
// =============================================================================

/**
 * Node input - excludes 'id' which is generated.
 */
export type NodeInput<S extends AnySchema, N extends NodeLabels<S>> = Omit<NodeProps<S, N>, 'id'>

/**
 * Edge input - excludes 'id' which is generated.
 */
export type EdgeInput<S extends AnySchema, E extends EdgeTypes<S>> = Omit<EdgeProps<S, E>, 'id'>

/**
 * Input for batch link operations.
 */
export interface LinkInput<S extends AnySchema, E extends EdgeTypes<S>> {
  from: string
  to: string
  data?: EdgeInput<S, E>
}

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Result of creating or updating a node.
 */
export interface NodeResult<S extends AnySchema, N extends NodeLabels<S>> {
  id: string
  data: NodeProps<S, N>
}

/**
 * Result of creating an edge.
 */
export interface EdgeResult<S extends AnySchema, E extends EdgeTypes<S>> {
  id: string
  from: string
  to: string
  data: EdgeProps<S, E>
}

/**
 * Result of a delete operation.
 */
export interface DeleteResult {
  deleted: boolean
  id: string
}

/**
 * Result of a batch delete operation.
 */
export interface BatchDeleteResult {
  deleted: number
}

/**
 * Result of moving a node.
 */
export interface MoveResult {
  moved: boolean
  nodeId: string
  previousParentId: string | null
  newParentId: string
}

/**
 * Result of a subtree operation (move/delete).
 */
export interface SubtreeResult {
  rootId: string
  affectedNodes: number
}

/**
 * Result of deleting a subtree.
 */
export interface DeleteSubtreeResult {
  rootId: string
  deletedNodes: number
  deletedEdges: number
}

/**
 * Result of cloning a subtree.
 */
export interface CloneSubtreeResult<S extends AnySchema, N extends NodeLabels<S>> {
  root: NodeResult<S, N>
  clonedNodes: number
  /** Map from original ID to cloned ID */
  idMapping: Record<string, string>
}

// =============================================================================
// OPTIONS
// =============================================================================

/**
 * Options for creating a node.
 */
export interface CreateOptions {
  /** Provide custom ID instead of auto-generating */
  id?: string
}

/**
 * Options for deleting a node.
 */
export interface DeleteOptions {
  /** Delete connected edges (default: true) */
  detach?: boolean
}

/**
 * Options for hierarchy operations.
 */
export interface HierarchyOptions<S extends AnySchema> {
  /** Edge type for hierarchy (defaults to schema's hierarchy.defaultEdge) */
  edge?: EdgeTypes<S>
}

/**
 * Options for cloning a node.
 */
export interface CloneOptions<S extends AnySchema> {
  /** Link clone to same parent as source */
  preserveParent?: boolean
  /** Link clone to specific parent */
  parentId?: string
  /** Edge type for parent link */
  edge?: EdgeTypes<S>
}

/**
 * Options for cloning a subtree.
 */
export interface CloneSubtreeOptions<S extends AnySchema> extends CloneOptions<S> {
  /** Maximum depth to clone (undefined = all) */
  maxDepth?: number
  /** Transform node data during clone */
  transform?: <N extends NodeLabels<S>>(
    node: NodeProps<S, N>,
    depth: number,
  ) => Partial<NodeInput<S, N>>
}

/**
 * Result of an upsert operation.
 */
export interface UpsertResult<S extends AnySchema, N extends NodeLabels<S>> {
  id: string
  data: NodeProps<S, N>
  /** True if a new node was created, false if existing was updated */
  created: boolean
}

// =============================================================================
// ID GENERATOR
// =============================================================================

/**
 * Interface for generating node/edge IDs.
 */
export interface IdGenerator {
  /** Generate a unique ID for a node or edge */
  generate(type: string): string
}

/**
 * Default ID generator using crypto.randomUUID.
 */
export const defaultIdGenerator: IdGenerator = {
  generate: (type: string) => `${type}_${crypto.randomUUID()}`,
}

// =============================================================================
// MUTATION INTERFACE
// =============================================================================

/**
 * Main mutation API interface.
 */
export interface GraphMutations<S extends AnySchema> {
  // ---------------------------------------------------------------------------
  // NODE CRUD
  // ---------------------------------------------------------------------------

  /** Create a new node */
  create<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N>,
    options?: CreateOptions,
  ): Promise<NodeResult<S, N>>

  /** Update node properties (partial update) */
  update<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N>>,
  ): Promise<NodeResult<S, N>>

  /** Delete a node */
  delete<N extends NodeLabels<S>>(
    label: N,
    id: string,
    options?: DeleteOptions,
  ): Promise<DeleteResult>

  /** Upsert (create or update) a node by ID */
  upsert<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: NodeInput<S, N>,
  ): Promise<UpsertResult<S, N>>

  // ---------------------------------------------------------------------------
  // EDGE CRUD
  // ---------------------------------------------------------------------------

  /** Create an edge between two nodes */
  link<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data?: EdgeInput<S, E>,
  ): Promise<EdgeResult<S, E>>

  /** Update edge properties (partial update) */
  patchLink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data: Partial<EdgeInput<S, E>>,
  ): Promise<EdgeResult<S, E>>

  /** Delete an edge by endpoints */
  unlink<E extends EdgeTypes<S>>(edge: E, from: string, to: string): Promise<DeleteResult>

  /** Delete an edge by ID */
  unlinkById<E extends EdgeTypes<S>>(edge: E, edgeId: string): Promise<DeleteResult>

  // ---------------------------------------------------------------------------
  // HIERARCHY OPERATIONS
  // ---------------------------------------------------------------------------

  /** Create node as child of parent (atomic) */
  createChild<N extends NodeLabels<S>>(
    label: N,
    parentId: string,
    data: NodeInput<S, N>,
    options?: HierarchyOptions<S>,
  ): Promise<NodeResult<S, N>>

  /** Move node to new parent */
  move(nodeId: string, newParentId: string, options?: HierarchyOptions<S>): Promise<MoveResult>

  /** Move node and all descendants to new parent */
  moveSubtree(
    rootId: string,
    newParentId: string,
    options?: HierarchyOptions<S>,
  ): Promise<SubtreeResult>

  /** Clone a node (without children) */
  clone<N extends NodeLabels<S>>(
    label: N,
    sourceId: string,
    overrides?: Partial<NodeInput<S, N>>,
    options?: CloneOptions<S>,
  ): Promise<NodeResult<S, N>>

  /** Clone node and all descendants, preserving original node labels */
  cloneSubtree(
    sourceRootId: string,
    options?: CloneSubtreeOptions<S>,
  ): Promise<CloneSubtreeResult<S, NodeLabels<S>>>

  /** Delete node and all descendants */
  deleteSubtree<N extends NodeLabels<S>>(
    label: N,
    rootId: string,
    options?: HierarchyOptions<S>,
  ): Promise<DeleteSubtreeResult>

  // ---------------------------------------------------------------------------
  // BATCH OPERATIONS
  // ---------------------------------------------------------------------------

  /** Create multiple nodes */
  createMany<N extends NodeLabels<S>>(
    label: N,
    items: NodeInput<S, N>[],
    options?: CreateOptions,
  ): Promise<NodeResult<S, N>[]>

  /** Update multiple nodes by ID */
  updateMany<N extends NodeLabels<S>>(
    label: N,
    updates: Array<{ id: string; data: Partial<NodeInput<S, N>> }>,
  ): Promise<NodeResult<S, N>[]>

  /** Delete multiple nodes by ID */
  deleteMany<N extends NodeLabels<S>>(
    label: N,
    ids: string[],
    options?: DeleteOptions,
  ): Promise<DeleteResult>

  /** Create multiple edges of the same type */
  linkMany<E extends EdgeTypes<S>>(edge: E, links: LinkInput<S, E>[]): Promise<EdgeResult<S, E>[]>

  /** Delete multiple edges by endpoints */
  unlinkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: Array<{ from: string; to: string }>,
  ): Promise<BatchDeleteResult>

  /** Delete all outgoing edges of a type from a node */
  unlinkAllFrom<E extends EdgeTypes<S>>(edge: E, from: string): Promise<BatchDeleteResult>

  /** Delete all incoming edges of a type to a node */
  unlinkAllTo<E extends EdgeTypes<S>>(edge: E, to: string): Promise<BatchDeleteResult>

  // ---------------------------------------------------------------------------
  // TRANSACTIONS
  // ---------------------------------------------------------------------------

  /** Execute mutations in a transaction */
  transaction<T>(fn: (tx: MutationTransaction<S>) => Promise<T>): Promise<T>
}

// =============================================================================
// TRANSACTION INTERFACE
// =============================================================================

/**
 * Transaction context for executing multiple mutations atomically.
 */
export interface MutationTransaction<S extends AnySchema> {
  /** Create a new node */
  create<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N>,
    options?: CreateOptions,
  ): Promise<NodeResult<S, N>>

  /** Update node properties */
  update<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N>>,
  ): Promise<NodeResult<S, N>>

  /** Delete a node */
  delete<N extends NodeLabels<S>>(
    label: N,
    id: string,
    options?: DeleteOptions,
  ): Promise<DeleteResult>

  /** Upsert (create or update) a node by ID */
  upsert<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: NodeInput<S, N>,
  ): Promise<UpsertResult<S, N>>

  /** Create an edge */
  link<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data?: EdgeInput<S, E>,
  ): Promise<EdgeResult<S, E>>

  /** Update edge properties */
  patchLink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data: Partial<EdgeInput<S, E>>,
  ): Promise<EdgeResult<S, E>>

  /** Delete an edge */
  unlink<E extends EdgeTypes<S>>(edge: E, from: string, to: string): Promise<DeleteResult>

  /** Create multiple edges of the same type */
  linkMany<E extends EdgeTypes<S>>(edge: E, links: LinkInput<S, E>[]): Promise<EdgeResult<S, E>[]>

  /** Delete multiple edges by endpoints */
  unlinkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: Array<{ from: string; to: string }>,
  ): Promise<BatchDeleteResult>

  /** Create node as child */
  createChild<N extends NodeLabels<S>>(
    label: N,
    parentId: string,
    data: NodeInput<S, N>,
    options?: HierarchyOptions<S>,
  ): Promise<NodeResult<S, N>>

  /** Move node to new parent */
  move(nodeId: string, newParentId: string, options?: HierarchyOptions<S>): Promise<MoveResult>
}
