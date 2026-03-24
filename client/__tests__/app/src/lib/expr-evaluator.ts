import type { IdentityExpr } from '@authz/types'

import { identity, id, union, intersect, exclude, grant, raw } from '@authz/expression/builder'
import { applyScope } from '@authz/expression/scope'

export interface EvalResult {
  type: 'grant' | 'expr'
  grant?: { forType: IdentityExpr; forResource: IdentityExpr }
  expr?: IdentityExpr
}

export function evaluateExprCode(code: string): EvalResult {
  // Wrap the code so the user can either:
  // 1. Use `return` to return a value
  // 2. Just write an expression on the last line
  // We try wrapping in a function body first
  const fn = new Function(
    'identity',
    'id',
    'union',
    'intersect',
    'exclude',
    'grant',
    'applyScope',
    'raw',
    code,
  )

  const result = fn(identity, id, union, intersect, exclude, grant, applyScope, raw)

  if (result === undefined || result === null) {
    throw new Error('Code must return a value. Use "return" or end with an expression.')
  }

  // Check if it's a GrantBuilder
  if (result instanceof Object && 'build' in result && typeof result.build === 'function') {
    const built = result.build()

    // Grant has forType + forResource
    if ('forType' in built && 'forResource' in built) {
      return {
        type: 'grant',
        grant: built as { forType: IdentityExpr; forResource: IdentityExpr },
      }
    }

    // ExprBuilder → IdentityExpr
    return {
      type: 'expr',
      expr: built as IdentityExpr,
    }
  }

  // Raw Grant object (from GrantBuilder.build())
  if (typeof result === 'object' && 'forType' in result && 'forResource' in result) {
    return {
      type: 'grant',
      grant: result as { forType: IdentityExpr; forResource: IdentityExpr },
    }
  }

  // Raw IdentityExpr object
  if (typeof result === 'object' && 'kind' in result) {
    return {
      type: 'expr',
      expr: result as IdentityExpr,
    }
  }

  throw new Error(
    `Unexpected result type. Expected an expression builder or IdentityExpr, got ${typeof result}`,
  )
}

export const EXAMPLE_CODE = `// Build a grant with the fluent builder API
// Available: identity(), id(), union(), intersect(), exclude(), grant(), applyScope(), raw()

return grant(
  identity("APP1"),
  union(
    identity("USER1"),
    identity("ROLE1")
  )
).build()
`

export const EXAMPLE_EXPR = `// Build just an identity expression
return union(
  identity("USER1", { nodes: ["workspace-1"] }),
  identity("ROLE1")
).build()
`
