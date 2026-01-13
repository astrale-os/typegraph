/**
 * In-Memory Graph
 *
 * Main entry point for creating an in-memory typegraph instance.
 * Provides the same API as the regular typegraph, but executes
 * everything in-memory without any external database.
 */

import type {
  SchemaDefinition,
  AnySchema,
  ExecutorConfig,
  QueryExecutor,
  MutationExecutor,
  TransactionRunner,
  IdGenerator,
  QueryAST,
} from "@astrale/typegraph"
import { GraphQuery, createGraphWithExecutors, defaultIdGenerator } from "@astrale/typegraph"
import { GraphStore, type StoredNode, type StoredEdge } from "./store"
import { QueryEngine, type QueryEngineConfig } from "./engine"
import { InMemoryTemplates } from "./templates"

/**
 * Configuration for in-memory graph.
 */
export interface InMemoryGraphConfig {
  /** Custom ID generator (defaults to UUID) */
  idGenerator?: IdGenerator
  /** Query engine configuration */
  queryEngine?: QueryEngineConfig
  /** Initial data to populate the graph */
  initialData?: {
    nodes?: Array<{ label: string; id: string; properties: Record<string, unknown> }>
    edges?: Array<{
      type: string
      id: string
      fromId: string
      toId: string
      properties?: Record<string, unknown>
    }>
  }
}

/**
 * Extended GraphQuery with in-memory specific methods.
 */
export interface InMemoryGraph<S extends AnySchema> extends GraphQuery<S> {
  /** Get the underlying store for testing/debugging */
  getStore(): GraphStore
  /** Clear all data from the graph */
  clear(): void
  /** Export graph data */
  export(): { nodes: StoredNode[]; edges: StoredEdge[] }
  /** Import graph data */
  import(data: { nodes: StoredNode[]; edges: StoredEdge[] }): void
  /** Get store statistics */
  stats(): { nodes: number; edges: number; labels: number; edgeTypes: number }
}
/**
 * Query executor that uses our in-memory query engine.
 *
 * When AST is provided (the preferred path), executes directly via the QueryEngine.
 * Falls back to limited Cypher parsing for backwards compatibility.
 */
class InMemoryQueryExecutor implements QueryExecutor {
  constructor(
    private readonly engine: QueryEngine,
    private readonly store: GraphStore,
  ) {}

  /**
   * Execute a query.
   *
   * @param query - The compiled Cypher query (used as fallback)
   * @param params - Query parameters
   * @param ast - Optional AST for direct execution (preferred path)
   *
   * IMPORTANT: Results must be wrapped like Neo4j does: { n: nodeData }
   * because the typegraph query layer uses extractNodeFromRecord which
   * expects the first key's value to contain the node.
   */
  async run<T>(query: string, params?: Record<string, unknown>, ast?: QueryAST): Promise<T[]> {
    // PREFERRED PATH: If AST is provided, execute directly via QueryEngine
    if (ast) {
      const results = this.engine.execute(ast)
      return results as T[]
    }

    // Handle special operations (used by getAncestorPath, etc.)
    if (params?.operation) {
      return this.executeOperation<T>(params)
    }

    // FALLBACK PATH: Try to handle simple queries by parsing Cypher
    // This path is for backwards compatibility and simple queries

    // Check if this is a simple node-by-id query we can handle directly
    if (params?.id && query.includes("WHERE") && query.includes(".id =")) {
      const id = params.id as string
      const node = this.store.getNode(id)
      if (node) {
        // Wrap in Neo4j-style format: { n: nodeData }
        return [{ n: { id: node.id, ...node.properties } } as T]
      }
      return []
    }

    // Fallback: try to extract label from MATCH clause and return all nodes
    const matchLabel = query.match(/MATCH\s+\([^:]+:(\w+)\)/i)?.[1]
    if (matchLabel) {
      const nodes = this.store.getNodesByLabel(matchLabel)

      // Apply any filters if we can parse them
      let filteredNodes = nodes

      // Handle simple WHERE id = $p0 or WHERE n.id = $p0
      if (params && query.includes("WHERE")) {
        const paramKeys = Object.keys(params)
        for (const key of paramKeys) {
          if (query.includes(`.id = $${key}`) || query.includes(`id = $${key}`)) {
            const id = params[key] as string
            filteredNodes = filteredNodes.filter((n) => n.id === id)
          }
        }
      }

      // Handle LIMIT
      const limitMatch = query.match(/LIMIT\s+(\d+)/i)
      if (limitMatch) {
        const limit = parseInt(limitMatch[1] ?? "0", 10)
        filteredNodes = filteredNodes.slice(0, limit)
      }

      // Wrap in Neo4j-style format: { n: nodeData }
      return filteredNodes.map((n) => ({ n: { id: n.id, ...n.properties } }) as T)
    }

    // Cannot handle this query
    throw new Error(
      `In-memory executor cannot parse Cypher query and no AST was provided. ` +
        `For complex queries, ensure AST is passed to the executor.\n\nQuery: ${query}`,
    )
  }

