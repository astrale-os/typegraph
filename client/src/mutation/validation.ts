/**
 * Mutation Validation
 *
 * Validates node/edge data against codegen Zod schemas when available,
 * falls back to structural checks otherwise.
 */

import type { SchemaShape } from '../schema'
import type { NodeLabels, EdgeTypes } from '../inference'
import { getNodesSatisfying, edgeFrom, edgeTo, edgeCardinality } from '../helpers'
import { ValidationError } from './errors'
import type { MutationOp } from './ast/types'

// =============================================================================
// VALIDATOR MAP TYPE
// =============================================================================

/**
 * Map of type names to Zod schemas.
 * The codegen `validators` object satisfies this type.
 *
 * Keys: node labels (e.g. 'Customer'), PascalCase edge names (e.g. 'OrderItem'),
 *       type aliases (e.g. 'Email', 'Currency').
 */
export type ValidatorMap = Record<string, ZodLike>

/**
 * Minimal Zod schema interface — avoids a hard dependency on the `zod` package.
 * Any object with `.parse()` and `.safeParse()` satisfies this.
 * `.partial()` is only available on object schemas (used for update validation).
 */
export interface ZodLike {
  parse(data: unknown): unknown
  safeParse(data: unknown): { success: boolean; data?: unknown; error?: ZodErrorLike }
  partial?(): ZodLike
}

interface ZodErrorLike {
  issues: Array<{ path: PropertyKey[]; message: string; code: string }>
}

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
 * Validates mutation inputs against codegen Zod schemas when available.
 */
export class MutationValidator<S extends SchemaShape> {
  private readonly validators: ValidatorMap | undefined

  constructor(
    private readonly schema: S,
    validators?: ValidatorMap,
  ) {
    this.validators = validators
  }

  /**
   * Validate node data against schema.
   * @throws ValidationError if validation fails
   */
  validateNode<N extends NodeLabels<S>>(label: N, data: unknown, partial = false): void {
    const nodeDef = this.schema.nodes[label as string]
    if (!nodeDef) {
      throw new ValidationError(
        `Unknown node label: ${label as string}`,
        'label',
        'valid node label',
        label,
      )
    }

    if (this.validators) {
      this.runZodValidation(label as string, data, partial)
    }
  }

  /**
   * Validate edge data against schema.
   * @throws ValidationError if validation fails
   */
  validateEdge<E extends EdgeTypes<S>>(edgeType: E, data: unknown, partial = false): void {
    const edgeDef = this.schema.edges[edgeType as string]
    if (!edgeDef) {
      throw new ValidationError(
        `Unknown edge type: ${edgeType as string}`,
        'edgeType',
        'valid edge type',
        edgeType,
      )
    }

    if (data === undefined || data === null) return

    if (this.validators) {
      const key = pascalCase(edgeType as string)
      this.runZodValidation(key, data, partial)
    }
  }

  /**
   * Validate, apply defaults, strip unknown fields, filter undefined, serialize dates.
   * Returns data ready for database.
   * @throws ValidationError if validation fails
   */
  parseAndPrepareNode<N extends NodeLabels<S>>(
    label: N,
    data: unknown,
    partial = false,
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

    const parsed = this.parseWithZod(label as string, data, partial)
    return serializeDates(stripUndefined(parsed))
  }

  /**
   * Validate, apply defaults, strip unknown fields, filter undefined for edge data.
   * Returns validated data, or undefined if no data provided.
   * @throws ValidationError if validation fails
   */
  parseAndPrepareEdge<E extends EdgeTypes<S>>(
    edgeType: E,
    data: unknown,
    partial = false,
  ): Record<string, unknown> | undefined {
    if (data === undefined || data === null) return undefined

    const edgeDef = this.schema.edges[edgeType as string]
    if (!edgeDef) {
      throw new ValidationError(
        `Unknown edge type: ${edgeType as string}`,
        'edgeType',
        'valid edge type',
        edgeType,
      )
    }

    const key = pascalCase(edgeType as string)
    const parsed = this.parseWithZod(key, data, partial)
    return serializeDates(stripUndefined(parsed))
  }

