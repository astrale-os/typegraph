/**
 * Fluent SDK for Identity Expression Composition
 *
 * Provides a builder pattern for composing identity expressions with
 * union, intersect, exclude, and scope operations. Supports method chaining
 * and factory functions for flexible expression building.
 *
 * @example
 * ```typescript
 * // Factory functions
 * const expr = union(
 *   identity("X").scope({ nodes: ["node-A"] }),
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
 * Provides composition methods (union, intersect, exclude, scope) available on all expressions.
 */
export abstract class Expr implements ExprBuilder {
  abstract build(): IdentityExpr

  /**
   * Create a union of this expression with another.
   * A ∪ B: grants access if either A or B grants access.
   * Flattens nested unions: (A ∪ B) ∪ C → union([A, B, C])
   */
  union(other: Expr): Expr {
    if (this instanceof NaryExpr && this.kind === 'union') {
      return new NaryExpr('union', [...this.operands, other])
    }
    return new NaryExpr('union', [this, other])
  }

  /**
   * Create an intersection of this expression with another.
   * A ∩ B: grants access only if both A and B grant access.
   * Flattens nested intersects: (A ∩ B) ∩ C → intersect([A, B, C])
   */
  intersect(other: Expr): Expr {
    if (this instanceof NaryExpr && this.kind === 'intersect') {
      return new NaryExpr('intersect', [...this.operands, other])
    }
    return new NaryExpr('intersect', [this, other])
  }

  /**
   * Exclude another expression from this one.
   * A \ B: grants access if A grants but B does not.
   * Flattens chained excludes: (A \ B) \ C → exclude(A, [B, C])
   */
  exclude(other: Expr): Expr {
    if (this instanceof ExcludeExpr) {
      return new ExcludeExpr(this.base, [...this.excluded, other])
    }
    return new ExcludeExpr(this, [other])
  }

  /**
   * Wrap this expression with a scope restriction.
   * Returns a ScopeExpr. Chaining .scope() accumulates scopes (OR'd).
   */
  scope(s: Scope): ScopeExpr {
    return new ScopeExpr([s], this)
  }
}

// =============================================================================
// IDENTITY LEAF BUILDER
// =============================================================================

/**
 * Builder for identity leaf expressions.
 * Represents a single identity.
 */
export class IdentityExprBuilder extends Expr {
  constructor(private readonly id: string) {
    super()
  }

  build(): IdentityExpr {
    return { kind: 'identity', id: this.id }
  }
}

// =============================================================================
// SCOPE EXPRESSION BUILDER
// =============================================================================

/**
 * Builder for scope-wrapped expressions.
 * Wraps an inner expression with scope restrictions (OR'd).
 */
export class ScopeExpr extends Expr {
  constructor(
    readonly scopes: Scope[],
    private readonly inner: Expr,
  ) {
    super()
  }

  /**
   * Add another scope (OR'd with existing scopes).
   * Returns a new ScopeExpr (immutable).
   */
  override scope(s: Scope): ScopeExpr {
    return new ScopeExpr([...this.scopes, s], this.inner)
  }

  build(): IdentityExpr {
    return { kind: 'scope', scopes: this.scopes, expr: this.inner.build() }
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
// N-ARY EXPRESSION BUILDER (union, intersect)
// =============================================================================

/**
 * Builder for n-ary expressions (union, intersect).
 */
export class NaryExpr extends Expr {
  constructor(
    readonly kind: 'union' | 'intersect',
    readonly operands: Expr[],
  ) {
    super()
  }

  build(): IdentityExpr {
    return {
      kind: this.kind,
      operands: this.operands.map((op) => op.build()),
    }
  }
}

// =============================================================================
// EXCLUDE EXPRESSION BUILDER
// =============================================================================

/**
 * Builder for exclude expressions (base \ excluded[]).
 */
export class ExcludeExpr extends Expr {
  constructor(
    readonly base: Expr,
    readonly excluded: Expr[],
  ) {
    super()
  }

  build(): IdentityExpr {
    return {
      kind: 'exclude',
      base: this.base.build(),
      excluded: this.excluded.map((e) => e.build()),
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
 * @param scopes - Optional scope restriction(s). If provided, wraps in a scope node.
 *
 * @example
 * ```typescript
 * identity("USER1")
 * identity("USER1", { nodes: ["ws1"] })
 * identity("USER1", [{ nodes: ["ws1"] }, { perms: 1 }])
 * ```
 */
export function identity(id: string, scopes?: Scope | Scope[]): Expr {
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('identity id must be a non-empty string')
  }
  const leaf = new IdentityExprBuilder(id)
  if (scopes) {
    const scopeArray = (Array.isArray(scopes) ? scopes : [scopes]).filter(Boolean)
    if (scopeArray.length > 0) {
      return new ScopeExpr(scopeArray, leaf)
    }
  }
  return leaf
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
 */
export function raw(expr: IdentityExpr): Expr {
  if (!expr || typeof expr !== 'object' || !('kind' in expr)) {
    throw new Error('raw() requires a valid IdentityExpr object')
  }
  if (!['identity', 'scope', 'union', 'intersect', 'exclude'].includes(expr.kind)) {
    throw new Error(`Invalid expression kind: ${expr.kind}`)
  }
  return new RawExpr(expr)
}

/**
 * Create a union of multiple expressions.
 * Variadic: union(a, b, c) = union([a, b, c])
 *
 * @throws Error if fewer than 2 expressions provided
 */
export function union(...exprs: Expr[]): Expr {
  if (exprs.length < 2) {
    throw new Error('union requires at least 2 expressions')
  }
  return new NaryExpr('union', exprs)
}

/**
 * Create an intersection of multiple expressions.
 * Variadic: intersect(a, b, c) = intersect([a, b, c])
 *
 * @throws Error if fewer than 2 expressions provided
 */
export function intersect(...exprs: Expr[]): Expr {
  if (exprs.length < 2) {
    throw new Error('intersect requires at least 2 expressions')
  }
  return new NaryExpr('intersect', exprs)
}

/**
 * Create an exclude expression.
 * exclude(base, excluded) = base \ excluded
 */
export function exclude(base: Expr, excluded: Expr): Expr {
  return new ExcludeExpr(base, [excluded])
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

  build(): { forType: IdentityExpr; forResource: IdentityExpr } {
    return {
      forType: this.forType.build(),
      forResource: this.forResource.build(),
    }
  }
}

/**
 * Create a GrantBuilder for composing forType and forResource expressions.
 */
export function grant(forType: Expr, forResource: Expr): GrantBuilder {
  return new GrantBuilder(forType, forResource)
}
