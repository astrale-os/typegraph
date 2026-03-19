/**
 * Input Validation for Authorization
 *
 * Validates expression trees, Cypher identifiers, scopes, and access check inputs.
 * Pure functions, no I/O.
 */

import type {
  IdentityExpr,
  Grant,
  NodeId,
  Permission,
  IdentityId,
  Scope,
  PermissionMask,
} from '../types'

const ALL_PERMS = 0x7fffffff

// =============================================================================
// PERMISSION VALIDATION
// =============================================================================

/** Validate a value is a valid single Permission (power of 2, within range). */
export function validatePermission(perm: unknown): asserts perm is Permission {
  if (typeof perm !== 'number' || !Number.isInteger(perm) || perm <= 0 || perm > ALL_PERMS) {
    throw new Error(`Invalid permission: must be a positive integer within range (got ${perm})`)
  }
  if ((perm & (perm - 1)) !== 0) {
    throw new Error(`Invalid permission: must be a power of 2 (got ${perm})`)
  }
}

/** Validate a value is a valid PermissionMask (non-negative integer within range). */
export function validatePermissionMask(mask: unknown): asserts mask is PermissionMask {
  if (typeof mask !== 'number' || !Number.isInteger(mask) || mask < 0 || mask > ALL_PERMS) {
    throw new Error(
      `Invalid permission mask: must be a non-negative integer within range (got ${mask})`,
    )
  }
}

// =============================================================================
// INPUT VALIDATION (Security: Cypher Injection Prevention)
// =============================================================================

/**
 * Regex for safe Cypher identifiers.
 * Allows: alphanumeric, underscore, hyphen, colon (for namespaced IDs)
 * Max length: 256 chars to prevent DoS
 */
const SAFE_ID_REGEX = /^[a-zA-Z0-9_:-]{1,256}$/

/**
 * Validate a string is safe for Cypher interpolation.
 * Throws if validation fails.
 */
export function validateCypherId(value: string, fieldName: string): void {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a string`)
  }
  if (value.length > 256 || !SAFE_ID_REGEX.test(value)) {
    const preview = value.length > 50 ? value.slice(0, 50) + '...' : value
    throw new Error(
      `Invalid ${fieldName}: "${preview}" must contain only alphanumeric characters, underscores, hyphens, and colons (max 256 chars)`,
    )
  }
}

/**
 * Exhaustive check helper - throws if an unknown expression kind is encountered.
 */
export function throwExhaustiveCheck(expr: never): never {
  throw new Error(`Unknown expression kind: ${(expr as { kind: string }).kind}`)
}

/**
 * Validate all IDs in a scope array.
 */
export function validateScopes(scopes: Scope[] | undefined): void {
  if (!scopes) return
  for (const scope of scopes) {
    if (scope.nodes) {
      for (const nodeId of scope.nodes) {
        validateCypherId(nodeId, 'scope node ID')
      }
    }
    if (scope.principals) {
      for (const principalId of scope.principals) {
        validateCypherId(principalId, 'scope principal ID')
      }
    }
    if (scope.perms !== undefined) {
      validatePermissionMask(scope.perms)
    }
  }
}

export const MAX_EXPRESSION_DEPTH = 100

export function validateExpression(expr: IdentityExpr, depth: number = 0): void {
  if (depth > MAX_EXPRESSION_DEPTH) {
    throw new Error(`Expression tree exceeds maximum depth of ${MAX_EXPRESSION_DEPTH}`)
  }

  switch (expr.kind) {
    case 'identity':
      validateCypherId(expr.id, 'identity ID')
      break
    case 'scope':
      if (!expr.scopes || expr.scopes.length === 0) {
        throw new Error('Scope node must have at least one scope')
      }
      validateScopes(expr.scopes)
      validateExpression(expr.expr, depth + 1)
      break
    case 'union':
    case 'intersect':
      if (!expr.operands || expr.operands.length < 2) {
        throw new Error(`${expr.kind} must have at least 2 operands`)
      }
      for (const operand of expr.operands) {
        validateExpression(operand, depth + 1)
      }
      break
    case 'exclude':
      validateExpression(expr.base, depth + 1)
      if (!expr.excluded || expr.excluded.length < 1) {
        throw new Error('exclude must have at least 1 excluded operand')
      }
      for (const excluded of expr.excluded) {
        validateExpression(excluded, depth + 1)
      }
      break
    default:
      throwExhaustiveCheck(expr)
  }
}

/**
 * Validate all inputs for an access check.
 */
export function validateAccessInputs(
  grant: Grant,
  resourceId: NodeId,
  perm: Permission,
  principal: IdentityId,
): void {
  validateCypherId(resourceId, 'resourceId')
  validatePermission(perm)
  validateCypherId(principal, 'principal')
  validateExpression(grant.forType)
  validateExpression(grant.forResource)
}