  /**
   * Execute special operations that can't be expressed via AST.
   */
  private executeOperation<T>(params: Record<string, unknown>): T[] {
    const operation = params.operation as string

    switch (operation) {
      case "getAncestorPath": {
        // Get the path from a node to root via hierarchy edge (label-agnostic)
        const nodeId = params.nodeId as string
        const edgeType = (params.edgeType as string) ?? "hasParent"

        const path: Array<{ id: string }> = []
        const visited = new Set<string>()
        let current: string | undefined = nodeId

        while (current && !visited.has(current)) {
          const node = this.store.getNode(current)
          if (!node) break

          path.push({ id: current })
          visited.add(current)

          // Get parent via outgoing hierarchy edge
          const parentEdges = this.store.getOutgoingEdges(current, edgeType)
          current = parentEdges[0]?.toId
        }

        return path as T[]
      }

      default:
        throw new Error(`Unknown query operation: ${operation}`)
    }
  }
}

/**
 * Mutation executor for in-memory operations.
 */
class InMemoryMutationExecutor implements MutationExecutor {
  constructor(
    private readonly store: GraphStore,
    private readonly idGenerator: IdGenerator,
  ) {}

  async run<T>(query: string, params: Record<string, unknown>): Promise<T[]> {
    // Parse the INMEM command
    if (!query.startsWith("INMEM:")) {
      throw new Error(`In-memory mutation executor expects INMEM commands, got: ${query}`)
    }

    const command = JSON.parse(query.slice(6)) as {
      type: string
      label?: string
      edgeType?: string
      params: Record<string, unknown>
      hierarchy?: string
      upsert?: boolean
      batch?: boolean
      byEndpoints?: boolean
      byId?: boolean
    }

    // Merge command params with execution params
    const allParams = { ...command.params, ...params }

    switch (command.type) {
      case "createNode": {
        if (command.hierarchy === "createChild") {
          return this.createChild<T>(command.label!, command.edgeType!, allParams)
        }
        return this.createNode<T>(command.label!, allParams, command.upsert)
      }

      case "updateNode":
        return this.updateNode<T>(allParams)

      case "deleteNode": {
        if (command.hierarchy === "deleteSubtree") {
          return this.deleteSubtree<T>(allParams, command.edgeType!)
        }
        return this.deleteNode<T>(allParams)
      }

      case "createEdge":
        return this.createEdge<T>(command.edgeType!, allParams)

      case "updateEdge": {
        if (command.hierarchy === "move") {
          return this.moveNode<T>(allParams, command.edgeType!)
        }
        return this.updateEdge<T>(command.edgeType!, allParams)
      }

      case "deleteEdge": {
        if (command.byEndpoints) {
          return this.deleteEdgeByEndpoints<T>(command.edgeType!, allParams)
        }
        return this.deleteEdgeById<T>(allParams)
      }

      case "query":
        return this.executeQuery<T>(command, allParams)

      default:
        throw new Error(`Unknown command type: ${command.type}`)
    }
  }

  async runInTransaction<T>(fn: (tx: TransactionRunner) => Promise<T>): Promise<T> {
    this.store.beginTransaction()

    const txRunner: TransactionRunner = {
      run: async <R>(query: string, params: Record<string, unknown>): Promise<R[]> => {
        return this.run<R>(query, params)
      },
    }

    try {
      const result = await fn(txRunner)
      this.store.commit()
      return result
    } catch (error) {
      this.store.rollback()
      throw error
    }
  }