  /**
   * Validate an array of MutationOps, returning new ops with validated/defaulted data.
   * @throws ValidationError on first invalid op
   */
  validateAndPrepareOps(ops: MutationOp[]): MutationOp[] {
    return ops.map((op, index) => {
      try {
        return this.validateOp(op)
      } catch (err) {
        if (err instanceof ValidationError) {
          throw new ValidationError(
            `Validation failed on op[${index}] (${op.type}): ${err.message}`,
            err.field,
            err.expected,
            err.received,
          )
        }
        throw err
      }
    })
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

  parseNode<N extends NodeLabels<S>>(
    label: N,
    data: unknown,
    partial = false,
  ): Record<string, unknown> {
    this.validateNode(label, data, partial)
    return data as Record<string, unknown>
  }

  parseEdge<E extends EdgeTypes<S>>(
    edgeType: E,
    data: unknown,
    partial = false,
  ): Record<string, unknown> {
    this.validateEdge(edgeType, data, partial)
    return data as Record<string, unknown>
  }

  hasNode(label: string): boolean {
    return label in this.schema.nodes
  }

  hasEdge(edgeType: string): boolean {
    return edgeType in this.schema.edges
  }

  getEdgeCardinality(edgeType: string): { outbound: string; inbound: string } | undefined {
    if (!(edgeType in this.schema.edges)) return undefined
    return edgeCardinality(this.schema, edgeType)
  }

  // ---------------------------------------------------------------------------
  // SCHEMA EXTENSION
  // ---------------------------------------------------------------------------

  /**
   * Merge additional Zod validators into the validator map.
   * Called by graph.extendSchema() when distributions provide validators.
   */
  extendValidators(newValidators: ValidatorMap): void {
    if (this.validators) {
      Object.assign(this.validators, newValidators)
    } else {
      ;(this as unknown as { validators: ValidatorMap }).validators = { ...newValidators }
    }
  }

  // ---------------------------------------------------------------------------
  // PRIVATE
  // ---------------------------------------------------------------------------

  /**
   * Parse data through a Zod validator if available, otherwise strip undefined.
   */
  private parseWithZod(key: string, data: unknown, partial: boolean): Record<string, unknown> {
    if (!this.validators || !(key in this.validators)) {
      return stripUndefined(data as Record<string, unknown>)
    }

    let zodSchema = this.validators[key]!
    if (partial && zodSchema.partial) {
      zodSchema = zodSchema.partial()
    }

    const result = zodSchema.safeParse(data)
    if (!result.success) {
      throw zodErrorToValidation(key, result.error!)
    }

    return result.data as Record<string, unknown>
  }

  /**
   * Validate data through Zod without transforming it.
   */
  private runZodValidation(key: string, data: unknown, partial: boolean): void {
    if (!this.validators || !(key in this.validators)) return

    let zodSchema = this.validators[key]!
    if (partial && zodSchema.partial) {
      zodSchema = zodSchema.partial()
    }

    const result = zodSchema.safeParse(data)
    if (!result.success) {
      throw zodErrorToValidation(key, result.error!)
    }
  }

  /**
   * Validate a single MutationOp, returning a new op with validated data.
   */
  private validateOp(op: MutationOp): MutationOp {
    switch (op.type) {
      case 'createNode':
        return { ...op, data: this.parseAndPrepareNode(op.label as NodeLabels<S>, op.data) }
      case 'updateNode':
        return { ...op, data: this.parseAndPrepareNode(op.label as NodeLabels<S>, op.data, true) }
      case 'upsertNode':
        return { ...op, data: this.parseAndPrepareNode(op.label as NodeLabels<S>, op.data) }
      case 'cloneNode':
        if (Object.keys(op.overrides).length > 0) {
          return {
            ...op,
            overrides: this.parseAndPrepareNode(op.label as NodeLabels<S>, op.overrides, true),
          }
        }
        return op
      case 'createEdge':
        if (op.data) {
          return { ...op, data: this.parseAndPrepareEdge(op.edgeType as EdgeTypes<S>, op.data) }
        }
        return op
      case 'updateEdge':
        return {
          ...op,
          data: this.parseAndPrepareEdge(op.edgeType as EdgeTypes<S>, op.data, true) ?? {},
        }
      case 'updateEdgeById':
        return {
          ...op,
          data: this.parseAndPrepareEdge(op.edgeType as EdgeTypes<S>, op.data, true) ?? {},
        }
      case 'batchCreate':
        return {
          ...op,
          items: op.items.map((item, i) => {
            try {
              return {
                ...item,
                data: this.parseAndPrepareNode(op.label as NodeLabels<S>, item.data),
              }
            } catch (err) {
              if (err instanceof ValidationError) {
                throw new ValidationError(
                  `Item[${i}]: ${err.message}`,
                  err.field,
                  err.expected,
                  err.received,
                )
              }
              throw err
            }
          }),
        }
      case 'batchUpdate':
        return {
          ...op,
          updates: op.updates.map((item, i) => {
            try {
              return {
                ...item,
                data: this.parseAndPrepareNode(op.label as NodeLabels<S>, item.data, true),
              }
            } catch (err) {
              if (err instanceof ValidationError) {
                throw new ValidationError(
                  `Item[${i}]: ${err.message}`,
                  err.field,
                  err.expected,
                  err.received,
                )
              }
              throw err
            }
          }),
        }
      case 'batchLink':
        return {
          ...op,
          links: op.links.map((link, i) => {
            if (!link.data) return link
            try {
              return {
                ...link,
                data: this.parseAndPrepareEdge(op.edgeType as EdgeTypes<S>, link.data),
              }
            } catch (err) {
              if (err instanceof ValidationError) {
                throw new ValidationError(
                  `Link[${i}]: ${err.message}`,
                  err.field,
                  err.expected,
                  err.received,
                )
              }
              throw err
            }
          }),
        }
      default:
        return op
    }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

function zodErrorToValidation(typeName: string, error: ZodErrorLike): ValidationError {
  const first = error.issues[0]
  if (!first) {
    return new ValidationError(`Validation failed for ${typeName}`)
  }

  const path = first.path.map(String).join('.')
  const fieldDesc = path ? `${typeName}.${path}` : typeName

  return new ValidationError(
    `Validation failed for ${fieldDesc}: ${first.message}`,
    path || undefined,
    undefined,
    undefined,
  )
}

function pascalCase(s: string): string {
  return s
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
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
  /** Codegen Zod validators for runtime mutation validation */
  validators?: ValidatorMap
}

export const defaultValidationOptions: Required<Omit<ValidationOptions, 'validators'>> = {
  enabled: true,
  onCreate: true,
  onUpdate: true,
  validateEndpoints: false,
}
