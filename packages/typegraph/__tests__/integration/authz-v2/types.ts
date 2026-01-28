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
// GRANT TYPE
// =============================================================================

/**
 * Grant for access check.
 * Contains identity expressions for type and resource checks.
 *
 * - forType: identities that can USE this type of resource (e.g., app permissions)
 * - forResource: identities that have permission on the specific resource (e.g., user permissions)
 *
 * Scopes are on IdentityExpr leaves, not here.
 * Principal is passed separately to checkAccess/explainAccess.
 */
export type Grant = {
  forType: IdentityExpr
  forResource: IdentityExpr
}

// =============================================================================
// UNRESOLVED TYPES (CLIENT-SIDE / JWT PAYLOAD)
// =============================================================================

/**
 * Unresolved identity expression (before kernel resolution).
 *
 * Client-side expressions reference identities either by:
 * - JWT token (to be verified and resolved to plain ID)
 * - Plain ID (only valid for kernel-issued tokens)
 *
 * Structure matches resolved IdentityExpr but with jwt/id distinction.
 * Kernel resolves these by verifying JWTs and extracting identity IDs.
 */
export type UnresolvedIdentityExpr =
  | { kind: 'identity'; jwt: string; scopes?: Scope[] }
  | { kind: 'identity'; id: IdentityId; scopes?: Scope[] }
  | { kind: 'union'; left: UnresolvedIdentityExpr; right: UnresolvedIdentityExpr }
  | { kind: 'intersect'; left: UnresolvedIdentityExpr; right: UnresolvedIdentityExpr }
  | { kind: 'exclude'; left: UnresolvedIdentityExpr; right: UnresolvedIdentityExpr }

/**
 * Unresolved grant for JWT 'grant' claim.
 *
 * This is what apps encode into JWTs before sending to kernel.
 * Kernel resolves by verifying JWTs and applying defaults.
 *
 * Defaults:
 * - forType undefined → use principal
 * - forResource undefined → use principal
 *
 * Version field enables future format changes.
 */
export type UnresolvedGrant = {
  v: 1
  forType?: UnresolvedIdentityExpr
  forResource?: UnresolvedIdentityExpr
}

/**
 * RelayToken request payload.
 *
 * Expression-first API: always accepts an expression, not optional token.
 * This provides one code path for simple and complex cases.
 *
 * - expression: The identity expression to resolve (JWTs → plain IDs)
 * - scopes: Optional top-level scopes applied to ALL resolved leaves (intersected with per-leaf scopes)
 * - ttl: Token lifetime in seconds (optional, kernel default applies)
 */
export type RelayTokenRequest = {
  expression: UnresolvedIdentityExpr
  scopes?: Scope[]
  ttl?: number
}

/**
 * RelayToken response payload.
 */
export type RelayTokenResponse = {
  token: string
  expires_at: number
}

// =============================================================================
// IDENTITY EXPRESSION TYPES (RESOLVED)
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
  deniedBy?: 'type' | 'resource'
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
  resourceId: NodeId
  perm: PermissionT
  principal: IdentityId

  // Result
  granted: boolean
  deniedBy?: 'type' | 'resource'

  // Phase explanations
  typeCheck: PhaseExplanation
  resourceCheck: PhaseExplanation
}

/**
 * Explanation for a single phase (type check or resource check).
 */
export type PhaseExplanation = {
  expression: IdentityExpr
  leaves: LeafEvaluation[]
  query: string | null
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
  inheritancePath?: NodeId[] // resource → ... → grantedAt

  // Filtered: why and where
  filterDetail?: FilterDetail[]

  // Missing: what was searched
  searchedPath?: NodeId[] // resource → ... → root (searched but not found)

  // Node scope restrictions that must be satisfied (if any)
  // Empty array means no node restrictions (permission valid anywhere)
  // Non-empty means resource must be descendant of at least one of these nodes
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
// IDENTITY QUERY PORT
// =============================================================================

/**
 * Port interface for identity-based access control queries.
 * Adapter implementations provide concrete I/O behavior.
 */
export interface IdentityQueryPort {
  checkAccess(params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    perm: PermissionT
  }): Promise<AccessDecision>
  explainAccess(params: {
    principal: IdentityId
    grant: Grant
    nodeId: NodeId
    perm: PermissionT
  }): Promise<AccessExplanation>
}

// =============================================================================
// REASON TYPES (STRUCTURED EXPLANATION)
// =============================================================================

/**
 * Leaf reason: evaluation of a single identity.
 */
export type LeafReason = {
  kind: 'identity'
  id: string
  status: 'active' | 'filtered' | 'missing'
  filter?: { reason: 'principal' | 'perm' | 'scope' }
}

/**
 * Composite reason: evaluation of a composition node.
 */
export type CompositeReason = {
  kind: 'union' | 'intersect' | 'exclude'
  left: Reason
  right: Reason
  simplified?: 'left' | 'right' | 'both'
}

/**
 * Reason tree: mirrors the expression tree with evaluation results.
 */
export type Reason = LeafReason | CompositeReason

/**
 * Full access result with structured reason tree.
 */
export type AccessResult = {
  granted: boolean
  deniedBy?: 'type' | 'resource'
  reason: Reason
  query: string | null
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
