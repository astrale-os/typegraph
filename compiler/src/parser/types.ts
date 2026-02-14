// parser/types.ts
// ============================================================
// Type Expression Parsing
//
// TypeExpr → UnionType → NullableType → PrimaryType
// Handles: Named types, Nullable (?), Union (|), edge<T>
// ============================================================

import {
  type CstChild,
  type TypeExprNode,
  type UnionTypeNode,
  type NullableTypeNode,
  type NamedTypeNode,
  type EdgeRefTypeNode,
} from '../cst/index.js'
import { type ParserContext } from './index.js'

export function parseTypeExpr(p: ParserContext): TypeExprNode {
  const first = parseNullableOrPrimary(p)

  // Check for union: Type | Type | ...
  if (p.at('Pipe')) {
    const children: CstChild[] = [first]
    const types: (NullableTypeNode | NamedTypeNode | EdgeRefTypeNode)[] = [
      first as NullableTypeNode | NamedTypeNode | EdgeRefTypeNode,
    ]

    while (p.at('Pipe')) {
      const pipe = p.advance()
      children.push(pipe)
      const next = parseNullableOrPrimary(p)
      children.push(next)
      types.push(next as NullableTypeNode | NamedTypeNode | EdgeRefTypeNode)
    }

    return {
      kind: 'UnionType',
      children,
      types,
    } as UnionTypeNode
  }

  return first
}

function parseNullableOrPrimary(p: ParserContext): TypeExprNode {
  const primary = parsePrimaryType(p)

  if (p.at('Question')) {
    const question = p.advance()
    const children: CstChild[] = [primary, question]
    return {
      kind: 'NullableType',
      children,
      inner: primary,
      question,
    } as NullableTypeNode
  }

  return primary
}

function parsePrimaryType(p: ParserContext): NamedTypeNode | EdgeRefTypeNode {
  // edge<Target>
  if (p.atKeyword('edge') && p.peek(1).kind === 'LAngle') {
    return parseEdgeRefType(p)
  }

  // Named type
  const name = p.expectIdent()
  return {
    kind: 'NamedType',
    children: [name],
    name,
  } as NamedTypeNode
}

function parseEdgeRefType(p: ParserContext): EdgeRefTypeNode {
  const children: CstChild[] = []

  const edgeKeyword = p.advance() // "edge"
  children.push(edgeKeyword)

  const langle = p.expect('LAngle')
  children.push(langle)

  const target = p.expectIdent() // Ident or "any"
  children.push(target)

  const rangle = p.expect('RAngle')
  children.push(rangle)

  return {
    kind: 'EdgeRefType',
    children,
    edgeKeyword,
    langle,
    target,
    rangle,
  } as EdgeRefTypeNode
}