  private createNode<T>(label: string, params: Record<string, unknown>, upsert?: boolean): T[] {
    const id = (params.id as string) ?? this.idGenerator.generate(label)
    const props = (params.props as Record<string, unknown>) ?? {}

    if (upsert && this.store.hasNode(id)) {
      this.store.updateNode(id, props)
      const updated = this.store.getNode(id)!
      // Return in format expected by mutations layer: { n: NodeProps }
      return [{ n: { id: updated.id, ...updated.properties } } as T]
    }

    const now = new Date()
    this.store.createNode({
      id,
      label,
      properties: props,
      createdAt: now,
      updatedAt: now,
    })

    // Return in format expected by mutations layer: { n: NodeProps }
    return [{ n: { id, ...props } } as T]
  }

  private createChild<T>(label: string, edgeType: string, params: Record<string, unknown>): T[] {
    const childId = (params.id as string) ?? this.idGenerator.generate(label)
    const parentId = params.parentId as string
    const props = (params.props as Record<string, unknown>) ?? {}

    // Create child node
    const now = new Date()
    this.store.createNode({
      id: childId,
      label,
      properties: props,
      createdAt: now,
      updatedAt: now,
    })

    // Create parent edge
    const edgeId = this.idGenerator.generate(edgeType)
    this.store.createEdge({
      id: edgeId,
      type: edgeType,
      fromId: childId,
      toId: parentId,
      properties: {},
      createdAt: now,
    })

    // Return in format expected by mutations layer: { child: NodeProps }
    return [{ child: { id: childId, ...props } } as T]
  }

  private updateNode<T>(params: Record<string, unknown>): T[] {
    const id = params.id as string
    const props = (params.props as Record<string, unknown>) ?? {}

    this.store.updateNode(id, props)
    const updated = this.store.getNode(id)!

    // Return in format expected by mutations layer: { n: NodeProps }
    return [{ n: { id: updated.id, ...updated.properties } } as T]
  }

  private deleteNode<T>(params: Record<string, unknown>): T[] {
    const id = params.id as string
    this.store.deleteNode(id)
    return [{ deleted: true, id } as T]
  }

  private deleteSubtree<T>(params: Record<string, unknown>, edgeType: string): T[] {
    const rootId = params.rootId as string
    const deleted: string[] = []

    const deleteRecursive = (nodeId: string): void => {
      // Get children first
      const childEdges = this.store.getIncomingEdges(nodeId, edgeType)
      for (const edge of childEdges) {
        deleteRecursive(edge.fromId)
      }

      // Delete this node
      this.store.deleteNode(nodeId)
      deleted.push(nodeId)
    }

    deleteRecursive(rootId)

    return [{ deleted: true, count: deleted.length, ids: deleted } as T]
  }

  private createEdge<T>(edgeType: string, params: Record<string, unknown>): T[] {
    const id = (params.edgeId as string) ?? this.idGenerator.generate(edgeType)
    const fromId = params.fromId as string
    const toId = params.toId as string
    const props = (params.props as Record<string, unknown>) ?? {}

    this.store.createEdge({
      id,
      type: edgeType,
      fromId,
      toId,
      properties: props,
      createdAt: new Date(),
    })

    // Return in format expected by mutations layer: { r: EdgeProps, fromId, toId }
    return [{ r: { id, ...props }, fromId, toId } as T]
  }

  private updateEdge<T>(edgeType: string, params: Record<string, unknown>): T[] {
    const fromId = params.fromId as string
    const toId = params.toId as string
    const props = (params.props as Record<string, unknown>) ?? {}

    // Find edge by from/to pair
    const edges = this.store.getOutgoingEdges(fromId, edgeType)
    const edge = edges.find((e) => e.toId === toId)
    if (!edge) {
      throw new Error(`Edge not found: ${edgeType} from ${fromId} to ${toId}`)
    }

    this.store.updateEdge(edge.id, props)
    const updated = this.store.getEdge(edge.id)!

    // Return in format expected by mutations layer: { r: EdgeProps, fromId, toId }
    return [
      {
        r: { id: updated.id, ...updated.properties },
        fromId: updated.fromId,
        toId: updated.toId,
      } as T,
    ]
  }

