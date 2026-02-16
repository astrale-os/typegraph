/**
 * Mutation Type Definitions
 *
 * Types for the mutation API - create, update, delete, link, hierarchy operations.
 */

import type { SchemaShape, TypeMap, UntypedMap } from '../schema'
import type { NodeLabels, NodeProps, EdgeTypes, EdgeProps } from '../inference'
import type { ResolveNode, ResolveEdge, ResolveNodeInput, ResolveEdgeInput } from '../resolve'

// =============================================================================
// INPUT TYPES (What user provides)
// =============================================================================

/**
 * Node input — resolved from TypeMap when available, otherwise Record<string, unknown>.
 */
export type NodeInput<
  S extends SchemaShape,
  N extends NodeLabels<S>,
  T extends TypeMap = UntypedMap,
> = ResolveNodeInput<T, N & string>

/**
 * Edge input — resolved from TypeMap when available, otherwise Record<string, unknown>.
 */
export type EdgeInput<
  S extends SchemaShape,
  E extends EdgeTypes<S>,
  T extends TypeMap = UntypedMap,
> = ResolveEdgeInput<T, E & string>

/**
 * Input for batch link operations.
 */
export interface LinkInput<S extends SchemaShape, E extends EdgeTypes<S>, T extends TypeMap = UntypedMap> {
  from: string
  to: string
  data?: EdgeInput<S, E, T>
}

// =============================================================================
// RESULT TYPES
// =============================================================================

/**
 * Result of creating or updating a node.
 */
export interface NodeResult<S extends SchemaShape, N extends NodeLabels<S>, T extends TypeMap = UntypedMap> {
  id: string
  data: ResolveNode<T, N & string>
}

/**
 * Result of creating an edge.
 */
export interface EdgeResult<S extends SchemaShape, E extends EdgeTypes<S>, T extends TypeMap = UntypedMap> {
  id: string
  from: string
  to: string
  data: ResolveEdge<T, E & string>
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
export interface CloneSubtreeResult<S extends SchemaShape, N extends NodeLabels<S>, T extends TypeMap = UntypedMap> {
  root: NodeResult<S, N, T>
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
  /** Additional labels to apply to the node */
  additionalLabels?: string[]
  /** Atomic inline edges: maps edge type → target node ID (or `'self'`). No edge props; link hooks don't fire. */
  link?: Record<string, string>
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
export interface HierarchyOptions<S extends SchemaShape> {
  /** Edge type for hierarchy (defaults to schema's hierarchy.defaultEdge) */
  edge?: EdgeTypes<S>
}

/**
 * Options for cloning a node.
 */
export interface CloneOptions<S extends SchemaShape> {
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
export interface CloneSubtreeOptions<S extends SchemaShape, T extends TypeMap = UntypedMap> extends CloneOptions<S> {
  /** Maximum depth to clone (undefined = all) */
  maxDepth?: number
  /** Transform node data during clone */
  transform?: <N extends NodeLabels<S>>(
    node: ResolveNode<T, N & string>,
    depth: number,
  ) => Partial<NodeInput<S, N, T>>
}

/**
 * Result of an upsert operation.
 */
export interface UpsertResult<S extends SchemaShape, N extends NodeLabels<S>, T extends TypeMap = UntypedMap> {
  id: string
  data: ResolveNode<T, N & string>
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
export interface GraphMutations<S extends SchemaShape, T extends TypeMap = UntypedMap> {
  // ---------------------------------------------------------------------------
  // NODE CRUD
  // ---------------------------------------------------------------------------

  /** Create a new node */
  create<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N, T>,
    options?: CreateOptions,
  ): Promise<NodeResult<S, N, T>>

  /** Update node properties (partial update) */
  update<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N, T>>,
  ): Promise<NodeResult<S, N, T>>

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
    data: NodeInput<S, N, T>,
  ): Promise<UpsertResult<S, N, T>>

  // ---------------------------------------------------------------------------
  // EDGE CRUD
  // ---------------------------------------------------------------------------

  /** Create an edge between two nodes */
  link<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data?: EdgeInput<S, E, T>,
  ): Promise<EdgeResult<S, E, T>>

