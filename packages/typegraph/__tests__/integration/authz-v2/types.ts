/**
 * AUTH_V2 Types
 *
 * Core types for the capability-based access control system.
 * Two APIs: checkAccess (hot path) and explainAccess (cold path).
 *
 * Expression evaluation is two-phase:
 * 1. Prune: IdentityExpr → PrunedIdentityExpr | null (scope eval + algebraic simplification)
 * 2. Adapt: PrunedIdentityExpr → CypherFragment (query generation)
 */

// =============================================================================
// PRIMITIVE TYPES
// =============================================================================

export type NodeId = string
export type IdentityId = string
export type Permission = string

// =============================================================================
// SCOPE TYPES
// =============================================================================

/**
 * Scope restricts an identity's effective permissions.
 * - nodes: restrict to these subtrees (undefined = anywhere)
 * - perms: restrict to these permission types (undefined = any)
 * - principals: restrict which principals can invoke this identity (undefined = any)
 *
 * All three dimensions must pass for the scope to allow access.
 * Multiple scopes (in a scope node's scopes[]) are OR'd together.
 */
export type Scope = {
  nodes?: NodeId[]
  perms?: Permission[]
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
 * Scopes are expressed via 'scope' expression nodes wrapping subtrees.
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
 * Structure mirrors resolved IdentityExpr but with jwt/id distinction on leaves.
 * Kernel resolves these by verifying JWTs and extracting identity IDs.
 */
export type UnresolvedIdentityExpr =
  | { kind: 'identity'; jwt: string }
  | { kind: 'identity'; id: IdentityId }
  | { kind: 'scope'; scopes: Scope[]; expr: UnresolvedIdentityExpr }
  | { kind: 'union'; operands: UnresolvedIdentityExpr[] }
  | { kind: 'intersect'; operands: UnresolvedIdentityExpr[] }
  | { kind: 'exclude'; base: UnresolvedIdentityExpr; excluded: UnresolvedIdentityExpr[] }

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
 * - scopes: Optional top-level scopes applied by wrapping the expression in a scope node
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
 *
 * - identity: leaf node representing a single identity
 * - scope: wraps an expression with scope restrictions (scopes are OR'd)
 * - union: OR of N expressions (A ∪ B ∪ C)
 * - intersect: AND of N expressions (A ∩ B ∩ C)
 * - exclude: set difference — base minus all excluded (base \ (e1 ∪ e2 ∪ ...))
 *
 * Scope nodes enable principal/perm filtering during pruning.
 * Pruning evaluates scope nodes and propagates node restrictions
 * to identity leaves, producing a PrunedIdentityExpr.
 */
export type IdentityExpr =
  | { kind: 'identity'; id: IdentityId }
  | { kind: 'scope'; scopes: Scope[]; expr: IdentityExpr }
  | { kind: 'union'; operands: IdentityExpr[] }
  | { kind: 'intersect'; operands: IdentityExpr[] }
  | { kind: 'exclude'; base: IdentityExpr; excluded: IdentityExpr[] }

// =============================================================================
// PRUNED IDENTITY EXPRESSION (AFTER SCOPE EVALUATION)
// =============================================================================

/**
 * Expression tree after scope evaluation (pruning phase output).
 *
 * No 'scope' kind — all scopes have been evaluated:
 * - principal/perm restrictions pruned dead branches (null → algebraic simplification)
 * - node restrictions propagated to identity leaves as nodeRestriction
 *
 * Each identity leaf carries its own nodeRestriction (intersection of
 * ancestor scope nodes). undefined = unrestricted, NodeId[] = must be
 * descendant of at least one of these nodes.
 *
 * Algebraic simplifications applied during pruning:
 * - A ∪ ∅ = A (filter null from union operands)
 * - A ∩ ∅ = ∅ (any null in intersect → whole thing null)
 * - ∅ \ A = ∅ (null base → null)
 * - A \ ∅ = A (null excluded → drop it)
 */
export type PrunedIdentityExpr =
  | { kind: 'identity'; id: IdentityId; nodeRestriction?: NodeId[] }
  | { kind: 'union'; operands: PrunedIdentityExpr[] }
  | { kind: 'intersect'; operands: PrunedIdentityExpr[] }
  | { kind: 'exclude'; base: PrunedIdentityExpr; excluded: PrunedIdentityExpr[] }

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
  perm: Permission
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
 * Path encoding: position in tree using operand indices.
 * - [] = root (single identity)
 * - [0] = first operand (or base for exclude)
 * - [1] = second operand (or first excluded for exclude)
 * - [0, 2] = first operand's third operand
 *
 * For scope nodes, the path passes through transparently (scope
 * wraps a single expression, so no index is added).
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
  // undefined means no node restrictions (permission valid anywhere)
  // Non-empty means resource must be descendant of at least one of these nodes
  nodeRestriction?: NodeId[]
}

/**
 * Detail about why a scope filtered an identity.
 * Note: 'principal' and 'perm' are checked during pruning.
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
