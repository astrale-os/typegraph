/**
 * Fluent SDK for Identity Expression Composition
 *
 * Provides a builder pattern for composing identity expressions with
 * union, intersect, and exclude operations. Supports method chaining
 * and factory functions for flexible expression building.
 *
 * @example
 * ```typescript
 * // Factory functions
 * const expr = union(
 *   identity("X", { nodes: ["node-A"] }),
 *   identity("Y")
 * )
 *
 * // Method chaining
 * const expr2 = identity("A")
 *   .union(identity("B"))
 *   .intersect(identity("C"))
 *   .exclude(identity("D"))
 *
 * // Build to raw IdentityExpr
 * const rawExpr = expr.build()
 * ```
 */

import type { IdentityExpr, Scope } from '../types'

// =============================================================================
// EXPR INTERFACE (for type checking builder vs raw expression)
// =============================================================================

/**
 * Interface for expression builders.
 * Used to distinguish builders from raw IdentityExpr in evalExpr.
 */
export interface ExprBuilder {
  build(): IdentityExpr
}

/**
 * Type guard to check if value is an ExprBuilder.
 */
export function isExprBuilder(value: unknown): value is ExprBuilder {
  return (
    typeof value === 'object' &&
    value !== null &&
    'build' in value &&
    typeof (value as ExprBuilder).build === 'function'
  )
}

// =============================================================================
// EXPR ABSTRACT BASE CLASS
// =============================================================================

/**
 * Base class for all expression builders.
 * Provides composition methods (union, intersect, exclude) available on all expressions.
 */
export abstract class Expr implements ExprBuilder {
  /**
   * Build the raw IdentityExpr from this builder.
   */
  abstract build(): IdentityExpr

  /**
   * Create a union of this expression with another.
   * A ∪ B: grants access if either A or B grants access.
   */
  union(other: Expr): Expr {
    return new BinaryExpr('union', this, other)
  }

  /**
   * Create an intersection of this expression with another.
   * A ∩ B: grants access only if both A and B grant access.
   */
  intersect(other: Expr): Expr {
    return new BinaryExpr('intersect', this, other)
  }

  /**
   * Exclude another expression from this one.
   * A \ B: grants access if A grants but B does not.
   */
  exclude(other: Expr): Expr {
    return new BinaryExpr('exclude', this, other)
  }
}

// =============================================================================
// IDENTITY LEAF BUILDER
// =============================================================================

/**
 * Builder for identity leaf expressions.
 * Represents a single identity with optional scope restrictions.
 */
export class IdentityExprBuilder extends Expr {
  constructor(
    private readonly id: string,
    private readonly scopes: Scope[] = [],
  ) {
    super()
  }

  /**
   * Add a scope to this identity.
   * Returns a new builder (immutable).
   *
   * @example
   * ```typescript
   * identity("USER1").scope({ nodes: ["workspace-1"] })
   * identity("ROLE1").scope({ perms: ["read"] })
   * ```
   */
  scope(s: Scope): IdentityExprBuilder {
    return new IdentityExprBuilder(this.id, [...this.scopes, s])
  }

  build(): IdentityExpr {
    return this.scopes.length > 0
      ? { kind: 'identity', id: this.id, scopes: this.scopes }
      : { kind: 'identity', id: this.id }
  }
}

// =============================================================================
// RAW EXPRESSION WRAPPER
// =============================================================================

/**
 * Wrapper for raw IdentityExpr values.
 * Allows mixing raw expressions (e.g., from evalIdentity) with builders.
 */
export class RawExpr extends Expr {
  constructor(private readonly expr: IdentityExpr) {
    super()
  }

  build(): IdentityExpr {
    return this.expr
  }
}

// =============================================================================
// BINARY EXPRESSION BUILDER
// =============================================================================

/**
 * Builder for binary expressions (union, intersect, exclude).
 */
export class BinaryExpr extends Expr {
  constructor(
    private readonly kind: 'union' | 'intersect' | 'exclude',
    private readonly left: Expr,
    private readonly right: Expr,
  ) {
    super()
  }