  /** Update edge properties (partial update) */
  patchLink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data: Partial<EdgeInput<S, E, T>>,
  ): Promise<EdgeResult<S, E, T>>

  /** Delete an edge by endpoints */
  unlink<E extends EdgeTypes<S>>(edge: E, from: string, to: string): Promise<DeleteResult>

  /** Delete an edge by ID */
  unlinkById<E extends EdgeTypes<S>>(edge: E, edgeId: string): Promise<DeleteResult>

  /** Update edge properties by edge ID (partial update) */
  patchLinkById<E extends EdgeTypes<S>>(
    edge: E,
    edgeId: string,
    data: Partial<EdgeInput<S, E, T>>,
  ): Promise<EdgeResult<S, E, T>>

  // ---------------------------------------------------------------------------
  // HIERARCHY OPERATIONS
  // ---------------------------------------------------------------------------

  /** Create node as child of parent (atomic) */
  createChild<N extends NodeLabels<S>>(
    label: N,
    parentId: string,
    data: NodeInput<S, N, T>,
    options?: HierarchyOptions<S>,
  ): Promise<NodeResult<S, N, T>>

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
    overrides?: Partial<NodeInput<S, N, T>>,
    options?: CloneOptions<S>,
  ): Promise<NodeResult<S, N, T>>

  /** Clone node and all descendants, preserving original node labels */
  cloneSubtree(
    sourceRootId: string,
    options?: CloneSubtreeOptions<S, T>,
  ): Promise<CloneSubtreeResult<S, NodeLabels<S>, T>>

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
    items: NodeInput<S, N, T>[],
    options?: CreateOptions,
  ): Promise<NodeResult<S, N, T>[]>

  /** Update multiple nodes by ID */
  updateMany<N extends NodeLabels<S>>(
    label: N,
    updates: Array<{ id: string; data: Partial<NodeInput<S, N, T>> }>,
  ): Promise<NodeResult<S, N, T>[]>

  /** Delete multiple nodes by ID */
  deleteMany<N extends NodeLabels<S>>(
    label: N,
    ids: Array<string>,
    options?: DeleteOptions,
  ): Promise<BatchDeleteResult>

  /** Create multiple edges of the same type */
  linkMany<E extends EdgeTypes<S>>(edge: E, links: LinkInput<S, E, T>[]): Promise<EdgeResult<S, E, T>[]>

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
  // RAW QUERIES
  // ---------------------------------------------------------------------------

  /**
   * Execute a raw Cypher write query (CREATE, SET, DELETE, MERGE).
   * Use this for mutations that can't be expressed through the typed API.
   *
   * For read-only queries, use `graph.raw()` instead.
   */
  raw<R>(cypher: string, params?: Record<string, unknown>): Promise<R[]>

  // ---------------------------------------------------------------------------
  // TRANSACTIONS
  // ---------------------------------------------------------------------------

  /** Execute mutations in a transaction */
  transaction<R>(fn: (tx: MutationTransaction<S, T>) => Promise<R>): Promise<R>
}

// =============================================================================
// TRANSACTION INTERFACE
// =============================================================================

/**
 * Transaction context for executing multiple mutations atomically.
 */
export interface MutationTransaction<S extends SchemaShape, T extends TypeMap = UntypedMap> {
  /** Create a new node */
  create<N extends NodeLabels<S>>(
    label: N,
    data: NodeInput<S, N, T>,
    options?: CreateOptions,
  ): Promise<NodeResult<S, N, T>>

  /** Update node properties */
  update<N extends NodeLabels<S>>(
    label: N,
    id: string,
    data: Partial<NodeInput<S, N, T>>,
  ): Promise<NodeResult<S, N, T>>

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
    data: NodeInput<S, N, T>,
  ): Promise<UpsertResult<S, N, T>>

  /** Create an edge */
  link<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data?: EdgeInput<S, E, T>,
  ): Promise<EdgeResult<S, E, T>>

  /** Update edge properties */
  patchLink<E extends EdgeTypes<S>>(
    edge: E,
    from: string,
    to: string,
    data: Partial<EdgeInput<S, E, T>>,
  ): Promise<EdgeResult<S, E, T>>

  /** Delete an edge */
  unlink<E extends EdgeTypes<S>>(edge: E, from: string, to: string): Promise<DeleteResult>

  /** Create multiple edges of the same type */
  linkMany<E extends EdgeTypes<S>>(edge: E, links: LinkInput<S, E, T>[]): Promise<EdgeResult<S, E, T>[]>

  /** Delete multiple edges by endpoints */
  unlinkMany<E extends EdgeTypes<S>>(
    edge: E,
    links: Array<{ from: string; to: string }>,
  ): Promise<BatchDeleteResult>

  /** Create node as child */
  createChild<N extends NodeLabels<S>>(
    label: N,
    parentId: string,
    data: NodeInput<S, N, T>,
    options?: HierarchyOptions<S>,
  ): Promise<NodeResult<S, N, T>>

  /** Move node to new parent */
  move(nodeId: string, newParentId: string, options?: HierarchyOptions<S>): Promise<MoveResult>

  /**
   * Execute a raw Cypher write query within the transaction.
   */
  raw<R>(cypher: string, params?: Record<string, unknown>): Promise<R[]>
}