  private moveNode<T>(params: Record<string, unknown>, edgeType: string): T[] {
    const nodeId = params.nodeId as string
    const newParentId = params.newParentId as string

    // Find and delete existing parent edge
    const existingEdges = this.store.getOutgoingEdges(nodeId, edgeType)
    for (const edge of existingEdges) {
      this.store.deleteEdge(edge.id)
    }

    // Create new parent edge
    const edgeId = this.idGenerator.generate(edgeType)
    this.store.createEdge({
      id: edgeId,
      type: edgeType,
      fromId: nodeId,
      toId: newParentId,
      properties: {},
      createdAt: new Date(),
    })

    return [{ moved: true, nodeId, newParentId } as T]
  }

  private deleteEdgeByEndpoints<T>(edgeType: string, params: Record<string, unknown>): T[] {
    const fromId = params.fromId as string
    const toId = params.toId as string

    const edge = this.store.findEdge(fromId, toId, edgeType)
    if (edge) {
      this.store.deleteEdge(edge.id)
      return [{ deleted: true, id: edge.id } as T]
    }

    return [{ deleted: false } as T]
  }

  private deleteEdgeById<T>(params: Record<string, unknown>): T[] {
    const id = params.edgeId as string
    this.store.deleteEdge(id)
    return [{ deleted: true, id } as T]
  }

  private executeQuery<T>(
    command: { params: Record<string, unknown>; edgeType?: string },
    params: Record<string, unknown>,
  ): T[] {
    const operation = params.operation ?? command.params.operation

    switch (operation) {
      case "getById": {
        const id = params.id as string
        const node = this.store.getNode(id)
        return node ? [{ id: node.id, ...node.properties } as T] : []
      }

      case "edgeExists": {
        const fromId = params.fromId as string
        const toId = params.toId as string
        return [this.store.hasEdge(fromId, toId, command.edgeType) as unknown as T]
      }

      case "getParent": {
        const nodeId = params.nodeId as string
        const edges = this.store.getOutgoingEdges(nodeId, command.edgeType)
        if (edges.length === 0 || edges[0]?.toId === undefined) return []
        const parent = this.store.getNode(edges[0].toId)
        return parent ? [{ id: parent.id, ...parent.properties } as T] : []
      }

      case "getChildren": {
        const nodeId = params.nodeId as string
        const edges = this.store.getIncomingEdges(nodeId, command.edgeType)
        return edges
          .map((e) => this.store.getNode(e.fromId))
          .filter((n): n is NonNullable<typeof n> => n !== undefined)
          .map((n) => ({ id: n.id, ...n.properties }) as T)
      }

      case "wouldCreateCycle": {
        // Check if moving nodeId under newParentId would create a cycle
        const nodeId = params.nodeId as string
        const newParentId = params.newParentId as string
        const edgeType = command.edgeType!

        const visited = new Set<string>()
        let current: string | undefined = newParentId

        while (current) {
          if (current === nodeId) {
            return [{ wouldCycle: true } as T]
          }
          if (visited.has(current)) break
          visited.add(current)

          const parentEdges = this.store.getOutgoingEdges(current, edgeType)
          current = parentEdges[0]?.toId
        }

        return [{ wouldCycle: false } as T]
      }

      case "getSubtree": {
        // Get all nodes in a subtree starting from rootId, following hierarchy edge
        // Returns nodes with their depth from root and labels, ordered by depth (root first)
        const rootId = params.rootId as string
        const edgeType = command.edgeType!

        const results: Array<{
          node: Record<string, unknown>
          depth: number
          nodeLabels: string[]
        }> = []
        const visited = new Set<string>()

        // BFS to collect all nodes with their depths
        const queue: Array<{ nodeId: string; depth: number }> = [{ nodeId: rootId, depth: 0 }]

        while (queue.length > 0) {
          const current = queue.shift()!
          if (visited.has(current.nodeId)) continue
          visited.add(current.nodeId)

          const node = this.store.getNode(current.nodeId)
          if (!node) continue

          results.push({
            node: { id: node.id, ...node.properties },
            depth: current.depth,
            nodeLabels: [node.label], // Include the node's label
          })

          // Get children (nodes that have edgeType pointing TO this node)
          const childEdges = this.store.getIncomingEdges(current.nodeId, edgeType)
          for (const edge of childEdges) {
            if (!visited.has(edge.fromId)) {
              queue.push({ nodeId: edge.fromId, depth: current.depth + 1 })
            }
          }
        }

        // Sort by depth (root first)
        results.sort((a, b) => a.depth - b.depth)

        return results as T[]
      }

      case "getAncestorPath": {
        // Get the path from a node to root via hierarchy edge (label-agnostic)
        // Returns array of node IDs: [nodeId, parentId, grandparentId, ...]
        const nodeId = params.nodeId as string
        const edgeType = command.edgeType!

        const path: string[] = []
        const visited = new Set<string>()
        let current: string | undefined = nodeId

        while (current && !visited.has(current)) {
          const node = this.store.getNode(current)
          if (!node) break

          path.push(current)
          visited.add(current)

          // Get parent via outgoing hasParent edge
          const parentEdges = this.store.getOutgoingEdges(current, edgeType)
          current = parentEdges[0]?.toId
        }

        return path as unknown as T[]
      }

      default:
        throw new Error(`Unknown query operation: ${operation}`)
    }
  }
}

