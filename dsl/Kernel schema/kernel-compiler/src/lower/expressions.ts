// lower/expressions.ts
// ============================================================
// Expression Lowering — CST → AST
//
// Converts CST expression nodes into typed AST expressions:
// StringLiteral, NumberLiteral, BooleanLiteral, NullLiteral, CallExpression
// ============================================================

import {
  type ExpressionNode,
  type LiteralExprNode,
  type CallExprNode,
  spanOf,
} from '../cst/index.js'
import {
  type Expression,
  type StringLiteral,
  type NumberLiteral,
  type BooleanLiteral,
  type NullLiteral,
  type CallExpression,
} from '../ast/index.js'
import { type LoweringContext } from './index.js'
import { lowerName, unquote } from './declarations.js'
import { parseNum } from './modifiers.js'

export function lowerExpression(ctx: LoweringContext, node: ExpressionNode): Expression {
  const span = spanOf(node)

  // CallExpression
  if ('fn' in node && 'lparen' in node) {
    const call = node as CallExprNode
    return {
      kind: 'CallExpression',
      fn: lowerName(call.fn),
      span,
    } as CallExpression
  }

  // Literal
  const lit = node as LiteralExprNode
  const token = lit.token

  if (token.kind === 'StringLit') {
    return {
      kind: 'StringLiteral',
      value: unquote(token.text),
      span,
    } as StringLiteral
  }

  if (token.kind === 'NumberLit') {
    return {
      kind: 'NumberLiteral',
      value: parseNum(token.text, ctx.diagnostics, token.span),
      span,
    } as NumberLiteral
  }

  // Ident: true, false, null
  if (token.text === 'true') {
    return { kind: 'BooleanLiteral', value: true, span } as BooleanLiteral
  }
  if (token.text === 'false') {
    return { kind: 'BooleanLiteral', value: false, span } as BooleanLiteral
  }
  if (token.text === 'null') {
    return { kind: 'NullLiteral', span } as NullLiteral
  }

  // Unknown identifier in expression position — treat as string
  return {
    kind: 'StringLiteral',
    value: token.text,
    span,
  } as StringLiteral
}
