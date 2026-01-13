/**
 * In-Memory Database Driver
 *
 * Implements DatabaseDriverProvider for in-memory graph storage.
 * This driver executes queries directly against the GraphStore.
 *
 * IMPORTANT: Since the typegraph library compiles queries to Cypher strings,
 * but we want to execute against an in-memory store, we use a special approach:
 * - For mutations, we use command-based execution (template provider returns commands)
 * - For queries, we provide a custom GraphQuery wrapper that uses our query engine
 */

import type {
  DatabaseDriverProvider,
  QueryResult,
  QuerySummary,
  TransactionContext,
  ConnectionMetrics,
} from '@astrale/typegraph'
import { GraphStore } from './store'

/**
 * In-memory command types for mutations.
 * Instead of Cypher strings, our template provider returns serialized commands.
 */
export interface InMemoryCommand {
  type:
    | 'createNode'
    | 'updateNode'
    | 'deleteNode'
    | 'createEdge'
    | 'updateEdge'
    | 'deleteEdge'
    | 'query'
  label?: string
  edgeType?: string
  params: Record<string, unknown>
}

/**
 * Parse a command string from our template provider.
 */
function parseCommand(query: string): InMemoryCommand | null {
  try {
    // Our template provider returns JSON commands prefixed with "INMEM:"
    if (query.startsWith('INMEM:')) {
      return JSON.parse(query.slice(6)) as InMemoryCommand
    }
    return null
  } catch {
    return null
  }
}

/**
 * In-memory database driver.
 *
 * Executes commands directly against a GraphStore instance.
 */
export class InMemoryDriver implements DatabaseDriverProvider {
  readonly name = 'in-memory'
  private connected = false

  constructor(private readonly store: GraphStore) {}

  async connect(): Promise<void> {
    this.connected = true
  }

  async close(): Promise<void> {
    this.connected = false
  }

  async isConnected(): Promise<boolean> {
    return this.connected
  }

  async run<T>(query: string, params?: Record<string, unknown>): Promise<QueryResult<T>> {
    const command = parseCommand(query)

    if (!command) {
      // If not a command, this might be a raw Cypher query
      // We don't support raw Cypher in in-memory mode
      throw new Error(
        `In-memory driver does not support raw Cypher queries. ` +
          `Use the @astrale/typegraph-memory createInMemoryGraph() for proper in-memory support.`,
      )
    }

    const startTime = Date.now()
    const results = this.executeCommand<T>(command, params ?? command.params)
    const endTime = Date.now()

    const summary: QuerySummary = {
      resultAvailableAfter: endTime - startTime,
      resultConsumedAfter: endTime - startTime,
      server: {
        version: 'in-memory-1.0.0',
        address: 'memory://localhost',
      },
    }

    return { records: results, summary }
  }

  async transaction<T>(
    work: (tx: TransactionContext) => Promise<T>,
    _mode?: 'read' | 'write',
  ): Promise<T> {
    this.store.beginTransaction()

    const txContext: TransactionContext = {
      run: async <R>(query: string, params?: Record<string, unknown>): Promise<R[]> => {
        const result = await this.run<R>(query, params)
        return result.records
      },
      commit: async () => {
        this.store.commit()
      },
      rollback: async () => {
        this.store.rollback()
      },
    }

    try {
      const result = await work(txContext)
      if (this.store.inTransaction()) {
        this.store.commit()
      }
      return result
    } catch (error) {
      if (this.store.inTransaction()) {
        this.store.rollback()
      }
      throw error
    }
  }

  getMetrics(): ConnectionMetrics {
    return {
      activeConnections: this.connected ? 1 : 0,
      idleConnections: 0,
      totalAcquisitions: 0,
    }
  }

  /**
   * Execute a command against the store.
   */
  private executeCommand<T>(command: InMemoryCommand, params: Record<string, unknown>): T[] {
    switch (command.type) {
      case 'createNode':
        return this.executeCreateNode<T>(command, params)
      case 'updateNode':
        return this.executeUpdateNode<T>(command, params)
      case 'deleteNode':
        return this.executeDeleteNode<T>(command, params)
      case 'createEdge':
        return this.executeCreateEdge<T>(command, params)
      case 'updateEdge':
        return this.executeUpdateEdge<T>(command, params)
      case 'deleteEdge':
        return this.executeDeleteEdge<T>(command, params)
      case 'query':
        return this.executeQuery<T>(command, params)
      default:
        throw new Error(`Unknown command type: ${(command as InMemoryCommand).type}`)
    }
  }