  build(): IdentityExpr {
    return {
      kind: this.kind,
      left: this.left.build(),
      right: this.right.build(),
    }
  }
}

// =============================================================================
// FACTORY FUNCTIONS
// =============================================================================

/**
 * Create an identity leaf expression.
 *
 * @param id - The identity ID
 * @param scopes - Optional scope restriction(s). Can be single scope or array.
 *
 * @example
 * ```typescript
 * identity("USER1")
 * identity("USER1", { nodes: ["ws1"] })
 * identity("USER1", [{ nodes: ["ws1"] }, { perms: ["read"] }])
 * ```
 */
export function identity(id: string, scopes?: Scope | Scope[]): IdentityExprBuilder {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('identity id must be a non-empty string')
  }
  const scopeArray = scopes ? (Array.isArray(scopes) ? scopes : [scopes]).filter(Boolean) : []
  return new IdentityExprBuilder(id, scopeArray)
}

/**
 * Alias for identity() - shorter form.
 */
export const id = identity

/**
 * Wrap a raw IdentityExpr in an Expr builder.
 * Useful for mixing resolved expressions with builders.
 *
 * @param expr - A raw IdentityExpr (e.g., from evalIdentity or evalExpr)
 *
 * @example
 * ```typescript
 * const resolved = await evaluator.evalIdentity("USER1")
 * const composed = raw(resolved).intersect(identity("ROLE1"))
 * ```
 */
export function raw(expr: IdentityExpr): Expr {
  if (!expr || typeof expr !== 'object' || !('kind' in expr)) {
    throw new Error('raw() requires a valid IdentityExpr object')
  }
  if (!['identity', 'union', 'intersect', 'exclude'].includes(expr.kind)) {
    throw new Error(`Invalid expression kind: ${expr.kind}`)
  }
  return new RawExpr(expr)
}

/**
 * Create a union of multiple expressions.
 * Variadic: union(a, b, c) = ((a ∪ b) ∪ c)
 *
 * @throws Error if no expressions provided
 *
 * @example
 * ```typescript
 * union(identity("A"), identity("B"), identity("C"))
 * ```
 */
export function union(...exprs: Expr[]): Expr {
  if (exprs.length === 0) {
    throw new Error('union requires at least one expression')
  }
  return exprs.reduce((acc, expr) => acc.union(expr))
}

/**
 * Create an intersection of multiple expressions.
 * Variadic: intersect(a, b, c) = ((a ∩ b) ∩ c)
 *
 * @throws Error if no expressions provided
 *
 * @example
 * ```typescript
 * intersect(identity("A"), identity("B"), identity("C"))
 * ```
 */
export function intersect(...exprs: Expr[]): Expr {
  if (exprs.length === 0) {
    throw new Error('intersect requires at least one expression')
  }
  return exprs.reduce((acc, expr) => acc.intersect(expr))
}

/**
 * Create an exclude expression.
 * exclude(base, excluded) = base \ excluded
 *
 * @example
 * ```typescript
 * exclude(identity("A"), identity("B"))  // A \ B
 * ```
 */
export function exclude(base: Expr, excluded: Expr): Expr {
  return base.exclude(excluded)
}

// =============================================================================
// GRANT BUILDER
// =============================================================================

/**
 * Builder for creating Grant objects with forType and forResource expressions.
 */
export class GrantBuilder {
  constructor(
    private readonly forType: Expr,
    private readonly forResource: Expr,
  ) {}

  /**
   * Build the raw Grant object.
   */
  build(): { forType: IdentityExpr; forResource: IdentityExpr } {
    return {
      forType: this.forType.build(),
      forResource: this.forResource.build(),
    }
  }
}

/**
 * Create a GrantBuilder for composing forType and forResource expressions.
 *
 * @example
 * ```typescript
 * const g = grant(identity("APP1"), forResourceExpr)
 * const rawGrant = g.build()
 * ```
 */
export function grant(forType: Expr, forResource: Expr): GrantBuilder {
  return new GrantBuilder(forType, forResource)
}
