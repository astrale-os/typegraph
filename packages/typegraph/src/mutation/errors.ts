/**
 * Mutation Error Types
 *
 * Specific error types for mutation operations.
 */

import { GraphQueryError } from "../errors"

/**
 * Base error for mutation operations.
 */
export class MutationError extends GraphQueryError {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly nodeLabel?: string,
    public readonly nodeId?: string,
    cause?: Error,
  ) {
    super(message, cause)
    this.name = "MutationError"
  }
}

/**
 * Error when a node is not found.
 */
export class NodeNotFoundError extends MutationError {
  constructor(label: string, id: string) {
    super(`Node not found: ${label} with id '${id}'`, "query", label, id)
    this.name = "NodeNotFoundError"
  }
}

/**
 * Error when an edge already exists.
 */
export class EdgeExistsError extends MutationError {
  constructor(
    public readonly edgeType: string,
    public readonly fromId: string,
    public readonly toId: string,
  ) {
    super(`Edge already exists: ${edgeType} from '${fromId}' to '${toId}'`, "link")
    this.name = "EdgeExistsError"
  }
}

/**
 * Error when an edge is not found.
 */
export class EdgeNotFoundError extends MutationError {
  constructor(
    public readonly edgeType: string,
    public readonly fromId?: string,
    public readonly toId?: string,
    public readonly edgeId?: string,
  ) {
    const details = edgeId ? `id '${edgeId}'` : `from '${fromId}' to '${toId}'`
    super(`Edge not found: ${edgeType} ${details}`, "unlink")
    this.name = "EdgeNotFoundError"
  }
}

/**
 * Error when a move operation would create a cycle.
 */
export class CycleDetectedError extends MutationError {
  constructor(
    nodeId: string,
    public readonly targetId: string,
  ) {
    super(`Cannot move: would create cycle (${nodeId} -> ${targetId})`, "move", undefined, nodeId)
    this.name = "CycleDetectedError"
  }
}

/**
 * Error when a parent node is not found.
 */
export class ParentNotFoundError extends MutationError {
  constructor(parentId: string) {
    super(`Parent node not found: '${parentId}'`, "createChild", undefined, parentId)
    this.name = "ParentNotFoundError"
  }
}

/**
 * Error when source node for clone is not found.
 */
export class SourceNotFoundError extends MutationError {
  constructor(label: string, sourceId: string) {
    super(`Source node not found for clone: ${label} with id '${sourceId}'`, "clone", label, sourceId)
    this.name = "SourceNotFoundError"
  }
}

/**
 * Error when a transaction fails.
 */
export class TransactionError extends MutationError {
  constructor(
    message: string,
    public readonly operations: string[],
    cause?: Error,
  ) {
    super(message, "transaction", undefined, undefined, cause)
    this.name = "TransactionError"
  }
}

/**
 * Error when validation fails before mutation.
 */
export class ValidationError extends MutationError {
  constructor(
    message: string,
    public readonly field?: string,
    public readonly expected?: string,
    public readonly received?: unknown,
  ) {
    super(message, "validation")
    this.name = "ValidationError"
  }
}
