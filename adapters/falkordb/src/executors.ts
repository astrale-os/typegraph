/**
 * Query and mutation executors for FalkorDB.
 */

import type { Graph } from 'falkordb'
import { transformResults } from './transform'

export interface QueryExecutor {
  run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>
}

export interface MutationExecutor {
  run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]>
  runInTransaction<T>(fn: (tx: TransactionRunner) => Promise<T>): Promise<T>
}

export interface TransactionRunner {
  run<R>(cypher: string, params: Record<string, unknown>): Promise<R[]>
}

/**
 * FalkorDB QueryParam type (matches internal FalkorDB definition).
 */
type QueryParam = null | string | number | boolean | QueryParams | Array<QueryParam>

type QueryParams = {
  [key: string]: QueryParam
}

/**
 * Convert unknown params to FalkorDB QueryParam type.
 */
function toQueryParams(params: Record<string, unknown>): QueryParams {
  return params as QueryParams
}

/**
 * Create a query executor that uses roQuery for read-only operations.
 */
export function createQueryExecutor(graph: Graph): QueryExecutor {
  return {
    async run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
      // Use roQuery for read-only optimization
      const result = await graph.roQuery(
        cypher,
        params ? { params: toQueryParams(params) } : undefined
      )
      return transformResults(result.data) as T[]
    },
  }
}

/**
 * Create a mutation executor for write operations.
 */
export function createMutationExecutor(graph: Graph): MutationExecutor {
  return {
    async run<T>(cypher: string, params?: Record<string, unknown>): Promise<T[]> {
      // Use query for writes
      const result = await graph.query(
        cypher,
        params ? { params: toQueryParams(params) } : undefined
      )
      return transformResults(result.data) as T[]
    },

    async runInTransaction<T>(fn: (tx: TransactionRunner) => Promise<T>): Promise<T> {
      // FalkorDB doesn't have explicit transactions, but we can simulate
      // by running queries sequentially
      const runner: TransactionRunner = {
        async run<R>(cypher: string, params: Record<string, unknown>): Promise<R[]> {
          const result = await graph.query(cypher, { params: toQueryParams(params) })
          return transformResults(result.data) as R[]
        },
      }
      return fn(runner)
    },
  }
}
