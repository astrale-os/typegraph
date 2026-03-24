// parser/expressions.ts
// ============================================================
// Expression Parsing
//
// Default value expressions: string/number/boolean/null literals,
// and zero-arg function calls like now().
// ============================================================

import {
  type CstChild,
  type ExpressionNode,
  type LiteralExprNode,
  type CallExprNode,
} from '../cst/index'
import { DiagnosticCodes } from '../diagnostics'
import { type Token } from '../tokens'
import { type ParserContext } from './index'

export function parseExpression(p: ParserContext): ExpressionNode {
  const children: CstChild[] = []

  // String literal
  if (p.at('StringLit')) {
    const token = p.advance()
    children.push(token)
    return { kind: 'Expression', children, token } as LiteralExprNode
  }

  // Number literal
  if (p.at('NumberLit')) {
    const token = p.advance()
    children.push(token)
    return { kind: 'Expression', children, token } as LiteralExprNode
  }

  // Ident: could be true, false, null, or fn()
  if (p.at('Ident')) {
    const ident = p.advance()
    children.push(ident)

    // Function call: name()
    if (p.at('LParen')) {
      const lparen = p.advance()
      children.push(lparen)
      const rparen = p.expect('RParen')
      children.push(rparen)
      return { kind: 'Expression', children, fn: ident, lparen, rparen } as CallExprNode
    }

    // true, false, null, or bare identifier (error but recoverable)
    return { kind: 'Expression', children, token: ident } as LiteralExprNode
  }

  // Error: unexpected token in expression position
  const cur = p.current()
  p.diagnostics.error(
    cur.span,
    DiagnosticCodes.P_EXPECTED_EXPRESSION,
    `Expected expression, got ${cur.kind}`,
  )
  // Produce a synthetic literal
  const synthetic: Token = {
    kind: 'Ident',
    text: 'null',
    span: { start: cur.span.start, end: cur.span.start },
    leadingTrivia: [],
  }
  children.push(synthetic)
  return { kind: 'Expression', children, token: synthetic } as LiteralExprNode
}