/**
 * Create an in-memory graph instance.
 *
 * This provides the same API as the regular typegraph, but stores
 * all data in memory. Perfect for testing, prototyping, and
 * environments where you don't want to run a database.
 *
 * @example
 * ```typescript
 * import { defineSchema, node, edge } from 'typegraph';
 * import { createInMemoryGraph } from '@astrale/typegraph-memory';
 *
 * const schema = defineSchema({
 *   nodes: {
 *     user: node({ properties: { name: z.string() } }),
 *   },
 *   edges: {},
 * });
 *
 * const graph = createInMemoryGraph(schema);
 *
 * // Use the same API as regular typegraph
 * const user = await graph.mutate.create('user', { name: 'John' });
 * const users = await graph.node('user').execute();
 * ```
 */
export function createInMemoryGraph<S extends AnySchema>(
  schema: S,
  config: InMemoryGraphConfig = {},
): InMemoryGraph<S> {
  const store = new GraphStore()
  const engine = new QueryEngine(store, config.queryEngine)
  const idGenerator = config.idGenerator ?? defaultIdGenerator

  // Populate initial data if provided
  if (config.initialData) {
    const now = new Date()
    for (const node of config.initialData.nodes ?? []) {
      store.createNode({
        id: node.id,
        label: node.label,
        properties: node.properties,
        createdAt: now,
        updatedAt: now,
      })
    }
    for (const edge of config.initialData.edges ?? []) {
      store.createEdge({
        id: edge.id,
        type: edge.type,
        fromId: edge.fromId,
        toId: edge.toId,
        properties: edge.properties ?? {},
        createdAt: now,
      })
    }
  }

  // Create executors
  const queryExecutor = new InMemoryQueryExecutor(engine, store)
  const mutationExecutor = new InMemoryMutationExecutor(store, idGenerator)

  // Create the graph instance
  const graphConfig: ExecutorConfig = {
    queryExecutor,
    mutationExecutor,
    mutationTemplates: new InMemoryTemplates(),
    idGenerator,
  }

  const graph = createGraphWithExecutors(schema, graphConfig) as unknown as InMemoryGraph<S>

  // Add in-memory specific methods
  ;(graph as any).getStore = () => store
  ;(graph as any).clear = () => store.clear()
  ;(graph as any).export = () => store.export()
  ;(graph as any).import = (data: { nodes: StoredNode[]; edges: StoredEdge[] }) =>
    store.import(data)
  ;(graph as any).stats = () => store.stats()
  ;(graph as any).getAncestorPathSync = (nodeId: string, edgeType?: string): string[] => {
    const edge = edgeType ?? schema.hierarchy?.defaultEdge ?? "hasParent"
    const path: string[] = []
    const visited = new Set<string>()
    let current: string | undefined = nodeId

    while (current && !visited.has(current)) {
      const node = store.getNode(current)
      if (!node) break

      path.push(current)
      visited.add(current)

      // Get parent via outgoing hierarchy edge
      const parentEdges = store.getOutgoingEdges(current, edge)
      current = parentEdges[0]?.toId
    }

    return path
  }

  return graph
}
