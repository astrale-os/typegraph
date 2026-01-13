/**
 * Query Executor
 *
 * Executes compiled queries against Memgraph/Neo4j.
 */

import type { CompiledQuery } from "../compiler"
import type { ConnectionManager } from "./connection"
import type { ExecutionResult, QueryMetadata } from "./types"

/**
 * Options for query execution.
 */
export interface ExecutionOptions {
  timeout?: number
  collectMetadata?: boolean
  mode?: "read" | "write"
}

/**
 * Executes queries against the database.
 */
export class QueryExecutor {
  private readonly connection: ConnectionManager

  constructor(connection: ConnectionManager) {
    this.connection = connection
  }

  async execute<T>(query: CompiledQuery, options?: ExecutionOptions): Promise<ExecutionResult<T[]>> {
    const startTime = Date.now()
    const { records, summary } = await this.connection.run<T>(query.cypher, query.params)

    return {
      data: this.transformResults<T>(records, query),
      metadata: this.buildMetadata(summary, records.length, startTime, options?.collectMetadata),
    }
  }

  async executeSingle<T>(query: CompiledQuery, options?: ExecutionOptions): Promise<ExecutionResult<T>> {
    const result = await this.execute<T>(query, options)

    if (result.data.length === 0) {
      throw new Error("Expected single result but got none")
    }

    if (result.data.length > 1) {
      throw new Error(`Expected single result but got ${result.data.length}`)
    }

    return {
      data: result.data[0]!,
      metadata: result.metadata,
    }
  }

  async executeOptional<T>(query: CompiledQuery, options?: ExecutionOptions): Promise<ExecutionResult<T | null>> {
    const result = await this.execute<T>(query, options)

    return {
      data: result.data[0] ?? null,
      metadata: result.metadata,
    }
  }

  async executeMultiNode<T extends Record<string, unknown>>(
    query: CompiledQuery,
    options?: ExecutionOptions,
  ): Promise<ExecutionResult<T[]>> {
    const startTime = Date.now()
    const { records, summary } = await this.connection.run<T>(query.cypher, query.params)

    const aliases = query.meta.returnAliases ?? []
    const data = this.transformMultiNodeResults<T>(records, aliases)

    return {
      data,
      metadata: this.buildMetadata(summary, records.length, startTime, options?.collectMetadata),
    }
  }

  async *stream<T>(query: CompiledQuery, _options?: ExecutionOptions): AsyncGenerator<T, void, unknown> {
    const { records } = await this.connection.run<Record<string, unknown>>(query.cypher, query.params)

    for (const record of records) {
      yield this.transformRecord<T>(record, query)
    }
  }

  async executeCount(query: CompiledQuery, _options?: ExecutionOptions): Promise<number> {
    const { records } = await this.connection.run<{ count: unknown }>(query.cypher, query.params)

    if (records.length === 0) return 0

    const countValue = records[0]!.count
    return this.toNumber(countValue)
  }

  async executeExists(query: CompiledQuery, _options?: ExecutionOptions): Promise<boolean> {
    const { records } = await this.connection.run<{ exists: boolean }>(query.cypher, query.params)

    if (records.length === 0) return false

    return Boolean(records[0]!.exists)
  }

  private transformResults<T>(records: unknown[], query: CompiledQuery): T[] {
    return records.map((record) => this.transformRecord<T>(record as Record<string, unknown>, query))
  }

  private transformRecord<T>(record: Record<string, unknown>, query: CompiledQuery): T {
    // Get the first key from the record (the node alias)
    const keys = Object.keys(record)

    if (keys.length === 0) {
      return {} as T
    }

    // For single node queries, extract the node properties
    if (query.resultType === "single" || query.resultType === "collection") {
      const nodeData = record[keys[0]!]
      return this.extractNodeProperties(nodeData) as T
    }

    // For scalar results (count, exists), return as-is
    if (query.resultType === "scalar") {
      return record as T
    }

    // For aggregate results, convert Neo4j integers
    if (query.resultType === "aggregate") {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(record)) {
        result[key] = this.convertValue(value)
      }
      return result as T
    }

    return record as T
  }

  private transformMultiNodeResults<T extends Record<string, unknown>>(records: unknown[], aliases: string[]): T[] {
    return records.map((record) => {
      const rec = record as Record<string, unknown>
      const result: Record<string, unknown> = {}

      for (const alias of aliases) {
        const value = rec[alias]
        result[alias] = this.extractNodeProperties(value)
      }

      return result as T
    })
  }

  private extractNodeProperties(nodeData: unknown): Record<string, unknown> {
    if (!nodeData || typeof nodeData !== "object") {
      return {}
    }

    // Neo4j Node object has properties field
    const node = nodeData as { properties?: Record<string, unknown>; [key: string]: unknown }

    if (node.properties) {
      return this.convertProperties(node.properties)
    }

    // Already plain object
    return this.convertProperties(node as Record<string, unknown>)
  }

  private convertProperties(props: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(props)) {
      result[key] = this.convertValue(value)
    }

    return result
  }

  private convertValue(value: unknown): unknown {
    if (value === null || value === undefined) {
      return value
    }

    // Handle Neo4j Integer
    if (
      typeof value === "object" &&
      "toNumber" in value &&
      typeof (value as { toNumber: () => number }).toNumber === "function"
    ) {
      return (value as { toNumber: () => number }).toNumber()
    }

    // Handle Neo4j Date/DateTime
    if (
      typeof value === "object" &&
      "toStandardDate" in value &&
      typeof (value as { toStandardDate: () => Date }).toStandardDate === "function"
    ) {
      return (value as { toStandardDate: () => Date }).toStandardDate()
    }

    // Handle arrays
    if (Array.isArray(value)) {
      return value.map((v) => this.convertValue(v))
    }

    return value
  }

  private toNumber(value: unknown): number {
    if (typeof value === "number") return value
    if (typeof value === "object" && value && "toNumber" in value) {
      return (value as { toNumber: () => number }).toNumber()
    }
    return Number(value)
  }

  private buildMetadata(
    summary: unknown,
    resultCount: number,
    startTime: number,
    collectMetadata?: boolean,
  ): QueryMetadata {
    const executionTimeMs = Date.now() - startTime

    const metadata: QueryMetadata = {
      executionTimeMs,
      resultCount,
    }

    if (collectMetadata && summary && typeof summary === "object") {
      const s = summary as {
        resultAvailableAfter?: { toNumber: () => number }
        server?: { version: string }
        profile?: unknown
        plan?: unknown
      }

      if (s.server?.version) {
        metadata.serverVersion = s.server.version
      }
    }

    return metadata
  }
}
