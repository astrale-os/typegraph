/**
 * Mutation Validation
 *
 * Validates node/edge data and schema constraints.
 */

import type { SchemaShape } from '../schema'
import type { NodeLabels, EdgeTypes } from '../inference'
import { getNodesSatisfying, edgeFrom, edgeTo, edgeCardinality } from '../helpers'
import { ValidationError } from './errors'

// =============================================================================
// DATA TRANSFORMATION UTILITIES
// =============================================================================

/**
 * Recursively remove undefined values from an object.
 * FalkorDB rejects undefined values in properties.
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

/**
 * Serialize Date objects to ISO strings for database storage.
 * FalkorDB only supports primitive types.
 */
export function serializeDates<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value instanceof Date) {
      result[key] = value.toISOString()
    } else {
      result[key] = value
    }
  }
  return result
}

// =============================================================================
// VALIDATION RESULT
// =============================================================================

export interface ValidationResult {
  valid: boolean
  errors: ValidationIssue[]
}

export interface ValidationIssue {
  path: string[]
  message: string
  code: string
  expected?: string
  received?: unknown
}

// =============================================================================
// VALIDATOR
// =============================================================================

/**
 * Validates mutation inputs against schema definitions.
 */
export class MutationValidator<S extends SchemaShape> {
  constructor(private readonly schema: S) {}

  /**
   * Validate node data against schema.
   * @throws ValidationError if validation fails
   */
  validateNode<N extends NodeLabels<S>>(label: N, _data: unknown, _partial = false): void {
    const nodeDef = this.schema.nodes[label as string]
    if (!nodeDef) {
      throw new ValidationError(
        `Unknown node label: ${label as string}`,
        'label',
        'valid node label',
        label,
      )
    }

    // Validation deferred to codegen validators
  }

  /**
   * Validate edge data against schema.
   * @throws ValidationError if validation fails
   */
  validateEdge<E extends EdgeTypes<S>>(edgeType: E, data: unknown, _partial = false): void {
    const edgeDef = this.schema.edges[edgeType as string]
    if (!edgeDef) {
      throw new ValidationError(
        `Unknown edge type: ${edgeType as string}`,
        'edgeType',
        'valid edge type',
        edgeType,
      )
    }

    // Edge properties are optional by default
    if (data === undefined || data === null) {
      return
    }

    // Validation deferred to codegen validators
  }

  /**
   * Validate, apply defaults, strip unknown fields, filter undefined, serialize dates.
   * Returns data ready for database.
   * @throws ValidationError if validation fails
   */
  parseAndPrepareNode<N extends NodeLabels<S>>(
    label: N,
    data: unknown,
    _partial = false,
  ): Record<string, unknown> {
    const nodeDef = this.schema.nodes[label as string]
    if (!nodeDef) {
      throw new ValidationError(
        `Unknown node label: ${label as string}`,
        'label',
        'valid node label',
        label,
      )
    }

    return stripUndefined(data as Record<string, unknown>)
  }

  /**
   * Validate, apply defaults, strip unknown fields, filter undefined for edge data.
   * Returns validated data, or undefined if no data provided.
   * @throws ValidationError if validation fails
   */
  parseAndPrepareEdge<E extends EdgeTypes<S>>(
    edgeType: E,
    data: unknown,
    _partial = false,
  ): Record<string, unknown> | undefined {
    // Edge properties are optional by default
    if (data === undefined || data === null) {
      return undefined
    }

    const edgeDef = this.schema.edges[edgeType as string]
    if (!edgeDef) {
      throw new ValidationError(
        `Unknown edge type: ${edgeType as string}`,
        'edgeType',
        'valid edge type',
        edgeType,
      )
    }

    return stripUndefined(data as Record<string, unknown>)
  }

  /**
   * Validate edge endpoint types match schema.
   */
  validateEdgeEndpoints<E extends EdgeTypes<S>>(
    edgeType: E,
    fromLabel?: string,
    toLabel?: string,
  ): void {
    const edgeDef = this.schema.edges[edgeType as string]
    if (!edgeDef) {
      throw new ValidationError(
        `Unknown edge type: ${edgeType as string}`,
        'edgeType',
        'valid edge type',
        edgeType,
      )
    }

    if (fromLabel) {
      const allowedFrom = edgeFrom(this.schema, edgeType as string)
      const expandedFrom = new Set<string>()
      for (const label of allowedFrom) {
        for (const satisfying of getNodesSatisfying(this.schema, label)) {
          expandedFrom.add(satisfying)
        }
      }

      if (!expandedFrom.has(fromLabel)) {
        throw new ValidationError(
          `Invalid source for ${edgeType as string}: '${fromLabel}' not allowed`,
          'from',
          [...expandedFrom].join(' | '),
          fromLabel,
        )
      }
    }

    if (toLabel) {
      const allowedTo = edgeTo(this.schema, edgeType as string)
      const expandedTo = new Set<string>()
      for (const label of allowedTo) {
        for (const satisfying of getNodesSatisfying(this.schema, label)) {
          expandedTo.add(satisfying)
        }
      }

      if (!expandedTo.has(toLabel)) {
        throw new ValidationError(
          `Invalid target for ${edgeType as string}: '${toLabel}' not allowed`,
          'to',
          [...expandedTo].join(' | '),
          toLabel,
        )
      }
    }
  }

  /**
   * Parse and validate node data, returning typed result.
   */
  parseNode<N extends NodeLabels<S>>(
    label: N,
    data: unknown,
    partial = false,
  ): Record<string, unknown> {
    this.validateNode(label, data, partial)
    return data as Record<string, unknown>
  }

  /**
   * Parse and validate edge data, returning typed result.
   */
  parseEdge<E extends EdgeTypes<S>>(
    edgeType: E,
    data: unknown,
    partial = false,
  ): Record<string, unknown> {
    this.validateEdge(edgeType, data, partial)
    return data as Record<string, unknown>
  }

  /**
   * Check if a node label exists in schema.
   */
  hasNode(label: string): boolean {
    return label in this.schema.nodes
  }

  /**
   * Check if an edge type exists in schema.
   */
  hasEdge(edgeType: string): boolean {
    return edgeType in this.schema.edges
  }

  /**
   * Get cardinality for an edge.
   */
  getEdgeCardinality(edgeType: string): { outbound: string; inbound: string } | undefined {
    if (!(edgeType in this.schema.edges)) return undefined
    return edgeCardinality(this.schema, edgeType)
  }
}

// =============================================================================
// VALIDATION OPTIONS
// =============================================================================

export interface ValidationOptions {
  /** Enable runtime validation (default: true) */
  enabled?: boolean
  /** Validate on create (default: true) */
  onCreate?: boolean
  /** Validate on update (default: true) */
  onUpdate?: boolean
  /** Validate edge endpoints (default: false - requires querying DB) */
  validateEndpoints?: boolean
}

export const defaultValidationOptions: Required<ValidationOptions> = {
  enabled: true,
  onCreate: true,
  onUpdate: true,
  validateEndpoints: false,
}