  private executeCreateNode<T>(command: InMemoryCommand, params: Record<string, unknown>): T[] {
    const id = params.id as string
    const label = command.label!
    const props = params.props as Record<string, unknown>

    const now = new Date()
    this.store.createNode({
      id,
      label,
      properties: props,
      createdAt: now,
      updatedAt: now,
    })

    return [{ id, ...props } as T]
  }

  private executeUpdateNode<T>(_command: unknown, params: Record<string, unknown>): T[] {
    const id = params.id as string
    const props = params.props as Record<string, unknown>

    const existing = this.store.getNode(id)
    if (!existing) {
      throw new Error(`Node not found: ${id}`)
    }

    this.store.updateNode(id, props)
    const updated = this.store.getNode(id)!

    return [{ id, ...updated.properties } as T]
  }

  private executeDeleteNode<T>(_command: InMemoryCommand, params: Record<string, unknown>): T[] {
    const id = params.id as string
    this.store.deleteNode(id)
    return [{ deleted: true } as T]
  }

  private executeCreateEdge<T>(command: InMemoryCommand, params: Record<string, unknown>): T[] {
    // Handle batch operations
    const batch = (command as InMemoryCommand & { batch?: boolean }).batch

    if (batch === true) {
      // linkMany - create multiple edges
      const links = params.links as Array<{
        id: string
        from: string
        to: string
        data?: Record<string, unknown>
      }>
      const results: T[] = []
      for (const link of links) {
        this.store.createEdge({
          id: link.id,
          type: command.edgeType!,
          fromId: link.from,
          toId: link.to,
          properties: link.data ?? {},
          createdAt: new Date(),
        })
        results.push({
          id: link.id,
          type: command.edgeType!,
          fromId: link.from,
          toId: link.to,
          ...link.data,
        } as T)
      }
      return results
    }

    // Single edge creation
    const id = params.edgeId as string
    const type = command.edgeType!
    const fromId = params.fromId as string
    const toId = params.toId as string
    const props = (params.props as Record<string, unknown>) ?? {}

    this.store.createEdge({
      id,
      type,
      fromId,
      toId,
      properties: props,
      createdAt: new Date(),
    })

    return [{ id, type, fromId, toId, ...props } as T]
  }

  private executeUpdateEdge<T>(_command: InMemoryCommand, params: Record<string, unknown>): T[] {
    const id = params.edgeId as string
    const props = params.props as Record<string, unknown>

    const existing = this.store.getEdge(id)
    if (!existing) {
      throw new Error(`Edge not found: ${id}`)
    }

    this.store.updateEdge(id, props)
    const updated = this.store.getEdge(id)!

    return [{ id, ...updated.properties, fromId: updated.fromId, toId: updated.toId } as T]
  }

  private executeDeleteEdge<T>(command: InMemoryCommand, params: Record<string, unknown>): T[] {
    // Handle batch operations
    const batch = (command as InMemoryCommand & { batch?: string | boolean }).batch

    if (batch === 'unlinkAllFrom') {
      const fromId = params.from as string
      const edgeType = command.edgeType!
      const edges = this.store.getOutgoingEdges(fromId, edgeType)
      let deleted = 0
      for (const edge of edges) {
        this.store.deleteEdge(edge.id)
        deleted++
      }
      return [{ deleted } as T]
    }

    if (batch === 'unlinkAllTo') {
      const toId = params.to as string
      const edgeType = command.edgeType!
      const edges = this.store.getIncomingEdges(toId, edgeType)
      let deleted = 0
      for (const edge of edges) {
        this.store.deleteEdge(edge.id)
        deleted++
      }
      return [{ deleted } as T]
    }

    if (batch === true) {
      // unlinkMany - delete edges by from/to pairs
      const links = params.links as Array<{ from: string; to: string }>
      let deleted = 0
      for (const link of links) {
        const edges = this.store.getOutgoingEdges(link.from, command.edgeType)
        for (const edge of edges) {
          if (edge.toId === link.to) {
            this.store.deleteEdge(edge.id)
            deleted++
          }
        }
      }
      return [{ deleted } as T]
    }

    // Single edge deletion by ID
    const id = params.edgeId as string
    this.store.deleteEdge(id)
    return [{ deleted: true } as T]
  }

