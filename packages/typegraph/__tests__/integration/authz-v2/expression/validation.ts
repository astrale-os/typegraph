/**
 * Input Validation for Authorization
 *
 * Validates expression trees, Cypher identifiers, scopes, and access check inputs.
 * Pure functions, no I/O.
 */

import type { IdentityExpr, Grant, NodeId, PermissionT, IdentityId, Scope } from '../types'

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
    if (scope.perms) {
      for (const perm of scope.perms) {
        validateCypherId(perm, 'scope permission')
      }
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
      validateScopes(expr.scopes)
      break
    case 'union':
    case 'intersect':
    case 'exclude':
      validateExpression(expr.left, depth + 1)
      validateExpression(expr.right, depth + 1)
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
  perm: PermissionT,
  principal: IdentityId,
): void {
  validateCypherId(resourceId, 'resourceId')
  validateCypherId(perm, 'perm')
  validateCypherId(principal, 'principal')
  validateExpression(grant.forType)
  validateExpression(grant.forResource)
}
