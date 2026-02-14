/**
 * In-Memory Graph Store Types
 *
 * Core data structures for the in-memory graph database.
 */

/**
 * Stored node with all properties and metadata.
 */
export interface StoredNode {
  /** Unique identifier */
  id: string
  /** Node label (type) */
  label: string
  /** Node properties (excluding id) */
  properties: Record<string, unknown>
  /** Creation timestamp */
  createdAt: Date
  /** Last update timestamp */
  updatedAt: Date
}

/**
 * Stored edge with endpoints and properties.
 */
export interface StoredEdge {
  /** Unique identifier */
  id: string
  /** Edge type */
  type: string
  /** Source node ID */
  fromId: string
  /** Target node ID */
  toId: string
  /** Edge properties (excluding id) */
  properties: Record<string, unknown>
  /** Creation timestamp */
  createdAt: Date
}

/**
 * Index entry for fast lookups.
 */
export interface IndexEntry {
  /** The indexed value */
  value: unknown
  /** Set of node/edge IDs with this value */
  ids: Set<string>
}

/**
 * Index configuration.
 */
export interface IndexConfig {
  /** Index name */
  name: string
  /** Label or edge type */
  target: string
  /** Property being indexed */
  property: string
  /** Whether this is a unique index */
  unique: boolean
}

/**
 * Transaction snapshot for rollback support.
 */
export interface TransactionSnapshot {
  nodes: Map<string, StoredNode>
  edges: Map<string, StoredEdge>
  outEdges: Map<string, Set<string>>
  inEdges: Map<string, Set<string>>
}
