/**
 * AUTH_V2 Types
 *
 * Core types for the capability-based access control system.
 */

// =============================================================================
// SCOPE TYPES
// =============================================================================

/**
 * Scope restricts an identity's effective permissions.
 * - nodes: restrict to these subtrees (empty/undefined = anywhere)
 * - perms: restrict to these permission types (empty/undefined = any)
 * - principals: restrict which principals can invoke this identity (empty/undefined = any)
 *
 * All three dimensions must pass for the scope to allow access.
 * Multiple scopes are OR'd together (identity satisfies ANY scope).
 */
export type Scope = {
  nodes?: string[]
  perms?: string[]
  principals?: string[]
}

/**
 * Identity input with optional scope restrictions.
 * Multiple scopes are OR'd together.
 */
export type IdentityInput = {
  identityId: string
  scopes?: Scope[]
}

// =============================================================================
// IDENTITY EXPRESSION TYPES
// =============================================================================

/**
 * Expression tree for identity composition.
 * - identity: leaf node representing a single identity with optional scope restrictions
 * - union: OR of two expressions (∪)
 * - intersect: AND of two expressions (∩)
 * - exclude: set difference of two expressions (\)
 *
 * Scopes on leaf nodes enable principal filtering: when generating Cypher,
 * leaves that don't allow the current principal are treated as empty sets (∅).
 * Empty sets propagate through composition: A ∪ ∅ = A, A ∩ ∅ = ∅, A \ ∅ = A.
 */
export type IdentityExpr =
  | { kind: 'identity'; id: string; scopes?: Scope[] }
  | { kind: 'union'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'intersect'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'exclude'; left: IdentityExpr; right: IdentityExpr }

/**
 * Raw identity composition data from the database.
 */
export type IdentityComposition = {
  id: string
  unions: string[]
  intersects: string[]
  excludes: string[]
  hasDirectPerms: boolean
}

// =============================================================================
// ACCESS RESULT TYPES
// =============================================================================

/**
 * Result of an access check.
 * - granted: true if access is allowed
 * - reason: 'type' if denied by type check, 'target' if denied by target check
 */
export type AccessResult = {
  granted: boolean
  reason?: 'type' | 'target'
}

// =============================================================================
// RAW EXECUTOR TYPE
// =============================================================================

/**
 * Raw query executor interface.
 */
export interface RawExecutor {
  run<T>(query: string, params?: Record<string, unknown>): Promise<T[]>
}

// =============================================================================
// TEST DATA TYPES
// =============================================================================

/**
 * Test fixture data structure.
 */
export interface AuthzTestData {
  identities: {
    app1: string
    user1: string
    role1: string
    x: string
    a: string
    b: string
  }
  types: { t1: string; t2: string }
  modules: { m1: string; m2: string; m3: string }
  spaces: { ws1: string; ws2: string }
  root: string
}

// =============================================================================
// CONFIGURATION TYPES
// =============================================================================

/**
 * Cypher generator configuration.
 */
export interface CypherGeneratorConfig {
  maxDepth: number
  useExistsSyntax: boolean
}

/**
 * Access checker configuration.
 */
export interface AccessCheckerConfig {
  maxDepth?: number
}
