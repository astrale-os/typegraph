/**
 * AUTH_V2 Types
 *
 * Core types for the capability-based access control system.
 * Two APIs: checkAccess (hot path) and explainAccess (cold path).
 */

// =============================================================================
// PRIMITIVE TYPES
// =============================================================================

export type NodeId = string
export type IdentityId = string
export type PermissionT = string

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
  nodes?: NodeId[]
  perms?: PermissionT[]
  principals?: IdentityId[]
}

// =============================================================================
// SUBJECT TYPE
// =============================================================================

/**
 * Subject for access check.
 * Contains identity expressions for type and target checks.
 *
 * Scopes are on IdentityExpr leaves, not here.
 * Principal is passed separately to checkAccess/explainAccess.
 */
export type Subject = {
  forType: IdentityExpr
  forTarget: IdentityExpr
}

// =============================================================================
// IDENTITY EXPRESSION TYPES
// =============================================================================

/**
 * Expression tree for identity composition.
 * - identity: leaf node representing a single identity with optional scope restrictions
 * - union: OR of two expressions (A ∪ B)
 * - intersect: AND of two expressions (A ∩ B)
 * - exclude: set difference (A \ B)
 *
 * Scopes on leaf nodes enable principal filtering: when generating Cypher,
 * leaves that don't allow the current principal are treated as empty sets.
 * Empty sets propagate through composition: A ∪ ∅ = A, A ∩ ∅ = ∅, A \ ∅ = A.
 */
export type IdentityExpr =
  | { kind: 'identity'; id: IdentityId; scopes?: Scope[] }
  | { kind: 'union'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'intersect'; left: IdentityExpr; right: IdentityExpr }
  | { kind: 'exclude'; left: IdentityExpr; right: IdentityExpr }

/**
 * Raw identity composition data from the database.
 */
export type IdentityComposition = {
  id: IdentityId
  unions: IdentityId[]
  intersects: IdentityId[]
  excludes: IdentityId[]
  hasDirectPerms: boolean
}

// =============================================================================
// ACCESS DECISION (HOT PATH)
// =============================================================================

/**
 * Hot path result: simple grant/deny decision.
 * Use checkAccess() for this.
 */
export type AccessDecision = {
  granted: boolean
  deniedBy?: 'type' | 'target'
}

// =============================================================================
// ACCESS EXPLANATION (COLD PATH)
// =============================================================================

/**
 * Cold path result: detailed explanation for debugging.
 * Use explainAccess() for this.
 */
export type AccessExplanation = {
  // Echo inputs (self-contained)
  targetId: NodeId
  perm: PermissionT
  principal: IdentityId

  // Result
  granted: boolean
  deniedBy?: 'type' | 'target'

  // Phase explanations
  typeCheck: PhaseExplanation
  targetCheck: PhaseExplanation
}

/**
 * Explanation for a single phase (type check or target check).
 */
export type PhaseExplanation = {
  expression: IdentityExpr
  leaves: LeafEvaluation[]
  cypher: string
}

/**
 * Evaluation of a single leaf identity in the expression tree.
 *
 * Path encoding: position in tree
 * - [] = root (single identity)
 * - [0] = left branch
 * - [1] = right branch
 * - [0, 1] = left.right
 * - With multiple identities: [identityIndex, ...treePath]
 */
export type LeafEvaluation = {
  path: number[]
  identityId: IdentityId
  status: 'granted' | 'filtered' | 'missing'

  // Granted: where permission was found and how
  grantedAt?: NodeId
  inheritancePath?: NodeId[] // target → ... → grantedAt

  // Filtered: why and where
  filterDetail?: FilterDetail[]

  // Missing: what was searched
  searchedPath?: NodeId[] // target → ... → root (searched but not found)

  // Node scope restrictions that must be satisfied (if any)
  // Empty array means no node restrictions (permission valid anywhere)
  // Non-empty means target must be descendant of at least one of these nodes
  nodeRestrictions?: NodeId[]
}

/**
 * Detail about why a scope filtered an identity.
 * Note: 'principal' and 'perm' are checked during leaf collection.
 * Node scope restrictions are enforced in Cypher, not in filter.
 */
export type FilterDetail = {
  scopeIndex: number
  failedCheck: 'principal' | 'perm'
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
 * Access checker configuration.
 */
export interface AccessCheckerConfig {
  maxDepth?: number
}