  private executeQuery<T>(command: InMemoryCommand, params: Record<string, unknown>): T[] {
    // Query commands contain the operation type in params
    const operation = params.operation as string

    switch (operation) {
      case 'getById': {
        const id = params.id as string
        const node = this.store.getNode(id)
        if (!node) return []
        return [{ id: node.id, ...node.properties } as T]
      }

      case 'getByLabel': {
        const label = command.label!
        const nodes = this.store.getNodesByLabel(label)
        return nodes.map((n) => ({ id: n.id, ...n.properties }) as T)
      }

      case 'exists': {
        const id = params.id as string
        return [this.store.hasNode(id) as unknown as T]
      }

      case 'edgeExists': {
        const fromId = params.fromId as string
        const toId = params.toId as string
        const type = command.edgeType
        return [this.store.hasEdge(fromId, toId, type) as unknown as T]
      }

      case 'getParent': {
        const nodeId = params.nodeId as string
        const edgeType = command.edgeType!
        const edges = this.store.getOutgoingEdges(nodeId, edgeType)
        const firstEdge = edges[0]
        if (!firstEdge) return []
        const parent = this.store.getNode(firstEdge.toId)
        if (!parent) return []
        return [{ parentId: parent.id } as T]
      }

      case 'getChildren': {
        const nodeId = params.nodeId as string
        const edgeType = command.edgeType!
        const edges = this.store.getIncomingEdges(nodeId, edgeType)
        return edges
          .map((e) => this.store.getNode(e.fromId))
          .filter((n): n is NonNullable<typeof n> => n !== undefined)
          .map((n) => ({ id: n.id, ...n.properties }) as T)
      }

      case 'getSubtree': {
        const rootId = params.rootId as string
        const edgeType = command.edgeType!
        const results: T[] = []
        const visited = new Set<string>()

        const traverse = (nodeId: string, depth: number): void => {
          if (visited.has(nodeId)) return
          visited.add(nodeId)

          const node = this.store.getNode(nodeId)
          if (!node) return

          // Return node with depth and labels (label as array for consistency with Neo4j)
          results.push({
            node: { id: node.id, ...node.properties },
            depth,
            nodeLabels: [node.label],
          } as T)

          // Get children (nodes that have hasParent edge pointing to this node)
          const childEdges = this.store.getIncomingEdges(nodeId, edgeType)
          for (const edge of childEdges) {
            traverse(edge.fromId, depth + 1)
          }
        }

        traverse(rootId, 0)
        // Sort by depth to ensure root comes first
        return results.sort(
          (a, b) => (a as { depth: number }).depth - (b as { depth: number }).depth,
        )
      }

      case 'wouldCreateCycle': {
        const nodeId = params.nodeId as string
        const newParentId = params.newParentId as string
        const edgeType = command.edgeType!

        // Check if newParentId is a descendant of nodeId (which would create a cycle)
        const visited = new Set<string>()
        const checkDescendants = (currentId: string): boolean => {
          if (currentId === nodeId) return true
          if (visited.has(currentId)) return false
          visited.add(currentId)

          const childEdges = this.store.getIncomingEdges(currentId, edgeType)
          for (const edge of childEdges) {
            if (checkDescendants(edge.fromId)) return true
          }
          return false
        }

        const wouldCycle = checkDescendants(newParentId)
        return [{ wouldCycle } as T]
      }

      default:
        throw new Error(`Unknown query operation: ${operation}`)
    }
  }

  /**
   * Get direct access to the underlying store.
   * Useful for testing and debugging.
   */
  getStore(): GraphStore {
    return this.store
  }
}

/**
 * Create an in-memory database driver.
 */
export function createInMemoryDriver(store?: GraphStore): InMemoryDriver {
  return new InMemoryDriver(store ?? new GraphStore())
}
