/**
 * In-Memory Graph Store
 *
 * Core data structure for storing nodes and edges in memory.
 * Provides basic CRUD operations and index management.
 */

import type { StoredNode, StoredEdge, TransactionSnapshot } from './types'

/**
 * Deep clone a value (JSON-safe).
 */
function clone<T>(value: T): T {
  if (value === null || value === undefined) return value
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * In-memory graph store with support for:
 * - Node/edge CRUD operations
 * - Adjacency lists for fast traversal
 * - Label-based node lookup
 * - Type-based edge lookup
 * - Transaction support with rollback
 */
export class GraphStore {
  /** All nodes by ID */
  private nodes = new Map<string, StoredNode>()

  /** All edges by ID */
  private edges = new Map<string, StoredEdge>()

  /** Outgoing edges per node: nodeId -> Set<edgeId> */
  private outEdges = new Map<string, Set<string>>()

  /** Incoming edges per node: nodeId -> Set<edgeId> */
  private inEdges = new Map<string, Set<string>>()

  /** Nodes by label: label -> Set<nodeId> */
  private nodesByLabel = new Map<string, Set<string>>()

  /** Edges by type: type -> Set<edgeId> */
  private edgesByType = new Map<string, Set<string>>()

  /** Property indexes: "label.property" -> Map<value, Set<nodeId>> */
  private propertyIndexes = new Map<string, Map<unknown, Set<string>>>()

  /** Transaction state */
  private transactionSnapshot: TransactionSnapshot | null = null

  // ===========================================================================
  // NODE OPERATIONS
  // ===========================================================================

  /**
   * Create a new node.
   */
  createNode(node: StoredNode): void {
    if (this.nodes.has(node.id)) {
      throw new Error(`Node already exists: ${node.id}`)
    }

    const stored = clone(node)
    this.nodes.set(node.id, stored)

    // Index by label
    if (!this.nodesByLabel.has(node.label)) {
      this.nodesByLabel.set(node.label, new Set())
    }
    this.nodesByLabel.get(node.label)!.add(node.id)

    // Initialize adjacency lists
    this.outEdges.set(node.id, new Set())
    this.inEdges.set(node.id, new Set())

    // Update property indexes
    this.indexNodeProperties(stored)
  }

  /**
   * Get a node by ID.
   */
  getNode(id: string): StoredNode | undefined {
    const node = this.nodes.get(id)
    return node ? clone(node) : undefined
  }

  /**
   * Update a node's properties.
   */
  updateNode(id: string, properties: Record<string, unknown>): void {
    const node = this.nodes.get(id)
    if (!node) {
      throw new Error(`Node not found: ${id}`)
    }

    // Remove from old property indexes
    this.removeNodeFromIndexes(node)

    // Update properties
    node.properties = { ...node.properties, ...properties }
    node.updatedAt = new Date()

    // Re-index
    this.indexNodeProperties(node)
  }

  /**
   * Delete a node and all its edges.
   */
  deleteNode(id: string): void {
    const node = this.nodes.get(id)
    if (!node) return

    // Delete all connected edges
    const outEdgeIds = this.outEdges.get(id) ?? new Set()
    const inEdgeIds = this.inEdges.get(id) ?? new Set()

    for (const edgeId of outEdgeIds) {
      this.deleteEdge(edgeId)
    }
    for (const edgeId of inEdgeIds) {
      this.deleteEdge(edgeId)
    }

    // Remove from property indexes
    this.removeNodeFromIndexes(node)

    // Remove from label index
    this.nodesByLabel.get(node.label)?.delete(id)

    // Remove adjacency lists
    this.outEdges.delete(id)
    this.inEdges.delete(id)

    // Remove node
    this.nodes.delete(id)
  }

  /**
   * Get all nodes with a specific label.
   */
  getNodesByLabel(label: string): StoredNode[] {
    const ids = this.nodesByLabel.get(label)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.getNode(id))
      .filter((n): n is StoredNode => n !== undefined)
  }

  /**
   * Get all nodes.
   */
  getAllNodes(): StoredNode[] {
    return Array.from(this.nodes.values()).map(clone)
  }

  /**
   * Check if a node exists.
   */
  hasNode(id: string): boolean {
    return this.nodes.has(id)
  }

  // ===========================================================================
  // EDGE OPERATIONS
  // ===========================================================================

  /**
   * Create a new edge.
   */
  createEdge(edge: StoredEdge): void {
    if (this.edges.has(edge.id)) {
      throw new Error(`Edge already exists: ${edge.id}`)
    }

    if (!this.nodes.has(edge.fromId)) {
      throw new Error(`Source node not found: ${edge.fromId}`)
    }

    if (!this.nodes.has(edge.toId)) {
      throw new Error(`Target node not found: ${edge.toId}`)
    }

    const stored = clone(edge)
    this.edges.set(edge.id, stored)

    // Index by type
    if (!this.edgesByType.has(edge.type)) {
      this.edgesByType.set(edge.type, new Set())
    }
    this.edgesByType.get(edge.type)!.add(edge.id)

    // Update adjacency lists
    this.outEdges.get(edge.fromId)!.add(edge.id)
    this.inEdges.get(edge.toId)!.add(edge.id)
  }

  /**
   * Get an edge by ID.
   */
  getEdge(id: string): StoredEdge | undefined {
    const edge = this.edges.get(id)
    return edge ? clone(edge) : undefined
  }

  /**
   * Update an edge's properties.
   */
  updateEdge(id: string, properties: Record<string, unknown>): void {
    const edge = this.edges.get(id)
    if (!edge) {
      throw new Error(`Edge not found: ${id}`)
    }

    edge.properties = { ...edge.properties, ...properties }
  }

  /**
   * Delete an edge.
   */
  deleteEdge(id: string): void {
    const edge = this.edges.get(id)
    if (!edge) return

    // Remove from type index
    this.edgesByType.get(edge.type)?.delete(id)

    // Remove from adjacency lists
    this.outEdges.get(edge.fromId)?.delete(id)
    this.inEdges.get(edge.toId)?.delete(id)

    // Remove edge
    this.edges.delete(id)
  }

  /**
   * Get outgoing edges from a node.
   */
  getOutgoingEdges(nodeId: string, type?: string): StoredEdge[] {
    const edgeIds = this.outEdges.get(nodeId)
    if (!edgeIds) return []

    return Array.from(edgeIds)
      .map((id) => this.edges.get(id))
      .filter((e): e is StoredEdge => e !== undefined && (!type || e.type === type))
      .map(clone)
  }

  /**
   * Get incoming edges to a node.
   */
  getIncomingEdges(nodeId: string, type?: string): StoredEdge[] {
    const edgeIds = this.inEdges.get(nodeId)
    if (!edgeIds) return []

    return Array.from(edgeIds)
      .map((id) => this.edges.get(id))
      .filter((e): e is StoredEdge => e !== undefined && (!type || e.type === type))
      .map(clone)
  }

  /**
   * Get all edges of a specific type.
   */
  getEdgesByType(type: string): StoredEdge[] {
    const ids = this.edgesByType.get(type)
    if (!ids) return []
    return Array.from(ids)
      .map((id) => this.getEdge(id))
      .filter((e): e is StoredEdge => e !== undefined)
  }

  /**
   * Find edge between two nodes.
   */
  findEdge(fromId: string, toId: string, type?: string): StoredEdge | undefined {
    const outEdgeIds = this.outEdges.get(fromId)
    if (!outEdgeIds) return undefined

    for (const edgeId of outEdgeIds) {
      const edge = this.edges.get(edgeId)
      if (edge && edge.toId === toId && (!type || edge.type === type)) {
        return clone(edge)
      }
    }

    return undefined
  }

  /**
   * Check if an edge exists between two nodes.
   */
  hasEdge(fromId: string, toId: string, type?: string): boolean {
    return this.findEdge(fromId, toId, type) !== undefined
  }

  // ===========================================================================
  // PROPERTY INDEXES
  // ===========================================================================

  /**
   * Create a property index.
   */
  createIndex(label: string, property: string): void {
    const key = `${label}.${property}`
    if (this.propertyIndexes.has(key)) return

    const index = new Map<unknown, Set<string>>()
    this.propertyIndexes.set(key, index)

    // Index existing nodes
    const nodes = this.getNodesByLabel(label)
    for (const node of nodes) {
      const value = node.properties[property]
      if (value !== undefined) {
        if (!index.has(value)) {
          index.set(value, new Set())
        }
        index.get(value)!.add(node.id)
      }
    }
  }

  /**
   * Find nodes by indexed property value.
   */
  findByIndex(label: string, property: string, value: unknown): StoredNode[] {
    const key = `${label}.${property}`
    const index = this.propertyIndexes.get(key)

    if (!index) {
      // Fall back to scan if no index exists
      return this.getNodesByLabel(label).filter((n) => n.properties[property] === value)
    }

    const ids = index.get(value)
    if (!ids) return []

    return Array.from(ids)
      .map((id) => this.getNode(id))
      .filter((n): n is StoredNode => n !== undefined)
  }

  private indexNodeProperties(node: StoredNode): void {
    for (const [key, index] of this.propertyIndexes) {
      const parts = key.split('.')
      const label = parts[0]
      const property = parts[1]
      if (label !== node.label || !property) continue

      const value = node.properties[property]
      if (value !== undefined) {
        if (!index.has(value)) {
          index.set(value, new Set())
        }
        index.get(value)!.add(node.id)
      }
    }
  }

  private removeNodeFromIndexes(node: StoredNode): void {
    for (const [key, index] of this.propertyIndexes) {
      const parts = key.split('.')
      const label = parts[0]
      const property = parts[1]
      if (label !== node.label || !property) continue

      const value = node.properties[property]
      if (value !== undefined) {
        index.get(value)?.delete(node.id)
      }
    }
  }

  // ===========================================================================
  // TRANSACTIONS
  // ===========================================================================

  /**
   * Begin a transaction.
   */
  beginTransaction(): void {
    if (this.transactionSnapshot) {
      throw new Error('Transaction already in progress')
    }

    this.transactionSnapshot = {
      nodes: new Map(Array.from(this.nodes.entries()).map(([k, v]) => [k, clone(v)])),
      edges: new Map(Array.from(this.edges.entries()).map(([k, v]) => [k, clone(v)])),
      outEdges: new Map(Array.from(this.outEdges.entries()).map(([k, v]) => [k, new Set(v)])),
      inEdges: new Map(Array.from(this.inEdges.entries()).map(([k, v]) => [k, new Set(v)])),
    }
  }

  /**
   * Commit the current transaction.
   */
  commit(): void {
    if (!this.transactionSnapshot) {
      throw new Error('No transaction in progress')
    }
    this.transactionSnapshot = null
  }

  /**
   * Rollback the current transaction.
   */
  rollback(): void {
    if (!this.transactionSnapshot) {
      throw new Error('No transaction in progress')
    }

    this.nodes = this.transactionSnapshot.nodes
    this.edges = this.transactionSnapshot.edges
    this.outEdges = this.transactionSnapshot.outEdges
    this.inEdges = this.transactionSnapshot.inEdges

    // Rebuild indexes
    this.rebuildLabelIndex()
    this.rebuildTypeIndex()
    this.rebuildPropertyIndexes()

    this.transactionSnapshot = null
  }

  /**
   * Check if in a transaction.
   */
  inTransaction(): boolean {
    return this.transactionSnapshot !== null
  }

  private rebuildLabelIndex(): void {
    this.nodesByLabel.clear()
    for (const node of this.nodes.values()) {
      if (!this.nodesByLabel.has(node.label)) {
        this.nodesByLabel.set(node.label, new Set())
      }
      this.nodesByLabel.get(node.label)!.add(node.id)
    }
  }

  private rebuildTypeIndex(): void {
    this.edgesByType.clear()
    for (const edge of this.edges.values()) {
      if (!this.edgesByType.has(edge.type)) {
        this.edgesByType.set(edge.type, new Set())
      }
      this.edgesByType.get(edge.type)!.add(edge.id)
    }
  }

  private rebuildPropertyIndexes(): void {
    const existingIndexKeys = Array.from(this.propertyIndexes.keys())
    this.propertyIndexes.clear()

    for (const key of existingIndexKeys) {
      const parts = key.split('.')
      const label = parts[0]
      const property = parts[1]
      if (label && property) {
        this.createIndex(label, property)
      }
    }
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Clear all data.
   */
  clear(): void {
    this.nodes.clear()
    this.edges.clear()
    this.outEdges.clear()
    this.inEdges.clear()
    this.nodesByLabel.clear()
    this.edgesByType.clear()
    this.propertyIndexes.clear()
    this.transactionSnapshot = null
  }

  /**
   * Get store statistics.
   */
  stats(): { nodes: number; edges: number; labels: number; edgeTypes: number } {
    return {
      nodes: this.nodes.size,
      edges: this.edges.size,
      labels: this.nodesByLabel.size,
      edgeTypes: this.edgesByType.size,
    }
  }

  /**
   * Export store data for debugging/serialization.
   */
  export(): { nodes: StoredNode[]; edges: StoredEdge[] } {
    return {
      nodes: this.getAllNodes(),
      edges: Array.from(this.edges.values()).map(clone),
    }
  }

  /**
   * Import data from export format.
   */
  import(data: { nodes: StoredNode[]; edges: StoredEdge[] }): void {
    this.clear()
    for (const node of data.nodes) {
      this.createNode(node)
    }
    for (const edge of data.edges) {
      this.createEdge(edge)
    }
  }
}
