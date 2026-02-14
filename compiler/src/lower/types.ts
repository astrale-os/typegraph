// lower/types.ts
// ============================================================
// Type Expression Lowering — CST → AST
// ============================================================

import {
  type TypeExprNode,
  type UnionTypeNode,
  type NullableTypeNode,
  type NamedTypeNode,
  type EdgeRefTypeNode,
  spanOf,
} from '../cst/index'
import {
  type TypeExpr,
  type NamedType,
  type NullableType,
  type UnionType,
  type EdgeRefType,
} from '../ast/index'
import { lowerName } from './declarations'

export function lowerTypeExpr(node: TypeExprNode): TypeExpr {
  switch (node.kind) {
    case 'UnionType': {
      const union = node as UnionTypeNode
      return {
        kind: 'UnionType',
        types: union.types.map((t) => lowerTypeExpr(t)),
        span: spanOf(node),
      } as UnionType
    }
    case 'NullableType': {
      const nullable = node as NullableTypeNode
      return {
        kind: 'NullableType',
        inner: lowerTypeExpr(nullable.inner),
        span: spanOf(node),
      } as NullableType
    }
    case 'NamedType': {
      const named = node as NamedTypeNode
      return {
        kind: 'NamedType',
        name: lowerName(named.name),
        span: spanOf(node),
      } as NamedType
    }
    case 'EdgeRefType': {
      const edge = node as EdgeRefTypeNode
      return {
        kind: 'EdgeRefType',
        target: edge.target.text === 'any' ? null : lowerName(edge.target),
        span: spanOf(node),
      } as EdgeRefType
    }
  }
}
