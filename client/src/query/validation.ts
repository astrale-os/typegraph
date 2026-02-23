/**
 * Query Validation
 *
 * Validates queries against the schema at build time.
 * Catches invalid node labels, edge types, and property names before execution.
 */

import type { SchemaShape } from '../schema'
import type { NodeLabels, EdgeTypes } from '../inference'
import { getNodesSatisfying, edgeFrom, edgeTo } from '../helpers'

// =============================================================================
// VALIDATION ERRORS
// =============================================================================

export class QueryValidationError extends Error {
  constructor(
    message: string,
    public readonly code: QueryValidationErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'QueryValidationError'
  }
}

export type QueryValidationErrorCode =
  | 'INVALID_NODE_LABEL'
  | 'INVALID_EDGE_TYPE'
  | 'INVALID_PROPERTY'
  | 'INVALID_TRAVERSAL'
  | 'INVALID_HIERARCHY_EDGE'

// =============================================================================
// SCHEMA VALIDATOR
// =============================================================================

/**
 * Validates queries against a schema definition.
 */
export class SchemaValidator<S extends SchemaShape> {
  constructor(private readonly schema: S) {}

  /**
   * Validate that a node label exists in the schema.
   */
  validateNodeLabel(label: string): void {
    if (!(label in this.schema.nodes)) {
      const validLabels = Object.keys(this.schema.nodes)
      throw new QueryValidationError(
        `Invalid node label: "${label}". Valid labels are: ${validLabels.join(', ')}`,
        'INVALID_NODE_LABEL',
        { label, validLabels },
      )
    }
  }

  /**
   * Validate that an edge type exists in the schema.
   */
  validateEdgeType(edgeType: string): void {
    if (!(edgeType in this.schema.edges)) {
      const validEdges = Object.keys(this.schema.edges)
      throw new QueryValidationError(
        `Invalid edge type: "${edgeType}". Valid edge types are: ${validEdges.join(', ')}`,
        'INVALID_EDGE_TYPE',
        { edgeType, validEdges },
      )
    }
  }

  /**
   * Validate that a property exists on a node type.
   */
  validateNodeProperty<N extends NodeLabels<S>>(label: N, property: string): void {
    this.validateNodeLabel(label as string)

    const nodeDef = this.schema.nodes[label as string]
    if (!nodeDef) return

    const attrs = nodeDef.attributes
    if (attrs && !attrs.includes(property) && property !== 'id') {
      throw new QueryValidationError(
        `Invalid property "${property}" on node "${label as string}". Valid properties are: id, ${attrs.join(', ')}`,
        'INVALID_PROPERTY',
        { label, property, validProperties: ['id', ...attrs] },
      )
    }
  }

  /**
   * Validate that an edge property exists on an edge type.
   */
  validateEdgeProperty<E extends EdgeTypes<S>>(edgeType: E, property: string): void {
    this.validateEdgeType(edgeType as string)

    const edgeDef = this.schema.edges[edgeType as string]
    if (!edgeDef) return

    const attrs = edgeDef.attributes
    if (attrs && !attrs.includes(property) && property !== 'id') {
      throw new QueryValidationError(
        `Invalid property "${property}" on edge "${edgeType as string}". Valid properties are: id, ${attrs.join(', ')}`,
        'INVALID_PROPERTY',
        { edgeType, property, validProperties: ['id', ...attrs] },
      )
    }
  }

  /**
   * Validate a traversal from one node type to another via an edge.
   *
   * Supports:
   * - Polymorphic edges (from/to as arrays)
   * - Multi-label nodes via `labels` (IS-A relationships)
   */
  validateTraversal<N extends NodeLabels<S>, E extends EdgeTypes<S>>(
    fromLabel: N,
    edgeType: E,
    direction: 'out' | 'in' | 'both',
  ): void {
    this.validateNodeLabel(fromLabel as string)
    this.validateEdgeType(edgeType as string)

    const edgeDef = this.schema.edges[edgeType as string]
    if (!edgeDef) return

    // Use helpers to get endpoint types from the new schema shape
    const fromTypes = edgeFrom(this.schema, edgeType as string)
    const toTypes = edgeTo(this.schema, edgeType as string)

    // Build expanded sets including nodes that satisfy edge endpoints
    const expandedFrom = new Set<string>()
    for (const label of fromTypes) {
      for (const satisfying of getNodesSatisfying(this.schema, label)) {
        expandedFrom.add(satisfying)
      }
    }

    const expandedTo = new Set<string>()
    for (const label of toTypes) {
      for (const satisfying of getNodesSatisfying(this.schema, label)) {
        expandedTo.add(satisfying)
      }
    }

    const isValidOutbound = direction !== 'in' && expandedFrom.has(fromLabel as string)
    const isValidInbound = direction !== 'out' && expandedTo.has(fromLabel as string)

    if (!isValidOutbound && !isValidInbound) {
      throw new QueryValidationError(
        `Invalid traversal: cannot traverse "${edgeType as string}" ${direction === 'out' ? 'outbound' : direction === 'in' ? 'inbound' : 'in any direction'} from "${fromLabel as string}". ` +
          `Edge "${edgeType as string}" connects ${fromTypes.join('|')} -> ${toTypes.join('|')}`,
        'INVALID_TRAVERSAL',
        {
          fromLabel,
          edgeType,
          direction,
          edgeFrom: fromTypes,
          edgeTo: toTypes,
        },
      )
    }
  }

  /**
   * Validate hierarchy edge configuration.
   */
  validateHierarchyEdge(edgeType?: string): void {
    const hierarchyEdge = edgeType ?? this.schema.hierarchy?.defaultEdge

    if (!hierarchyEdge) {
      throw new QueryValidationError(
        'No hierarchy edge specified and schema has no default hierarchy configuration',
        'INVALID_HIERARCHY_EDGE',
        {},
      )
    }

    this.validateEdgeType(hierarchyEdge)
  }

  /**
   * Get all valid node labels.
   */
  getValidNodeLabels(): string[] {
    return Object.keys(this.schema.nodes)
  }

  /**
   * Get all valid edge types.
   */
  getValidEdgeTypes(): string[] {
    return Object.keys(this.schema.edges)
  }

  /**
   * Get valid properties for a node type.
   */
  getNodeProperties<N extends NodeLabels<S>>(label: N): string[] {
    const nodeDef = this.schema.nodes[label as string]
    if (!nodeDef?.attributes) return ['id']
    return ['id', ...nodeDef.attributes]
  }

  /**
   * Get valid properties for an edge type.
   */
  getEdgeProperties<E extends EdgeTypes<S>>(edgeType: E): string[] {
    const edgeDef = this.schema.edges[edgeType as string]
    if (!edgeDef?.attributes) return ['id']
    return ['id', ...edgeDef.attributes]
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a schema validator.
 */
export function createValidator<S extends SchemaShape>(schema: S): SchemaValidator<S> {
  return new SchemaValidator(schema)
}
