/**
 * Path Builder
 *
 * Represents queries that return paths (sequences of nodes and edges).
 * Used for shortest path, all paths, and path analysis.
 */

import type { QueryAST } from "../ast"
import type { CompiledQuery } from "../compiler"
import { CypherCompiler } from "../compiler"
import type { AnySchema, NodeLabels, EdgeTypes, NodeProps } from "../schema"

/**
 * A single node in a path.
 */
export interface PathNode<S extends AnySchema> {
  label: NodeLabels<S>
  properties: Record<string, unknown>
}

/**
 * A single edge in a path.
 */
export interface PathEdge<S extends AnySchema> {
  type: EdgeTypes<S>
  properties: Record<string, unknown>
  startNodeIndex: number
  endNodeIndex: number
}

/**
 * A complete path from start to end.
 */
export interface PathResult<S extends AnySchema> {
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
export class PathBuilder<S extends AnySchema, NStart extends NodeLabels<S>, NEnd extends NodeLabels<S>> {
  protected readonly _ast: QueryAST
  protected readonly _schema: S

  constructor(ast: QueryAST, schema: S) {
    this._ast = ast
    this._schema = schema
  }

  maxHops(_count: number): PathBuilder<S, NStart, NEnd> {
    throw new Error("Not implemented")
  }

  whereEdge<K extends string>(
    _field: K,
    _operator: import("../ast").ComparisonOperator,
    _value: unknown,
  ): PathBuilder<S, NStart, NEnd> {
    throw new Error("Not implemented")
  }

  whereIntermediateNode<K extends string>(
    _field: K,
    _operator: import("../ast").ComparisonOperator,
    _value: unknown,
  ): PathBuilder<S, NStart, NEnd> {
    throw new Error("Not implemented")
  }

  compile(): CompiledQuery {
    const compiler = new CypherCompiler(this._schema)
    return compiler.compile(this._ast)
  }

  toCypher(): string {
    return this.compile().cypher
  }

  async execute(): Promise<PathResult<S> | PathResult<S>[] | null> {
    throw new Error("Not implemented")
  }

  async endNodes(): Promise<NodeProps<S, NEnd>[]> {
    throw new Error("Not implemented")
  }

  async exists(): Promise<boolean> {
    throw new Error("Not implemented")
  }

  async length(): Promise<number | null> {
    throw new Error("Not implemented")
  }
}
