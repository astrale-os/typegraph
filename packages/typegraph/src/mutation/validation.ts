/**
 * Mutation Validation
 *
 * Runtime validation using schema's Zod definitions.
 * Validates node/edge data and schema constraints.
 */

import { type z } from "zod"
import type { AnySchema, NodeLabels, EdgeTypes } from "../schema"
import { ValidationError } from "./errors"

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
export class MutationValidator<S extends AnySchema> {
  constructor(private readonly schema: S) {}

  /**
   * Validate node data against schema.
   * @throws ValidationError if validation fails
   */
  validateNode<N extends NodeLabels<S>>(label: N, data: unknown, partial = false): void {
    const nodeDef = this.schema.nodes[label as string]
    if (!nodeDef) {
      throw new ValidationError(`Unknown node label: ${label as string}`, "label", "valid node label", label)
    }

    const zodSchema = partial ? nodeDef.properties.partial() : nodeDef.properties

    const result = zodSchema.safeParse(data)
    if (!result.success) {
      const firstError = result.error.errors[0]
      throw new ValidationError(
        `Invalid ${label as string} data: ${firstError?.message ?? "validation failed"}`,
        firstError?.path.join("."),
        undefined,
        firstError?.received,
      )
    }
  }

  /**
   * Validate edge data against schema.
   * @throws ValidationError if validation fails
   */
  validateEdge<E extends EdgeTypes<S>>(edgeType: E, data: unknown, partial = false): void {
    const edgeDef = this.schema.edges[edgeType as string]
    if (!edgeDef) {
      throw new ValidationError(`Unknown edge type: ${edgeType as string}`, "edgeType", "valid edge type", edgeType)
    }

    // Edge properties are optional by default
    if (data === undefined || data === null) {
      return
    }

    const zodSchema = partial ? edgeDef.properties.partial() : edgeDef.properties

    const result = zodSchema.safeParse(data)
    if (!result.success) {
      const firstError = result.error.errors[0]
      throw new ValidationError(
        `Invalid ${edgeType as string} data: ${firstError?.message ?? "validation failed"}`,
        firstError?.path.join("."),
        undefined,
        firstError?.received,
      )
    }
  }

  /**
   * Validate edge endpoint types match schema.
   */
  validateEdgeEndpoints<E extends EdgeTypes<S>>(edgeType: E, fromLabel?: string, toLabel?: string): void {
    const edgeDef = this.schema.edges[edgeType as string]
    if (!edgeDef) {
      throw new ValidationError(`Unknown edge type: ${edgeType as string}`, "edgeType", "valid edge type", edgeType)
    }

    if (fromLabel) {
      const allowedFrom = Array.isArray(edgeDef.from) ? edgeDef.from : [edgeDef.from]
      if (!allowedFrom.includes(fromLabel)) {
        throw new ValidationError(
          `Invalid source for ${edgeType as string}: '${fromLabel}' not allowed`,
          "from",
          allowedFrom.join(" | "),
          fromLabel,
        )
      }
    }

    if (toLabel) {
      const allowedTo = Array.isArray(edgeDef.to) ? edgeDef.to : [edgeDef.to]
      if (!allowedTo.includes(toLabel)) {
        throw new ValidationError(
          `Invalid target for ${edgeType as string}: '${toLabel}' not allowed`,
          "to",
          allowedTo.join(" | "),
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
  ): z.infer<(typeof this.schema.nodes)[N]["properties"]> {
    this.validateNode(label, data, partial)
    return data as z.infer<(typeof this.schema.nodes)[N]["properties"]>
  }

  /**
   * Parse and validate edge data, returning typed result.
   */
  parseEdge<E extends EdgeTypes<S>>(
    edgeType: E,
    data: unknown,
    partial = false,
  ): z.infer<(typeof this.schema.edges)[E]["properties"]> {
    this.validateEdge(edgeType, data, partial)
    return data as z.infer<(typeof this.schema.edges)[E]["properties"]>
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
    const edgeDef = this.schema.edges[edgeType]
    return edgeDef?.cardinality
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
