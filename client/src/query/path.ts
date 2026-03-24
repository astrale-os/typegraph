/**
 * Path Builder
 *
 * Represents queries that return paths (sequences of nodes and edges).
 * Used for shortest path, all paths, and path analysis.
 */

import type { NodeLabels, EdgeTypes } from '../inference'
import type { ResolveNode } from '../resolve'
import type { SchemaShape, TypeMap, UntypedMap } from '../schema'
import type { QueryAST, ComparisonOperator } from './ast'
import type { CompiledQuery } from './compiler'

import { getCompiler } from './compiler'

/**
 * A single node in a path.
 */
export interface PathNode<S extends SchemaShape> {
  label: NodeLabels<S>
  properties: Record<string, unknown>
}

/**
 * A single edge in a path.
 */
export interface PathEdge<S extends SchemaShape> {
  type: EdgeTypes<S>
  properties: Record<string, unknown>
  startNodeIndex: number
  endNodeIndex: number
}

/**
 * A complete path from start to end.
 */
export interface PathResult<S extends SchemaShape> {
  nodes: PathNode<S>[]
  edges: PathEdge<S>[]
  length: number
}

/**
 * Builder for path-finding queries.
 *
 * @template S - Schema type
 * @template NStart - Starting node label
 * @template NEnd - Ending node label
 */
export class PathBuilder<
  S extends SchemaShape,
  NStart extends NodeLabels<S>,
  NEnd extends NodeLabels<S>,
  T extends TypeMap = UntypedMap,
> {
  protected readonly _ast: QueryAST
  protected readonly _schema: S

  constructor(ast: QueryAST, schema: S) {
    this._ast = ast
    this._schema = schema
  }

  maxHops(_count: number): PathBuilder<S, NStart, NEnd, T> {
    throw new Error('Not implemented')
  }

  whereEdge<K extends string>(
    _field: K,
    _operator: ComparisonOperator,
    _value: unknown,
  ): PathBuilder<S, NStart, NEnd, T> {
    throw new Error('Not implemented')
  }

  whereIntermediateNode<K extends string>(
    _field: K,
    _operator: ComparisonOperator,
    _value: unknown,
  ): PathBuilder<S, NStart, NEnd, T> {
    throw new Error('Not implemented')
  }

  compile(): CompiledQuery {
    return getCompiler(this._schema).compile(this._ast)
  }

  toCypher(): string {
    return this.compile().cypher
  }

  async execute(): Promise<PathResult<S> | PathResult<S>[] | null> {
    throw new Error('Not implemented')
  }

  async endNodes(): Promise<ResolveNode<T, NEnd & string>[]> {
    throw new Error('Not implemented')
  }

  async exists(): Promise<boolean> {
    throw new Error('Not implemented')
  }

  async length(): Promise<number | null> {
    throw new Error('Not implemented')
  }
}
