import type { GraphAdapter, TransactionContext } from '../src/adapter'

/**
 * In-memory mock adapter for testing.
 * Stores nodes and edges in Maps, supports Cypher-like operations
 * by pattern matching on the query string.
 */
export class MockAdapter implements GraphAdapter {
  readonly name = 'mock'
  private connected = false
  private nodes = new Map<string, { type: string; props: Record<string, unknown> }>()
  private edges: Array<{ type: string; from: string; to: string; props: Record<string, unknown> }> =
    []

  async connect(): Promise<void> {
    this.connected = true
  }
  async close(): Promise<void> {
    this.connected = false
  }
  async isConnected(): Promise<boolean> {
    return this.connected
  }

  async transaction<T>(work: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return work({ run: (cypher: string, params?: Record<string, unknown>) => this.query(cypher, params) })
  }

  async query<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    return this.exec(cypher, params ?? {}) as T[]
  }

  async mutate<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
    return this.exec(cypher, params ?? {}) as T[]
  }

  // Simplified Cypher interpreter for testing
  private exec(cypher: string, params: Record<string, unknown>): unknown[] {
    // CREATE node
    if (cypher.startsWith('CREATE (n:')) {
      const id = params.id as string
      const typeMatch = cypher.match(/CREATE \(n:(\w+)/)
      const type = typeMatch?.[1] ?? ''
      const props = { ...(params.props as Record<string, unknown>) }
      delete props.id
      this.nodes.set(id, { type, props })
      return [{ n: { id, ...props } }]
    }

    // MATCH single node by id
    if (cypher.includes('MATCH (n {id: $id}) RETURN n')) {
      const id = params.id as string
      const node = this.nodes.get(id)
      if (!node) return []
      return [{ n: { id, ...node.props }, labels: [node.type] }]
    }

    // MATCH typed node by id
    if (cypher.match(/MATCH \(n:\w+ \{id: \$id\}\) RETURN n/)) {
      const id = params.id as string
      const node = this.nodes.get(id)
      if (!node) return []
      return [{ n: { id, ...node.props } }]
    }

    // UPDATE node
    if (cypher.includes('SET n += $props')) {
      const id = params.id as string
      const node = this.nodes.get(id)
      if (node) {
        Object.assign(node.props, params.props as Record<string, unknown>)
      }
      return []
    }

    // DELETE node
    if (cypher.includes('DETACH DELETE')) {
      const id = params.id as string
      this.nodes.delete(id)
      this.edges = this.edges.filter((e) => e.from !== id && e.to !== id)
      return []
    }

    // CREATE edge
    if (cypher.includes('CREATE (a)-[')) {
      const typeMatch = cypher.match(/\[:(\w+)/)
      const type = typeMatch?.[1] ?? ''
      const from = params.from as string
      const to = params.to as string
      const props = (params.props as Record<string, unknown>) ?? {}
      this.edges.push({ type, from, to, props })
      return []
    }

    // DELETE edge
    if (cypher.match(/MATCH.*DELETE r/)) {
      const from = params.from as string
      const to = params.to as string
      const typeMatch = cypher.match(/\[:(\w+)\]/)
      const type = typeMatch?.[1] ?? ''
      this.edges = this.edges.filter((e) => !(e.type === type && e.from === from && e.to === to))
      return []
    }

    // COUNT edges (from side)
    if (cypher.includes('(n {id: $nodeId})-[') && cypher.includes('count(*)')) {
      const nodeId = params.nodeId as string
      const typeMatch = cypher.match(/\[:(\w+)\]/)
      const type = typeMatch?.[1] ?? ''
      const count = cypher.includes('->()')
        ? this.edges.filter((e) => e.type === type && e.from === nodeId).length
        : this.edges.filter((e) => e.type === type && e.to === nodeId).length
      return [{ c: count }]
    }

    // EDGE EXISTS
    if (cypher.includes('->(b {id: $to})') && cypher.includes('count(*)')) {
      const from = params.from as string
      const to = params.to as string
      const typeMatch = cypher.match(/\[:(\w+)\]/)
      const type = typeMatch?.[1] ?? ''
      const count = this.edges.filter(
        (e) => e.type === type && e.from === from && e.to === to,
      ).length
      return [{ c: count }]
    }

    // IS REACHABLE (simplified: only direct path)
    if (cypher.includes('*]->') && cypher.includes('count(path)')) {
      const from = params.from as string
      const to = params.to as string
      const typeMatch = cypher.match(/\[:(\w+)\*\]/)
      const type = typeMatch?.[1] ?? ''
      const isReachable = this.isReachableInternal(from, to, type, new Set())
      return [{ c: isReachable ? 1 : 0 }]
    }

    // FIND EDGE
    if (cypher.includes('RETURN r') && cypher.includes('-[r:')) {
      const from = params.from as string
      const to = params.to as string
      const typeMatch = cypher.match(/\[r:(\w+)\]/)
      const type = typeMatch?.[1] ?? ''
      const edge = this.edges.find((e) => e.type === type && e.from === from && e.to === to)
      if (!edge) return []
      return [{ r: { ...edge.props } }]
    }

    // FIND NODES (MATCH (n:Type) ... RETURN n)
    if (cypher.match(/MATCH \(n:\w+\)/)) {
      const typeMatch = cypher.match(/MATCH \(n:(\w+)\)/)
      const type = typeMatch?.[1] ?? ''
      let results = [...this.nodes.entries()]
        .filter(([, v]) => v.type === type)
        .map(([id, v]) => ({ n: { id, ...v.props } }))

      // Apply simple where
      if (params) {
        for (const [key, val] of Object.entries(params)) {
          if (key.startsWith('w')) {
            // Extract field from the where clause
            const fieldMatch = cypher.match(new RegExp(`n\\.(\\w+)\\s*=\\s*\\$${key}`))
            if (fieldMatch) {
              const field = fieldMatch[1]
              results = results.filter((r) => (r.n as Record<string, unknown>)[field!] === val)
            }
          }
        }
      }

      // COUNT
      if (cypher.includes('count(n) AS c')) {
        return [{ c: results.length }]
      }

      // LIMIT
      const limitMatch = cypher.match(/LIMIT (\d+)/)
      if (limitMatch) results = results.slice(0, parseInt(limitMatch[1]))

      return results
    }

    // TRAVERSE (pattern: (start {id: $startId})-[:TYPE]->(target))
    if (cypher.includes('$startId') && cypher.includes('RETURN target')) {
      const startId = params.startId as string
      const typeMatch = cypher.match(/\[:(\w+)\]/)
      const type = typeMatch?.[1] ?? ''
      const isOut = cypher.includes('->(target)')

      const targetIds = this.edges
        .filter((e) => e.type === type && (isOut ? e.from === startId : e.to === startId))
        .map((e) => (isOut ? e.to : e.from))

      return targetIds
        .map((id) => {
          const node = this.nodes.get(id)
          if (!node) return null
          return { target: { id, ...node.props }, labels: [node.type] }
        })
        .filter(Boolean) as unknown[]
    }

    return []
  }

  private isReachableInternal(
    from: string,
    to: string,
    type: string,
    visited: Set<string>,
  ): boolean {
    if (visited.has(from)) return false
    visited.add(from)
    for (const e of this.edges) {
      if (e.type === type && e.from === from) {
        if (e.to === to) return true
        if (this.isReachableInternal(e.to, to, type, visited)) return true
      }
    }
    return false
  }
}
